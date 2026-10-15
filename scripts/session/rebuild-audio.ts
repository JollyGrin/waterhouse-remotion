// Rebuild an episode's soundtrack from the source and lay it onto finished picture.
//
//   bun scripts/session/rebuild-audio.ts <work-dir> <source> <window-start> <video> <out> [--fades]
//
// The audio is cut exactly as make-master.ts cuts it — one decode, sliced to the spans
// the kept frames occupy — and muxed onto <video> with the picture stream copied. So
// it repairs a delivered episode in minutes instead of re-rendering it, which is what
// you want when a sync fault is found after the fact (it has now happened twice).
//
// <video> may be the cut master, or the finished Remotion episode. For the finished
// episode pass --fades: Remotion ramps the audio up under the opening reveal and down
// under the closing one, and holds black after the picture ends, so the soundtrack has
// to be shaped the same way or the ends will not match.
//
// REPAIR_AUDIO=1 applies the same repair chain make-master.ts uses.

import { readFileSync, mkdirSync, rmSync, openSync, readSync, closeSync, createWriteStream } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import {
  CHUNK_SIZE,
  FPS,
  rangeFrames,
  rangeFirstFrameTime,
  rebaseFor,
  type Edl,
} from "./edl";
import { AUDIO_FADE_SECONDS, CLOSE, FPS as DESIGN_FPS, TAIL_SECONDS } from "../../src/session/theme";

const args = process.argv.slice(2);
const fades = args.includes("--fades");
/**
 * Episodes mastered before the single-origin seek landed have picture cut on a
 * per-chunk grid, so their sound has to be cut the same way to sit on it. New
 * episodes must not use this.
 */
const legacyRebase = args.includes("--legacy-chunk-rebase");
const shiftArg = args.find((a) => a.startsWith("--shift="));
/** Constant nudge, seconds. Positive delays the sound. */
const shift = shiftArg ? Number(shiftArg.split("=")[1]) : 0;
const [workDir, source, windowStartArg, video, output] = args.filter(
  (a) => !a.startsWith("--"),
);
if (!workDir || !source || windowStartArg === undefined || !video || !output) {
  console.error(
    "usage: bun scripts/session/rebuild-audio.ts <work-dir> <source> <window-start> <video> <out> [--fades]",
  );
  process.exit(1);
}
const windowStart = Number(windowStartArg);

const SAMPLE_RATE = 48000;
const CHANNELS = 2;
const BYTES_PER_FRAME = CHANNELS * 2;
const SAMPLES_PER_VIDEO_FRAME = SAMPLE_RATE / FPS;

const REPAIR = process.env.REPAIR_AUDIO === "1";
const REPAIR_CHAIN = [
  "highpass=f=85:p=2",
  "afftdn=nf=-20",
  "equalizer=f=2800:width_type=o:width=1.4:g=3",
  "speechnorm=e=25:r=0.0008:l=1",
  "loudnorm=I=-14:TP=-1.5:LRA=11",
  `aresample=${SAMPLE_RATE}`,
].join(",");

const edl = JSON.parse(readFileSync(join(workDir, "edl.json"), "utf8")) as Edl;
const tmp = join(workDir, "audio-rebuild");
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });

const run = (a: string[], label: string) =>
  new Promise<void>((resolve, reject) => {
    const p = spawn("ffmpeg", a, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => (err += d.toString()));
    p.on("exit", (c) =>
      c === 0 ? resolve() : reject(new Error(`${label} failed (${c}):\n${err.slice(-1200)}`)),
    );
  });

const buildCutAudio = (src: string, dest: string) =>
  new Promise<number>((resolve, reject) => {
    const fd = openSync(src, "r");
    const out = createWriteStream(dest);
    let written = 0;
    try {
      for (let i = 0; i < edl.keepRanges.length; i++) {
        const rb = legacyRebase
          ? edl.keepRanges[Math.floor(i / CHUNK_SIZE) * CHUNK_SIZE].start
          : rebaseFor(edl.keepRanges, i, CHUNK_SIZE);
        // The shift is applied by reading from earlier in the source, not by offsetting
        // timestamps: the fade/pad filters re-base timestamps, so -itsoffset here is
        // silently normalised away and the nudge never reaches the file.
        const startSample =
          Math.round(rangeFirstFrameTime(edl.keepRanges[i], FPS, rb) * SAMPLE_RATE) -
          Math.round(shift * SAMPLE_RATE);
        const count =
          rangeFrames(edl.keepRanges[i], FPS, rb) * SAMPLES_PER_VIDEO_FRAME;
        // A shift can pull the very first range before the start of the decoded
        // window; Buffer.alloc is already zeroed, so that head simply stays silent.
        const buf = Buffer.alloc(count * BYTES_PER_FRAME);
        const skip = Math.max(0, -startSample) * BYTES_PER_FRAME;
        const got = readSync(
          fd, buf, skip, buf.length - skip,
          Math.max(0, startSample) * BYTES_PER_FRAME,
        );
        if (skip + got < buf.length) buf.fill(0, skip + got);
        out.write(buf);
        written += count;
      }
    } catch (e) {
      closeSync(fd);
      out.destroy();
      reject(e);
      return;
    }
    closeSync(fd);
    out.end(() => resolve(written));
  });

const main = async () => {
  const raw = join(tmp, "window.pcm");
  const cut = join(tmp, "cut.pcm");

  console.log("decoding audio...");
  await run(
    ["-hide_banner", "-v", "error",
      "-ss", windowStart.toFixed(3), "-t", edl.sourceDuration.toFixed(3), "-i", source,
      "-vn", "-ac", String(CHANNELS), "-ar", String(SAMPLE_RATE),
      "-c:a", "pcm_s16le", "-f", "s16le", "-y", raw],
    "decode",
  );

  const samples = await buildCutAudio(raw, cut);
  const pictureFrames = Math.round(edl.outputDuration * FPS);
  console.log(`audio ${(samples / SAMPLE_RATE).toFixed(3)}s vs picture ${(pictureFrames / FPS).toFixed(3)}s`);
  if (samples !== pictureFrames * SAMPLES_PER_VIDEO_FRAME) {
    throw new Error("audio/picture length mismatch");
  }

  // Match what SessionEpisode does to the soundtrack, so the ends line up.
  const pictureSeconds = pictureFrames / FPS;
  // CLOSE is in 60fps design frames whatever the episode's own rate (see theme.ts).
  const closeSeconds = CLOSE.durationInFrames / DESIGN_FPS;
  const closeStart = pictureSeconds - closeSeconds;
  const shape = fades
    ? [
        `afade=t=in:st=0:d=${AUDIO_FADE_SECONDS}`,
        `afade=t=out:st=${closeStart.toFixed(3)}:d=${closeSeconds.toFixed(3)}`,
        `apad=pad_dur=${TAIL_SECONDS}`,
      ]
    : [];

  const chain = [...(REPAIR ? [REPAIR_CHAIN] : []), ...shape].join(",");
  console.log(`muxing onto picture${REPAIR ? " (repaired)" : ""}${fades ? " (+fades/tail)" : ""}...`);
  await run(
    ["-hide_banner", "-v", "error",
      "-i", video,
      "-f", "s16le", "-ar", String(SAMPLE_RATE), "-ac", String(CHANNELS), "-i", cut,
      "-map", "0:v:0", "-map", "1:a:0",
      "-c:v", "copy",
      ...(chain ? ["-af", chain] : []),
      "-c:a", "aac", "-b:a", "256k", "-ar", String(SAMPLE_RATE),
      // Trailing silence from the pad can outrun the picture by an AAC frame or two.
      "-shortest",
      "-movflags", "+faststart", "-y", output],
    "mux",
  );

  rmSync(tmp, { recursive: true, force: true });
  console.log(`done -> ${output}`);
};

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
