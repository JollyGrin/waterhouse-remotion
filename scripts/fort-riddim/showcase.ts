// FORT RIDDIM DJ showcase: slide one of the Instagram carousel.
//
//   bun scripts/fort-riddim/showcase.ts
//
// Same disc, lettering and beat grid as the promo card, re-cut to 4:5 and five bars.
// Carousels lock every slide to the ratio of the first, so the DJ slides behind this one
// have to be 1080x1350 too. The audio is the promo's own, copied through and cut on the
// downbeat that ends the picture.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { CARDS, DURATION, FPS } from "../../src/fort-riddim/showcase";

const SOURCE = "/Users/manuel/Desktop/FORTRIDDIMPROMO.MP4";
const BG = "public/fort-riddim/promo.mp4";
const WORK = "work/fort-riddim";
const OUT = "out/posts/FORT RIDDIM - DJ showcase.mp4";

const run = (cmd: string, argv: string[]) =>
  new Promise<void>((resolve, reject) => {
    const p = spawn(cmd, argv, { stdio: "inherit" });
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
  });

async function main() {
  if (!existsSync(BG)) throw new Error(`missing ${BG} — run the promo script first`);
  mkdirSync(WORK, { recursive: true });
  mkdirSync("out/posts", { recursive: true });

  const picture = join(WORK, "showcase-picture.mp4");
  await run("npx", [
    "remotion", "render", "FortRiddimShowcase", picture,
    "--codec", "h264", "--crf", "16", "--concurrency", "4", "--muted",
    // Pulling frames out of the disc occasionally runs past the 30s default.
    "--timeout", "120000",
  ]);

  await run("ffmpeg", [
    "-y", "-v", "error", "-i", picture, "-i", SOURCE,
    "-map", "0:v:0", "-map", "1:a:0", "-c", "copy", "-shortest",
    "-movflags", "+faststart", OUT,
  ]);

  console.log(`Done: ${OUT}  ${DURATION.toFixed(2)}s  1080x1350`);
  for (const c of CARDS) {
    console.log(`  ${c.start.toFixed(2)}s  f${Math.round(c.start * FPS)}  ${c.id}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
