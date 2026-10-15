// Cut a raw session capture down to the keep ranges in edl.json.
//
//   bun scripts/session/make-master.ts <work-dir> <source> <window-start> <out.mp4>
//
// EDL times are relative to the trimmed window; `window-start` is where that window
// begins in the source. Nothing else is touched — no crop, no scale, no grade, no
// denoise. Captions and the logo bookends are added afterwards in Remotion.
//
// PICTURE is cut in chunks of 25 ranges to MPEG-TS: one select expression covering
// every range overflows ffmpeg's expression parser ("Cannot allocate memory"
// initialising filters). TS concatenates without the timestamp trouble MP4 gives at
// many joins.
//
// SOUND is not chunked. It used to ride along inside the same per-chunk filtergraph,
// and that is what made episodes step out of sync at the joins: measured on the Fro
// session, lip-sync sat at +63ms in chunk 0, -27ms in chunk 1 and +12ms in chunk 2 —
// jumps of up to 90ms, audible as sound drifting off the picture partway through.
// Within a chunk it was rock steady (dead flat across one 368s uncut stretch), and it
// did not depend on where -ss landed, so the error was being injected once per chunk
// by the audio encode/concat path rather than accumulating over time.
//
// So the sound is now decoded once, sliced sample-exactly, and muxed on at the end:
//
//   * one decode of the whole window to raw 48kHz PCM;
//   * each keep range contributes exactly the span its kept FRAMES occupy — start at
//     rangeFirstFrameTime, length rangeFrames * 800 samples (48000/60 = 800 samples
//     per frame exactly, so there is no rounding anywhere);
//   * the slices are concatenated and muxed onto the joined picture.
//
// Total audio is therefore totalFrames * 800 samples against totalFrames of picture —
// the two durations are equal by construction, and there are no per-chunk audio
// boundaries left to step at.

import { readFileSync, writeFileSync, mkdirSync, rmSync, openSync, readSync, closeSync, createWriteStream } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import {
  CHUNK_SIZE,
  FPS,
  rangeFrames,
  rebaseFor,
  type Edl,
  type Range,
} from "./edl";

const [workDir, source, windowStartArg, output] = process.argv.slice(2);
if (!workDir || !source || windowStartArg === undefined || !output) {
  console.error(
    "usage: bun scripts/session/make-master.ts <work-dir> <source> <window-start> <out>",
  );
  process.exit(1);
}
const windowStart = Number(windowStartArg);

/** The master's audio rate. 48000/FPS is a whole number of samples per video frame (800 at 60fps). */
const SAMPLE_RATE = 48000;
const CHANNELS = 2;
const BYTES_PER_FRAME = CHANNELS * 2; // s16
const SAMPLES_PER_VIDEO_FRAME = SAMPLE_RATE / FPS;

/**
 * Picture/sound offset baked into the capture, fixed here: PICTURE_OFFSET=0.36 takes
 * the picture 0.36s later in the source than the sound it is paired with.
 *
 * Boogie's stream capture has its camera 0.37s behind its audio (measured by tracking
 * lip opening with MediaPipe against the voice envelope, eight spans, both speakers,
 * no drift). Comparing master to source cannot see this: it copies the fault exactly.
 * The picture moves rather than the sound because the cuts were placed on the audio,
 * between words; moving the sound would clip them. Must be whole frames, so the frame
 * grid stays aligned.
 */
const PICTURE_OFFSET = Number(process.env.PICTURE_OFFSET ?? 0);
if (Math.abs(PICTURE_OFFSET * FPS - Math.round(PICTURE_OFFSET * FPS)) > 1e-6) {
  throw new Error(`PICTURE_OFFSET ${PICTURE_OFFSET} is not a whole number of frames at ${FPS}fps`);
}

/**
 * Audio repair, enabled with REPAIR_AUDIO=1. For sessions where a guest held the mic
 * badly and the whole recording sits far too quiet.
 *
 * Measured on the Gibbo session: speech sat at -46 dBFS with the two speakers 6.9 dB
 * apart. The high-pass removes the rumble that dominated the noise floor, a light
 * afftdn takes the rest without suppressing the quiet voice (a stronger setting
 * *preserved* the speaker gap, because it ducks the distant speaker too), and a
 * presence lift helps a distant voice cut through. It runs once over the whole
 * programme — per chunk it would set a different gain for each and the level would
 * jump at every join.
 *
 * Measure before reaching for it. On the Fro session a p85-p15 spread of 13.4 dB
 * looked like the same problem, but measuring named single-speaker spans put both men
 * at -31..-35 dBFS: ordinary speech dynamics, not a distant mic. Compressing that
 * chased the percentile and cost 3 dB of SNR for nothing.
 *
 * What this cannot fix: off-mic sounds distant because of room reverb, not only
 * level. Levelling brings the voice up; the roominess stays.
 */
const REPAIR = process.env.REPAIR_AUDIO === "1";
const REPAIR_CHAIN = [
  // Rumble dominated the noise floor; removing it is most of the denoise.
  "highpass=f=85:p=2",
  // Light. A stronger setting *preserved* the speaker gap, because it ducks the
  // distant voice along with the noise.
  "afftdn=nf=-20",
  // Presence, so a distant voice cuts through.
  "equalizer=f=2800:width_type=o:width=1.4:g=3",
  // The actual levelling. Measured over a representative 10 minutes it closes the
  // speaker gap 11.1 -> 9.3 dB at no cost in SNR. loudnorm alone does NOT do this:
  // it adapts across a short excerpt but not speaker-to-speaker across 17 minutes,
  // and on its own it made the gap *worse* (11.1 -> 13.5 dB).
  "speechnorm=e=25:r=0.0008:l=1",
  "loudnorm=I=-14:TP=-1.5:LRA=11",
  // Pin the rate. loudnorm works internally at 192kHz and, left to negotiate, hands
  // back 96kHz — which Remotion then mishandles, drifting the audio ~0.4s ahead of
  // picture across a 17-minute episode. The master must come out at 48kHz.
  `aresample=${SAMPLE_RATE}`,
].join(",");

/** Concurrent encodes. The box has 10 cores and x264 threads well. */
const CONCURRENCY = 4;

const edl = JSON.parse(readFileSync(join(workDir, "edl.json"), "utf8")) as Edl;
const tmp = join(workDir, "chunks");
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });

const run = (args: string[], label: string) =>
  new Promise<void>((resolve, reject) => {
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    proc.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${label} failed (${code}):\n${stderr.slice(-1200)}`)),
    );
  });

const chunks: Range[][] = [];
for (let i = 0; i < edl.keepRanges.length; i += CHUNK_SIZE) {
  chunks.push(edl.keepRanges.slice(i, i + CHUNK_SIZE));
}

const chunkPath = (i: number) => join(tmp, `c${String(i).padStart(3, "0")}.ts`);

/**
 * Picture only.
 *
 * Every chunk seeks to the *window start*, never to its own first range. `-ss` before
 * `-i` rebases the filter clock to the seek point, so seeking per chunk gave each one
 * its own grid — a frame or three away from the model's, constant inside the chunk and
 * different in the next, which is precisely how an episode ends up in sync at the
 * front and out of sync later. One origin for every chunk means one grid, and EDL
 * times can be used as they are.
 *
 * The cost is that a later chunk decodes (and throws away) everything before its first
 * range. Decoding is cheap next to encoding and the chunks run in parallel, so this is
 * a couple of minutes on a half-hour episode — worth it to make the timing exact
 * rather than approximately right.
 */
const encodeChunk = async (ranges: Range[], index: number) => {
  // A frame past the last range: -to cuts before a frame sitting at or just under it,
  // which cost the Boogie master the final frame of four chunks. select() does the
  // real bounding, so the extra decoded frame is never kept.
  const to = windowStart + PICTURE_OFFSET + ranges[ranges.length - 1].end + 1 / FPS;
  // Select exactly the frames the model counts, by bounds half a frame outside them.
  // Passing the raw range ends lets a boundary that sits exactly on a frame time go
  // either way on float noise in t. At 60fps that is rare; at 25fps whisper's 10ms
  // grid puts a quarter of all bounds on a frame, and the Boogie master came out 11
  // frames short of its audio.
  const half = 0.5 / FPS;
  const expr = ranges
    .map((r) => {
      const first = Math.ceil(r.start * FPS - 1e-9) / FPS;
      const last = Math.floor(r.end * FPS + 1e-9) / FPS;
      return `between(t,${(first - half).toFixed(4)},${(last + half).toFixed(4)})`;
    })
    .join("+");

  await run(
    [
      "-hide_banner", "-v", "error",
      "-ss", (windowStart + PICTURE_OFFSET).toFixed(3),
      "-to", to.toFixed(3),
      "-i", source,
      "-an",
      "-filter_complex", `[0:v]select='${expr}',setpts=N/${FPS}/TB[v]`,
      "-map", "[v]",
      // Near-lossless: this is an intermediate, and Remotion re-encodes it when it
      // adds the captions. CRF 12 keeps that second generation invisible.
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "12",
      // Short GOP so Remotion's OffthreadVideo can seek it cheaply.
      "-g", "15",
      "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709",
      "-f", "mpegts", "-y", chunkPath(index),
    ],
    `chunk ${index}`,
  );
};

/** One decode of the whole window to raw PCM, so the slicing below is pure byte math. */
const decodeAudio = async (path: string) => {
  await run(
    ["-hide_banner", "-v", "error",
      "-ss", windowStart.toFixed(3),
      "-t", edl.sourceDuration.toFixed(3),
      "-i", source,
      "-vn", "-ac", String(CHANNELS), "-ar", String(SAMPLE_RATE),
      "-c:a", "pcm_s16le", "-f", "s16le", "-y", path],
    "decode audio",
  );
};

/**
 * Slice the decoded audio to exactly the spans the kept FRAMES occupy.
 *
 * Both numbers come from the same frame model the picture is cut with, so a range
 * contributes rangeFrames * 800 samples against rangeFrames of picture. Nothing is
 * rounded except the start offset, and that lands within one sample.
 */
const buildCutAudio = (src: string, dest: string) =>
  new Promise<number>((resolve, reject) => {
    const fd = openSync(src, "r");
    const out = createWriteStream(dest);
    let written = 0;

    try {
      for (let i = 0; i < edl.keepRanges.length; i++) {
        const rb = rebaseFor(edl.keepRanges, i, CHUNK_SIZE);
        const frames = rangeFrames(edl.keepRanges[i], FPS, rb);
        // Snap to the source's own frame grid rather than assuming one starting at the
        // window. Identical whenever the window starts on a frame boundary, correct
        // when it does not.
        const absFirstFrame =
          Math.ceil((windowStart + edl.keepRanges[i].start) * FPS - 1e-9) / FPS;

        const startSample = Math.round((absFirstFrame - windowStart) * SAMPLE_RATE);
        const sampleCount = frames * SAMPLES_PER_VIDEO_FRAME;

        const buf = Buffer.alloc(sampleCount * BYTES_PER_FRAME);
        const got = readSync(fd, buf, 0, buf.length, startSample * BYTES_PER_FRAME);
        // The last range can run a hair past what was decoded; pad with silence
        // rather than letting the audio come up short against the picture.
        if (got < buf.length) buf.fill(0, got);
        out.write(buf);
        written += sampleCount;
      }
    } catch (err) {
      closeSync(fd);
      out.destroy();
      reject(err);
      return;
    }

    closeSync(fd);
    out.end(() => resolve(written));
  });

const main = async () => {
  console.log(`keep ranges  ${edl.keepRanges.length}`);
  console.log(`chunks       ${chunks.length} (picture only)`);
  console.log(`expected out ${(edl.outputDuration / 60).toFixed(2)} min`);

  const rawAudio = join(tmp, "window.pcm");
  const cutAudio = join(tmp, "cut.pcm");

  console.log("decoding audio...");
  await decodeAudio(rawAudio);
  const samples = await buildCutAudio(rawAudio, cutAudio);

  const expectedFrames = Math.round(edl.outputDuration * FPS);
  console.log(
    `audio        ${samples} samples = ${(samples / SAMPLE_RATE).toFixed(3)}s ` +
      `against ${expectedFrames} frames = ${(expectedFrames / FPS).toFixed(3)}s`,
  );
  if (samples !== expectedFrames * SAMPLES_PER_VIDEO_FRAME) {
    throw new Error(
      `audio/picture length mismatch: ${samples} samples vs ` +
        `${expectedFrames * SAMPLES_PER_VIDEO_FRAME} expected`,
    );
  }

  let done = 0;
  const queue = chunks.map((ranges, i) => async () => {
    await encodeChunk(ranges, i);
    console.log(`  chunk ${++done}/${chunks.length}`);
  });
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      for (;;) {
        const task = queue.shift();
        if (!task) return;
        await task();
      }
    }),
  );

  // Paths in a concat list resolve relative to the list file itself.
  const listPath = join(tmp, "concat.txt");
  writeFileSync(
    listPath,
    chunks.map((_, i) => `file '${chunkPath(i).split("/").pop()}'`).join("\n"),
  );

  console.log("joining picture...");
  const joined = join(tmp, "picture.ts");
  await run(
    ["-hide_banner", "-v", "error", "-f", "concat", "-safe", "0", "-i", listPath,
      "-c", "copy", "-y", joined],
    "concat",
  );

  console.log(REPAIR ? "muxing (with audio repair)..." : "muxing...");
  await run(
    ["-hide_banner", "-v", "error",
      "-i", joined,
      "-f", "s16le", "-ar", String(SAMPLE_RATE), "-ac", String(CHANNELS), "-i", cutAudio,
      "-map", "0:v:0", "-map", "1:a:0",
      "-c:v", "copy",
      ...(REPAIR ? ["-af", REPAIR_CHAIN] : []),
      "-c:a", "aac", "-b:a", "256k", "-ar", String(SAMPLE_RATE),
      // Trailing silence from the pad can outrun the picture by an AAC frame or two.
      "-shortest",
      "-movflags", "+faststart", "-y", output],
    "mux",
  );

  rmSync(tmp, { recursive: true, force: true });
  console.log(`done -> ${output}`);
};

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
