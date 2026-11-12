#!/usr/bin/env bun
/**
 * Build the intro sesh-edit prepends to edited Sessions videos (Fuse 16:9, #38).
 *
 *   bun run render:intro            # render Fuse, then write the three files below
 *   bun run render:intro --reuse    # skip the Remotion render if out/ident/IdentFuse-16x9.mov exists
 *
 * Writes into longform/src/sesh_edit/assets/intro/ (gitignored, bundled into the
 * sesh-edit wheel through hatch `artifacts`):
 *   fuse-16x9.webm   VP9 yuva420p with alpha, no audio
 *   fuse-16x9.flac   the soundtrack (sesh-edit reads audio from this sidecar)
 *   fuse-16x9.json   {"open_s": ...}: where the interview starts showing through
 *
 * The ProRes 4444 master comes from `render:ident` (out/ident/IdentFuse-16x9.mov).
 * The webm is encoded with no extra colour flags: ffmpeg carries the master's tags
 * over as they are (bt709 primaries, sRGB transfer, no matrix). Tagging the matrix
 * bt709 made decoders convert it differently. A 5 s render is fine on a laptop.
 * Windows-safe: no shell. Needs an ffmpeg with flac on PATH (Remotion's bundled one
 * has no flac encoder); sesh-edit needs ffmpeg on PATH anyway.
 */

import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { ffEnv, pathBin } from "./lib/ff";
import { renderCommand, run } from "./render-ident";
import { hasAlpha, probeVideo } from "./render-bumper";

export const INTRO_COMP = "IdentFuse-16x9";
export const INTRO_DIR = join("longform", "src", "sesh_edit", "assets", "intro");
export const INTRO_STEM = "fuse-16x9";
/** Fuse frame where the rings start to open onto the interview, at the comp's 30 fps. */
export const OPEN_FRAME = 118;
export const FPS = 30;

export function sidecar(): { open_s: number; note: string } {
  return {
    open_s: Number((OPEN_FRAME / FPS).toFixed(6)),
    note: `frame ${OPEN_FRAME} at ${FPS} fps: the rings start to open onto the interview`,
  };
}

/** The two ffmpeg command lines that turn the ProRes master into the webm and the flac. */
export function encodeCommands(ffmpeg: string, mov: string, dir = INTRO_DIR): { webm: string[]; flac: string[] } {
  const base = [ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", mov];
  return {
    webm: [
      ...base,
      "-an",
      "-c:v", "libvpx-vp9",
      "-pix_fmt", "yuva420p",
      "-crf", "30",
      "-b:v", "0",
      "-auto-alt-ref", "0",
      join(dir, `${INTRO_STEM}.webm`),
    ],
    flac: [...base, "-vn", "-c:a", "flac", "-sample_fmt", "s16", "-ar", "48000", join(dir, `${INTRO_STEM}.flac`)],
  };
}

async function ff(cmd: string[]): Promise<void> {
  console.log(`\n$ ${cmd.join(" ")}`);
  const child = Bun.spawn(cmd, { stdin: "ignore", stdout: "inherit", stderr: "inherit", env: ffEnv(cmd[0]) });
  const code = await child.exited;
  if (code !== 0) throw new Error(`ffmpeg exited with ${code}`);
}

async function main() {
  const argv = process.argv.slice(2);
  const bad = argv.filter((a) => a !== "--reuse");
  if (bad.length) {
    console.error(`Unknown argument ${bad[0]}.\nUsage: bun run render:intro [--reuse]`);
    process.exit(1);
  }
  const ffmpeg = pathBin("ffmpeg");
  if (!ffmpeg) {
    throw new Error("ffmpeg not found on PATH. Install it (macOS: brew install ffmpeg, Windows: winget install ffmpeg) and re-run.");
  }

  const { cmd, file: mov } = renderCommand(INTRO_COMP, "prores");
  if (argv.includes("--reuse") && existsSync(mov)) console.log(`Reusing ${mov}`);
  else {
    mkdirSync(join("out", "ident"), { recursive: true });
    await run(cmd);
  }

  mkdirSync(INTRO_DIR, { recursive: true });
  const enc = encodeCommands(ffmpeg, mov);
  await ff(enc.webm);
  await ff(enc.flac);
  const json = join(INTRO_DIR, `${INTRO_STEM}.json`);
  writeFileSync(json, `${JSON.stringify(sidecar())}\n`);

  const webm = enc.webm[enc.webm.length - 1];
  const probe = probeVideo(webm);
  if (!probe) console.log("(ffprobe not found - alpha not verified.)");
  else if (!hasAlpha(probe, "webm")) throw new Error(`${webm} is ${probe.codec}/${probe.pixFmt}: no alpha channel.`);
  else console.log(`\nAlpha OK: ${webm} ${probe.codec}`);
  console.log(`Done: ${webm}, ${enc.flac[enc.flac.length - 1]}, ${json}`);
}

if (/render-intro\.ts$/.test(process.argv[1] ?? "")) {
  main().catch((err) => {
    console.error("Error:", err);
    process.exit(1);
  });
}
