/**
 * Cuts a vertical promo reel out of a finished session episode.
 *
 * Two stages, because they answer different questions:
 *   1. ffmpeg lifts the chosen spans out of the 16:9 master and joins them. Still the
 *      full wide two-shot — this stage only decides *what is said*.
 *   2. Remotion crops to 9:16, cuts between the speakers, lays the captions on and
 *      tags the end. That stage decides *what is seen*, and it stays adjustable
 *      without re-cutting.
 *
 * The word timings come straight from the episode's own captions.json, rebased onto
 * the reel's timeline, so nothing is re-transcribed and nothing can drift.
 *
 *   bun scripts/reel/make-reel.ts src/reel/data/fro-ministry.reel.json [--cut-only]
 */

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { basename, join } from "node:path";
import { FPS, END_CARD_SECONDS, SHOTS, TICKER_TOP } from "../../src/reel/theme";

type Segment = { start: number; end: number; shot: string; note?: string };
/**
 * A correction to one transcribed word, keyed on its time in the master.
 * `w` replaces the text; `at`/`d` replace the timing.
 */
type WordFix = {
  t: number;
  /**
   * Also require this text. Whisper sometimes stamps a whole phrase with one time
   * (Boogie's "When I started the set," is five words at 955.66), and `t` alone cannot
   * tell them apart.
   */
  match?: string;
  w?: string;
  at?: number;
  d?: number;
};
type ReelDef = {
  slug: string;
  title: string;
  source: string;
  /**
   * Where the sound comes from, when that is not `source`.
   *
   * This episode's master was built by the old chunked audio path: its sound runs
   * ~75ms early and steps 130ms at the 312s chunk join, which lands inside the last
   * span this reel uses. The delivered episode was repaired afterwards by
   * scripts/session/rebuild-audio.ts and sits on the same clock as the master's
   * picture, so picture comes from the master (no burned-in captions) and sound from
   * the delivery (correct sync). Verified by correlation, not assumed.
   */
  audioSource?: string;
  captions: string;
  artist: string;
  episodeLabel: string;
  cta: string;
  segments: Segment[];
  /**
   * Corrections to the transcript, keyed on the word's time in the master.
   *
   * Two kinds are needed in practice. Whisper lower-cases proper nouns it does not
   * know, and "ministry of sound" is the whole point of this reel — it has to carry
   * its capitals. And it stretches words back across leading silence: it timed
   * "do you" at 159.40 when the words are spoken at 159.92, which would put the
   * opening caption on screen before anybody says anything.
   */
  wordFixes?: WordFix[];
};
type CaptionWord = { t: number; d: number; w: string; br: boolean };

const run = (cmd: string, args: string[]) =>
  new Promise<string>((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    proc.stdout.on("data", (c) => (out += c));
    proc.stderr.on("data", (c) => (err += c));
    proc.on("close", (code) =>
      code === 0
        ? resolve(out)
        : reject(new Error(`${cmd} exited ${code}\n${err.slice(-4000)}`)),
    );
  });

async function main() {
  const defPath = process.argv[2];
  if (!defPath) throw new Error("usage: make-reel.ts <reel.json> [--cut-only]");
  const cutOnly = process.argv.includes("--cut-only");
  // The cut is the slow half. When only the framing or captions are being tweaked
  // there is no reason to lift the spans out of the master again.
  const reuseCut = process.argv.includes("--reuse-cut");

  for (const [name, shot] of Object.entries(SHOTS)) {
    if (shot.y + shot.height > TICKER_TOP) {
      throw new Error(
        `shot ${name} reaches source row ${shot.y + shot.height}, into the burned-in ` +
          `ticker below ${TICKER_TOP}`,
      );
    }
    const ratio = shot.height / shot.width;
    if (Math.abs(ratio - 16 / 9) > 0.005) {
      throw new Error(`shot ${name} is ${ratio.toFixed(3)}:1, not 16:9`);
    }
  }

  const def: ReelDef = await Bun.file(defPath).json();
  const words: CaptionWord[] = await Bun.file(def.captions).json();

  /**
   * Snap every span to the reel's frame grid before anything else touches it.
   *
   * An arbitrary float duration gives ffmpeg a fractional number of frames to emit,
   * and its rounding then disagrees with the frame count the reel timeline predicts —
   * about 16ms per span, accumulating, until the crop cuts and the captions no longer
   * sit where the picture actually cuts. 1/30s is two whole frames of the 60fps
   * source, so quantising here is exact on both grids.
   */
  const snap = (t: number) => Math.round(t * FPS) / FPS;
  def.segments = def.segments.map((segment) => ({
    ...segment,
    start: snap(segment.start),
    end: snap(segment.end),
  }));

  const workDir = join("work", `reel-${def.slug}`);
  mkdirSync(workDir, { recursive: true });
  mkdirSync("public/reel", { recursive: true });
  mkdirSync("out/reels", { recursive: true });

  const cutName = `${def.slug}-cut.mp4`;
  const cutPath = join("public/reel", cutName);

  /* ---------- stage 1: lift the spans out of the master and join them ---------- */

  /**
   * A 30ms ramp on each end of every span. The joins land mid-room-tone, and an
   * instantaneous level change there is an audible tick on a phone speaker.
   */
  const AUDIO_RAMP = 0.03;

  const inputs: string[] = [];
  const filters: string[] = [];
  const concatIn: string[] = [];

  const audioSource = def.audioSource ?? def.source;
  const sameFile = audioSource === def.source;

  /**
   * Source and working rates. The spans are already on the 30fps reel grid, so both
   * of these come out as exact integers per span.
   */
  const SOURCE_FPS = 60;
  const SAMPLE_RATE = 48000;

  def.segments.forEach((segment, i) => {
    const duration = segment.end - segment.start;
    const frames = Math.round(duration * SOURCE_FPS);
    const samples = Math.round(duration * SAMPLE_RATE);

    // Ask for a little more than needed and trim to an exact count. Asking for the
    // exact duration leaves ffmpeg to round a sub-frame seek however it likes, and it
    // returns a spare frame often enough that the spans walk a frame out of step with
    // the reel timeline, one per cut, until the crop changes land in the wrong place.
    const seek = [
      "-ss", segment.start.toFixed(3),
      "-t", (duration + 0.1).toFixed(3),
      "-i",
    ];
    const vi = sameFile ? i : i * 2;
    const ai = sameFile ? i : i * 2 + 1;
    inputs.push(...seek, def.source);
    if (!sameFile) inputs.push(...seek, audioSource);

    filters.push(
      `[${vi}:v]fps=${SOURCE_FPS},trim=end_frame=${frames},setpts=PTS-STARTPTS[v${i}]`,
    );
    filters.push(
      `[${ai}:a]aresample=${SAMPLE_RATE},atrim=end_sample=${samples},` +
        `asetpts=PTS-STARTPTS,` +
        `aformat=sample_fmts=fltp:channel_layouts=stereo,` +
        `afade=t=in:st=0:d=${AUDIO_RAMP},` +
        `afade=t=out:st=${(duration - AUDIO_RAMP).toFixed(3)}:d=${AUDIO_RAMP}[a${i}]`,
    );
    concatIn.push(`[v${i}][a${i}]`);
  });

  filters.push(`${concatIn.join("")}concat=n=${def.segments.length}:v=1:a=1[v][a]`);

  if (reuseCut && existsSync(cutPath)) {
    console.log(`Reusing ${cutPath}`);
  } else {
    console.log(
      `Cutting ${def.segments.length} spans out of ${basename(def.source)}` +
        (sameFile ? "" : ` (sound from ${basename(audioSource)})`) + "...",
    );
    await run("ffmpeg", [
      "-y", "-v", "error", "-stats",
      ...inputs,
      "-filter_complex", filters.join(";"),
      "-map", "[v]", "-map", "[a]",
      // A high-quality intermediate: Remotion upscales this ~2x, so anything lost here
      // is lost twice over.
      "-c:v", "libx264", "-crf", "17", "-preset", "medium", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "192k",
      "-movflags", "+faststart",
      cutPath,
    ]);
  }

  /* ---------- measure what actually came out, and build the reel timeline ---------- */

  const probe = await run("ffprobe", [
    "-v", "error",
    "-select_streams", "v:0",
    "-count_packets",
    "-show_entries", "stream=nb_read_packets",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    cutPath,
  ]);
  const [sourceFrames, cutDuration] = probe.trim().split("\n");
  console.log(`Cut: ${cutDuration}s, ${sourceFrames} frames at 60fps`);

  /**
   * Segment boundaries on the reel timeline. Derived from the requested durations
   * rather than the file, so a frame of rounding in the encode can't shift a cut onto
   * the wrong side of a word.
   */
  let offset = 0;
  const segments = def.segments.map((segment) => {
    // Same arithmetic the cut used, halved to the reel's rate.
    const durationInFrames = Math.round((segment.end - segment.start) * FPS);
    const entry = { fromFrame: offset, durationInFrames, shot: segment.shot };
    offset += durationInFrames;
    return entry;
  });
  const pictureFrames = offset;

  /* ---------- rebase the word timings onto that timeline ---------- */

  const captions: CaptionWord[] = [];
  def.segments.forEach((segment, i) => {
    const shift = segments[i].fromFrame / FPS - segment.start;
    for (const raw of words) {
      const fix = def.wordFixes?.find(
        (f) => Math.abs(f.t - raw.t) < 0.005 && (!f.match || f.match === raw.w),
      );
      const word = fix
        ? { ...raw, t: fix.at ?? raw.t, d: fix.d ?? raw.d, w: fix.w ?? raw.w }
        : raw;
      if (word.t + word.d <= segment.start || word.t >= segment.end) continue;
      // A word straddling a cut is clipped to the span rather than dropped — losing it
      // leaves a visible hole in the line.
      const start = Math.max(word.t, segment.start);
      const end = Math.min(word.t + word.d, segment.end);
      captions.push({
        t: +(start + shift).toFixed(3),
        d: +(end - start).toFixed(3),
        w: word.w,
        // The first word of every span starts a new caption page: it is a new shot and
        // usually a new sentence.
        br: word.br || start === segment.start,
      });
    }
  });

  writeFileSync(
    "src/reel/data/current.json",
    JSON.stringify(
      {
        slug: def.slug,
        title: def.title,
        cutFile: `reel/${cutName}`,
        segments,
        pictureFrames,
        captions,
        artist: def.artist,
        episodeLabel: def.episodeLabel,
        cta: def.cta,
      },
      null,
      2,
    ),
  );

  const total = (pictureFrames / FPS + END_CARD_SECONDS).toFixed(2);
  console.log(
    `Reel timeline: ${(pictureFrames / FPS).toFixed(2)}s picture ` +
      `+ ${END_CARD_SECONDS}s end card = ${total}s, ${captions.length} words`,
  );

  if (cutOnly) {
    console.log("--cut-only: stopping before the render.");
    return;
  }

  /* ---------- stage 2: render ---------- */

  const outPath = join("out/reels", `WH REEL - ${def.title}.mp4`);
  const rendered = join(workDir, "rendered.mp4");
  console.log(`Rendering ${outPath}...`);
  await run("npx", [
    "remotion", "render", "SessionReel", rendered,
    "--codec", "h264",
    "--crf", "18",
    "--concurrency", "4",
  ]);

  /**
   * Remotion's mux does not compensate the AAC encoder's priming, so the finished
   * file's sound sits 2048 samples (42.7ms) behind its picture. Measured, not
   * assumed: picture lands exactly on the grid and only the audio moves. It is in the
   * forgiving direction — late is detectable at ~125ms against ~45ms for early — but
   * it is a known constant, so it gets corrected rather than shipped.
   *
   * A stream-copy remux, so nothing is re-encoded.
   */
  const AAC_PRIMING_SECONDS = 0.0427;
  console.log(`Correcting ${(AAC_PRIMING_SECONDS * 1000).toFixed(1)}ms of AAC priming...`);
  await run("ffmpeg", [
    "-y", "-v", "error",
    "-i", rendered,
    "-itsoffset", (-AAC_PRIMING_SECONDS).toFixed(4), "-i", rendered,
    "-map", "0:v", "-map", "1:a",
    "-c", "copy", "-movflags", "+faststart",
    outPath,
  ]);
  console.log(`Done: ${outPath}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
