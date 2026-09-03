#!/usr/bin/env bun
/**
 * Fetch the Kenney CC0 audio packs and copy out the handful of one-shots the
 * PullUp soundtrack uses.
 *
 *   bun run fetch:kenney
 *
 * The selected source files are committed under public/audio/pullup/kenney/,
 * so a fresh clone does NOT need to run this - `bun run gen:audio` rebuilds
 * everything from the committed sources. Run this only to re-download the
 * packs or to change which sounds are picked.
 *
 * All three packs are Creative Commons Zero (CC0) by Kenney (kenney.nl).
 * See public/audio/pullup/CREDITS.md.
 */

import { execSync } from "child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from "fs";

const PACKS = [
  { slug: "ui-audio", title: "UI Audio" },
  { slug: "interface-sounds", title: "Interface Sounds" },
  { slug: "impact-sounds", title: "Impact Sounds" },
];

// The one-shots actually used, and why. Only these get committed.
const PICKS = [
  {
    pack: "impact-sounds",
    file: "impactSoft_heavy_000.ogg",
    as: "impact-soft-heavy.ogg",
    why: "frame-0 thud - low and soft, 48dB more energy below 200Hz than above 2kHz, no metallic ring",
  },
  {
    pack: "interface-sounds",
    file: "pluck_001.ogg",
    as: "pluck.ogg",
    why: "arrival pop - bright, no low end; pitched down stepwise for the six friends",
  },
  {
    pack: "interface-sounds",
    file: "tick_001.ogg",
    as: "tick.ogg",
    why: "viewer counter increment - 23ms, high-biased",
  },
  {
    pack: "interface-sounds",
    file: "confirmation_001.ogg",
    as: "confirmation.ogg",
    why: "chat bubble - soft two-tone notification",
  },
];

const TMP = "/tmp/waterhouse-kenney";
const DEST = "public/audio/pullup/kenney";

function sh(cmd: string): string {
  return execSync(cmd, {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/**
 * The download link is not a plain anchor on the asset page - it lives in the
 * "continue without donating" element inside the donation modal.
 */
function resolveZipUrl(slug: string): string {
  const page = `${TMP}/${slug}.html`;
  sh(`curl -sL --max-time 60 "https://kenney.nl/assets/${slug}" -o ${page}`);
  const html = readFileSync(page, "utf-8");
  const m = html.match(/id='donate-text'\s+href='([^']+\.zip)'/);
  if (!m) {
    throw new Error(
      `could not find the download link on kenney.nl/assets/${slug} - the page layout may have changed`,
    );
  }
  return m[1];
}

function main() {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
  mkdirSync(DEST, { recursive: true });

  for (const pack of PACKS) {
    const url = resolveZipUrl(pack.slug);
    console.log(`${pack.title}\n  ${url}`);
    sh(`curl -sL --max-time 300 "${url}" -o ${TMP}/${pack.slug}.zip`);
    sh(`unzip -qo ${TMP}/${pack.slug}.zip -d ${TMP}/${pack.slug}`);
  }

  console.log("\nCopying the sounds actually used:");
  for (const pick of PICKS) {
    const found = sh(
      `find ${TMP}/${pick.pack} -type f -name '${pick.file}' | head -1`,
    ).trim();
    if (!found || !existsSync(found)) {
      throw new Error(`${pick.file} not found in the ${pick.pack} pack`);
    }
    copyFileSync(found, `${DEST}/${pick.as}`);
    console.log(`  ${pick.as}  <- ${pick.pack}/${pick.file}`);
    console.log(`      ${pick.why}`);
  }

  // Keep the pack licence texts next to the audio.
  for (const pack of PACKS) {
    const lic = sh(
      `find ${TMP}/${pack.slug} -maxdepth 2 -iname 'License.txt' | head -1`,
    ).trim();
    if (lic) {
      copyFileSync(lic, `${DEST}/License-${pack.slug}.txt`);
    }
  }

  rmSync(TMP, { recursive: true, force: true });
  console.log(`\nDone. Sources in ${DEST}/ - now run: bun run gen:audio`);
}

main();
