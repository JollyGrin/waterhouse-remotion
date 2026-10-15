// FORT RIDDIM promo card: write the billing over Manuel's animated disc.
//
//   bun scripts/fort-riddim/promo.ts            everything
//   bun scripts/fort-riddim/promo.ts --no-prep  skip the background transcode
//   bun scripts/fort-riddim/promo.ts --voice X  lettering voice: liquid (default), caption,
//                                               or any key from src/fort-riddim/promoVoices.tsx
//
// The brief was lettering and nothing else, so the picture is re-encoded once (CRF 14,
// visually lossless) and the original audio stream is copied through untouched. The
// cards and the beat grid live in src/fort-riddim/promo.ts.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { CARDS, FPS } from "../../src/fort-riddim/promo";

const SOURCE = "/Users/manuel/Desktop/FORTRIDDIMPROMO.MP4";
const BG = "public/fort-riddim/promo.mp4";
const WORK = "work/fort-riddim";
const argv = process.argv.slice(2);
const args = new Set(argv);
const vi = argv.indexOf("--voice");
const voice = args.has("--caption") ? "caption" : vi >= 0 ? argv[vi + 1] : "liquid";
const OUT = `out/reels/FORT RIDDIM - promo${voice === "liquid" ? "" : ` (${voice})`}.mp4`;

const run = (cmd: string, argv: string[]) =>
  new Promise<void>((resolve, reject) => {
    const p = spawn(cmd, argv, { stdio: "inherit" });
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
  });

async function main() {
  if (!args.has("--no-prep") && !existsSync(BG)) {
    console.log("Transcoding background...");
    await run("ffmpeg", [
      "-y", "-v", "error", "-i", SOURCE, "-map", "0:v:0",
      // Short GOPs so OffthreadVideo's seeks stay cheap.
      "-c:v", "libx264", "-preset", "slow", "-crf", "14", "-g", "15", "-pix_fmt", "yuv420p", "-an", BG,
    ]);
  }

  mkdirSync(WORK, { recursive: true });
  mkdirSync("out/reels", { recursive: true });
  const picture = join(WORK, `promo-picture-${voice}.mp4`);
  await run("npx", [
    "remotion", "render", "FortRiddimPromo", picture,
    "--props", JSON.stringify({ voice }),
    "--codec", "h264", "--crf", "16", "--concurrency", "4", "--muted",
  ]);

  // Original audio, copied not re-encoded.
  await run("ffmpeg", [
    "-y", "-v", "error", "-i", picture, "-i", SOURCE,
    "-map", "0:v:0", "-map", "1:a:0", "-c", "copy", "-movflags", "+faststart", OUT,
  ]);

  console.log(`Done: ${OUT}`);
  for (const c of CARDS) {
    console.log(`  ${c.start.toFixed(2)}s  f${Math.round(c.start * FPS)}  ${c.id}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
