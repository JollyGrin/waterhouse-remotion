// Bookend a finished session episode with the Waterhouse logo reveal.
//
//   bun scripts/session/make-bookends.ts <source.mp4> <out.mp4>
//
// The source is already a finished edit — captions, watermark, lower-third and
// ticker are burned in. Nothing here touches the picture: no crop, no scale, no
// grade, no cutting, no reframing.
//
// Only the first and last five seconds go through Remotion, because only those need
// the video masked inside the mark. The 23 minutes in between are taken straight from
// the source. Everything is joined in one ffmpeg pass, so the middle is encoded
// exactly once — re-rendering 86,000 frames through Chrome to add two bookends would
// be both slow and a needless extra generation.

import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import {
  AUDIO_FADE_SECONDS,
  CLOSE,
  FPS,
  OPEN,
  TAIL_SECONDS,
} from "../../src/session/theme";

const [source, output] = process.argv.slice(2);
if (!source || !output) {
  console.error("usage: bun scripts/session/make-bookends.ts <source> <output>");
  process.exit(1);
}

const OPEN_CLIP = "work/open.mov";
const CLOSE_CLIP = "work/close.mov";

const run = (cmd: string, args: string[], label: string) =>
  new Promise<void>((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ["ignore", "inherit", "inherit"] });
    proc.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${label} failed (${code})`)),
    );
  });

const probe = (args: string[]) =>
  execFileSync("ffprobe", ["-v", "error", ...args], { encoding: "utf8" }).trim();

const sourceDuration = Number(
  probe(["-show_entries", "format=duration", "-of", "csv=p=0", source]),
);
const hasSubtitles =
  probe(["-select_streams", "s", "-show_entries", "stream=index", "-of", "csv=p=0", source])
    .length > 0;

const openSeconds = OPEN.durationInFrames / FPS;
const closeSeconds = CLOSE.durationInFrames / FPS;
const closeStart = sourceDuration - closeSeconds;
const total = sourceDuration + TAIL_SECONDS;

// No --props override: each composition's defaultProps already name the right clip
// via staticFile(), which resolves under /public/. Passing a raw path here instead
// produces a URL the bundle does not serve.
const renderClip = (id: string, out: string) =>
  run(
    "npx",
    [
      "remotion", "render", "src/index.ts", id, out,
      // ProRes for the bookends so the masked edges survive to the final encode
      // without being compressed twice.
      "--codec", "prores", "--prores-profile", "hq",
      "--log", "error",
    ],
    id,
  );

/**
 * Cut the five seconds at each end out of the episode and into public/.
 *
 * Remotion copies the entire public directory into its bundle on every render, so
 * putting the 4 GB master there would copy 4 GB twice to use ten seconds of it.
 * Encoded near-lossless (CRF 12) since they go through one more encode in the
 * assembly.
 */
const extractEnds = async () => {
  mkdirSync("public/session", { recursive: true });
  const common = [
    "-map", "0:v:0", "-map", "0:a:0",
    "-c:v", "libx264", "-preset", "slow", "-crf", "12",
    "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "256k", "-y",
  ];
  await run(
    "ffmpeg",
    ["-hide_banner", "-v", "error", "-t", String(openSeconds), "-i", source,
      ...common, "public/session/head.mp4"],
    "extract head",
  );
  await run(
    "ffmpeg",
    ["-hide_banner", "-v", "error", "-ss", closeStart.toFixed(3), "-i", source,
      "-t", String(closeSeconds), ...common, "public/session/tail.mp4"],
    "extract tail",
  );
};

const main = async () => {
  mkdirSync("work", { recursive: true });

  // Always regenerate. These intermediates have fixed names, so reusing whatever
  // happens to be on disk would silently give a new episode the previous episode's
  // bookends. Re-extracting and re-rendering costs ~2 minutes against a ~10 minute
  // assembly, which is not worth the risk of shipping the wrong footage.
  rmSync(OPEN_CLIP, { force: true });
  rmSync(CLOSE_CLIP, { force: true });

  console.log("extracting ends...");
  await extractEnds();

  console.log("rendering open...");
  await renderClip("SessionOpen", OPEN_CLIP);

  console.log("rendering close...");
  await renderClip("SessionClose", CLOSE_CLIP);

  // The output timeline maps 1:1 onto the source, so the soft subtitle track stays
  // valid and can be carried straight over.
  const filter = [
    `[1:v]trim=start=${openSeconds}:end=${closeStart.toFixed(3)},setpts=PTS-STARTPTS[mv];`,
    `[1:a]atrim=start=${openSeconds}:end=${closeStart.toFixed(3)},asetpts=PTS-STARTPTS[ma];`,
    `[0:v][0:a][mv][ma][2:v][2:a]concat=n=3:v=1:a=1[cv][ca];`,
    `[cv]tpad=stop_mode=add:stop_duration=${TAIL_SECONDS}:color=black[v];`,
    `[ca]apad=pad_dur=${TAIL_SECONDS},`,
    `afade=t=in:st=0:d=${AUDIO_FADE_SECONDS},`,
    `afade=t=out:st=${closeStart.toFixed(3)}:d=${(closeSeconds - 0.5).toFixed(3)}[a]`,
  ].join("");

  console.log(`\nsource     ${(sourceDuration / 60).toFixed(2)} min`);
  console.log(`output     ${(total / 60).toFixed(2)} min  (+${TAIL_SECONDS}s black tail)`);
  console.log(`close at   ${closeStart.toFixed(1)}s`);
  console.log(`subtitles  ${hasSubtitles ? "passed through" : "none found"}`);
  console.log("assembling...");

  await run(
    "ffmpeg",
    [
      "-hide_banner", "-v", "warning", "-stats",
      "-i", OPEN_CLIP,
      "-i", source,
      "-i", CLOSE_CLIP,
      "-filter_complex", filter,
      "-map", "[v]", "-map", "[a]",
      ...(hasSubtitles ? ["-map", "1:s:0", "-c:s", "mov_text"] : []),
      "-c:v", "libx264", "-preset", "fast", "-crf", "16",
      "-pix_fmt", "yuv420p",
      "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709",
      "-c:a", "aac", "-b:a", "192k",
      "-movflags", "+faststart",
      "-t", total.toFixed(3),
      "-y", output,
    ],
    "assemble",
  );

  console.log(`\ndone -> ${output}`);
};

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
