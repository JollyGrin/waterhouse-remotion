// Turn a whisper transcript into a cut list plus retimed captions.
//
//   bun scripts/session/build-edl.ts <work-dir> <window-seconds>
//
// Writes edl.json and captions.json next to transcript.json. Both are meant to be
// read by a human before any encoding happens — edl.json lists every cut against the
// trimmed window, captions.json every surviving word on the cut timeline.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FPS, buildEdl, type Word } from "./edl";

type WhisperSegment = { offsets: { from: number; to: number }; text: string };

/**
 * Reassemble whisper's segments into whole words.
 *
 * Even with --split-on-word, punctuation and whisper's speaker-turn dashes arrive as
 * segments of their own; without it a segment is a *token*, so "Scouser" comes back
 * as "sc" + "ous" + "er" and the filler lexicon eats that "er" from the middle of a
 * real word. A segment not beginning with whitespace continues the word before it —
 * that is the signal used here, so this holds either way.
 */
const parseWords = (segments: WhisperSegment[]): Word[] => {
  const words: Word[] = [];

  for (const seg of segments) {
    if (!seg.text.trim()) continue;
    const startsNewWord = /^\s/.test(seg.text);
    const text = seg.text.trim();
    const end = seg.offsets.to / 1000;
    const prev = words[words.length - 1];

    if (/^[.,!?;:'"\-–—…)\]]+$/.test(text)) {
      // A lone dash is whisper marking a change of speaker, not punctuation to
      // attach; it would render as a stray hyphen in the captions.
      if (prev && !/^[-–—]+$/.test(text)) {
        prev.text += text;
        prev.end = Math.max(prev.end, end);
      }
      continue;
    }

    if (!startsNewWord && prev) {
      prev.text += text;
      prev.end = Math.max(prev.end, end);
      continue;
    }
    words.push({ start: seg.offsets.from / 1000, end, text });
  }

  // Whisper occasionally emits a run of zero-length segments where its alignment gave
  // up. Left alone they read as an instant, so the gap either side looks like dead air
  // and the words get cut.
  for (let i = 0; i < words.length; i++) {
    if (words[i].end > words[i].start) continue;
    const next = words[i + 1];
    words[i].end = Math.min(words[i].start + 0.12, next ? next.start : Infinity);
  }

  return words;
};

const [dir, windowSeconds, measuredFramesArg] = process.argv.slice(2);
if (!dir || !windowSeconds) {
  console.error(
    "usage: bun scripts/session/build-edl.ts <work-dir> <window-seconds> [measured-frames]",
  );
  process.exit(1);
}

const transcript = JSON.parse(
  readFileSync(join(dir, "transcript.json"), "utf8"),
) as { transcription: WhisperSegment[] };

/**
 * Spelling fixes for names whisper can't know, from an optional corrections.json in
 * the work dir: `[["ford rhythm", "Fort Riddim"], ["man scream", "Manscream"]]`.
 *
 * Matched on consecutive words, ignoring case and punctuation; the matched words'
 * trailing punctuation is kept. The replacement may have fewer words than the match —
 * the leftovers fold into its last word, so timing still covers the whole phrase. It
 * only changes caption text: nothing corrected is a filler, so no cut moves.
 */
const applyCorrections = (words: Word[], pairs: [string, string][]): Word[] => {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9']/g, "");
  const out: Word[] = [];
  let fixed = 0;
  for (let i = 0; i < words.length; ) {
    const hit = pairs.find(([from]) => {
      const f = from.split(/\s+/);
      return f.every((w, j) => words[i + j] && norm(words[i + j].text) === norm(w));
    });
    if (!hit) {
      out.push(words[i++]);
      continue;
    }
    const n = hit[0].split(/\s+/).length;
    const to = hit[1].split(/\s+/);
    if (to.length > n) throw new Error(`correction "${hit[0]}" -> "${hit[1]}" adds words`);
    const span = words.slice(i, i + n);
    const trail = span[n - 1].text.match(/[^a-z0-9']*$/i)?.[0] ?? "";
    to.forEach((w, j) => {
      const last = j === to.length - 1;
      out.push({
        start: span[j].start,
        end: last ? span[n - 1].end : span[j].end,
        text: last ? w + trail : w,
      });
    });
    fixed++;
    i += n;
  }
  console.log(`corrections  ${fixed} applied`);
  return out;
};

const correctionsPath = join(dir, "corrections.json");
const words = applyCorrections(
  parseWords(transcript.transcription),
  existsSync(correctionsPath) ? JSON.parse(readFileSync(correctionsPath, "utf8")) : [],
);
const { edl, captions } = buildEdl(words, Number(windowSeconds), 0);

/**
 * Rescale the caption timeline onto the master that was actually encoded.
 *
 * The frame model predicts the cut length closely but not exactly — source timestamps
 * are not perfectly on the frame grid once ffmpeg has seeked, so a small bias
 * accumulates across the cuts. Pass the master's real frame count and the drift is
 * divided out. Without it, captions on a 16-minute cut ran a quarter-second late by
 * the end.
 */
const measured = measuredFramesArg ? Number(measuredFramesArg) : null;
const scale = measured ? measured / (edl.outputDuration * FPS) : 1;
const scaled = scale === 1 ? captions : captions.map((c) => ({ ...c, t: c.t * scale }));
if (measured) {
  console.log(`measured     ${measured} frames (model ${Math.round(edl.outputDuration * FPS)})`);
  console.log(`correction   ${((scale - 1) * edl.outputDuration).toFixed(2)}s over the episode`);
}

writeFileSync(join(dir, "edl.json"), JSON.stringify(edl, null, 2));
writeFileSync(join(dir, "captions.json"), JSON.stringify(scaled));

const mmss = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

console.log(`words        ${words.length}`);
console.log(`window       ${mmss(Number(windowSeconds))}`);
console.log(`output       ${mmss(edl.outputDuration)}  (${mmss(edl.removedSeconds)} removed)`);
console.log(`cuts         ${edl.cutCount}`);
console.log(`captions     ${captions.length} words`);
