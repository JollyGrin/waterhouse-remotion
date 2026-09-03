#!/usr/bin/env bun
/**
 * Generate the PullUp soundtrack procedurally with ffmpeg.
 *
 *   bun scripts/gen-audio.ts
 *
 * Everything is synthesised from ffmpeg primitives (aevalsrc / anoisesrc +
 * afade / lowpass / highpass / bandpass / volume) with fixed noise seeds, so
 * the output is deterministic, license-free and reproducible. No downloads.
 *
 * The soundtrack is ENVIRONMENTAL on purpose: the same clip is rendered for
 * every artist and every genre, so there is no key, no melody, no tempo and
 * no percussion that could clash with a DJ's set. Room tone and weight only.
 *
 * Output: public/audio/pullup/*.wav (48kHz mono pcm_s16le). The wavs are
 * committed, so rendering never depends on running this script.
 */

import { execSync } from "child_process";
import { mkdirSync, rmSync } from "fs";

const OUT_DIR = "public/audio/pullup";
const TMP_DIR = "/tmp/waterhouse-pullup-audio";
const SR = 48000;

// The composition is 300 frames at 30fps.
const CLIP_SECONDS = 10;
// Seconds of crossfade used to wrap the looping beds onto themselves.
const WRAP = 1;
// Fade at each edge of a looping bed, in seconds. The rendered AAC track is
// ~48ms longer than the video and carries a decoder priming offset, so the
// exact boundary sample is not under our control; fading the bed to silence
// across 40ms at both edges makes the whole boundary region quiet, which is
// what actually removes the click. 40ms of room tone ramping is well under
// the ear's level-integration time and cannot be heard as a dip.
const EDGE_FADE = 0.04;

function sh(cmd: string): string {
  return execSync(cmd, {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function ff(args: string): void {
  execSync(`ffmpeg -hide_banner -loglevel error -y ${args}`, {
    stdio: ["ignore", "inherit", "inherit"],
  });
}

/**
 * Phase term for a linear frequency sweep from f0 to f1 over `dur` seconds,
 * holding f1 afterwards so the oscillator never runs backwards through zero.
 */
function sweepPhase(f0: number, f1: number, dur: number): string {
  const u = `min(t\\,${dur})`;
  const k = (f1 - f0) / (2 * dur);
  return `${f0}*${u}+(${k})*${u}*${u}+${f1}*(t-${u})`;
}

function sweep(f0: number, f1: number, dur: number, decay: number): string {
  return `exp(-t*${decay})*sin(2*PI*(${sweepPhase(f0, f1, dur)}))`;
}

/** Peak-normalise a file to `targetDb` dBFS. */
function normalizePeak(file: string, targetDb: number): number {
  const probe = sh(
    `ffmpeg -hide_banner -i ${file} -af volumedetect -f null - 2>&1 || true`,
  );
  const m = probe.match(/max_volume:\s*(-?[\d.]+) dB/);
  if (!m) {
    throw new Error(`could not read peak level of ${file}`);
  }
  const peak = parseFloat(m[1]);
  const gain = targetDb - peak;
  ff(
    `-i ${file} -af "volume=${gain.toFixed(3)}dB" -c:a pcm_s16le -ar ${SR} -ac 1 ${file}.norm.wav`,
  );
  ff(`-i ${file}.norm.wav -c:a copy ${file}`);
  rmSync(`${file}.norm.wav`, { force: true });
  return gain;
}

/**
 * Make a noise-based bed loop seamlessly. Renders `CLIP_SECONDS + WRAP`
 * seconds, then folds the overhanging tail back over the head with an
 * equal-power crossfade. The result is exactly CLIP_SECONDS long and its
 * last sample runs continuously into its first.
 */
function wrapLoop(src: string, dst: string): void {
  const head = WRAP;
  const tail = CLIP_SECONDS;
  ff(
    `-i ${src} -filter_complex "` +
      `[0:a]atrim=0:${head},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=${head}:curve=qsin[a];` +
      `[0:a]atrim=${tail}:${tail + head},asetpts=PTS-STARTPTS,afade=t=out:st=0:d=${head}:curve=qsin[b];` +
      `[a][b]amix=inputs=2:normalize=0[x];` +
      `[0:a]atrim=${head}:${tail},asetpts=PTS-STARTPTS[y];` +
      `[x][y]concat=n=2:v=0:a=1,` +
      // 4ms of fade at each edge. The AAC decoder forces the first decoded
      // sample to zero, so without this the bed's non-zero final sample
      // leaves a ~-36 dBFS step at the wrap. A 4ms dip is far below the
      // ear's level-integration time; a one-sample step is not.
      `afade=t=in:st=0:d=${EDGE_FADE},afade=t=out:st=${CLIP_SECONDS - EDGE_FADE}:d=${EDGE_FADE}[out]" ` +
      `-map "[out]" -c:a pcm_s16le -ar ${SR} -ac 1 -t ${CLIP_SECONDS} ${dst}`,
  );
}

// --- BED: sub drone + dark room tone -------------------------------------
//
// Both drone partials are at integer frequencies, so they complete a whole
// number of cycles in 10s and loop with no discontinuity. The brown noise is
// wrapped with the crossfade above.
function buildBed(): void {
  const dur = CLIP_SECONDS + WRAP;

  // 47Hz and 52Hz beat against each other at 5Hz, which repeats every 0.2s -
  // an exact divisor of the clip, so the beat pattern loops too.
  ff(
    `-f lavfi -i "aevalsrc='0.62*sin(2*PI*47*t)+0.38*sin(2*PI*52*t)':s=${SR}:d=${dur}:c=mono" ` +
      `-af "lowpass=f=120" -c:a pcm_s16le -ar ${SR} -ac 1 ${TMP_DIR}/bed-sub.wav`,
  );

  ff(
    `-f lavfi -i "anoisesrc=c=brown:r=${SR}:d=${dur}:a=0.9:seed=1701" ` +
      `-af "lowpass=f=300,lowpass=f=300,highpass=f=25" ` +
      `-c:a pcm_s16le -ar ${SR} -ac 1 ${TMP_DIR}/bed-noise.wav`,
  );

  ff(
    `-i ${TMP_DIR}/bed-sub.wav -i ${TMP_DIR}/bed-noise.wav ` +
      `-filter_complex "[0:a]volume=0.85[s];[1:a]volume=0.55[n];[s][n]amix=inputs=2:normalize=0[out]" ` +
      `-map "[out]" -c:a pcm_s16le -ar ${SR} -ac 1 ${TMP_DIR}/bed-mix.wav`,
  );

  wrapLoop(`${TMP_DIR}/bed-mix.wav`, `${OUT_DIR}/bed.wav`);
}

// --- PRESENCE: the room getting warmer as people arrive -------------------
//
// Constant level on disk; the composition drives its volume from the viewer
// count schedule. Band-passed noise with a slow tremolo so it breathes; the
// tremolo runs at 0.3Hz, i.e. exactly 3 cycles per clip, so it loops.
function buildPresence(): void {
  const dur = CLIP_SECONDS + WRAP;
  ff(
    `-f lavfi -i "anoisesrc=c=pink:r=${SR}:d=${dur}:a=0.9:seed=2911" ` +
      `-af "highpass=f=200,lowpass=f=2000,bandpass=f=700:w=1400,tremolo=f=0.3:d=0.35,volume=24dB" ` +
      `-c:a pcm_s16le -ar ${SR} -ac 1 ${TMP_DIR}/presence-raw.wav`,
  );
  wrapLoop(`${TMP_DIR}/presence-raw.wav`, `${OUT_DIR}/presence.wav`);
}

// --- SFX ------------------------------------------------------------------

/** Frame 0 impact: 120 -> 40Hz sine drop plus a soft noise burst. */
function buildThud(): void {
  ff(
    `-f lavfi -i "aevalsrc='${sweep(120, 40, 0.15, 16)}':s=${SR}:d=0.45:c=mono" ` +
      `-c:a pcm_s16le -ar ${SR} -ac 1 ${TMP_DIR}/thud-sine.wav`,
  );
  ff(
    `-f lavfi -i "anoisesrc=c=brown:r=${SR}:d=0.2:a=0.9:seed=3307" ` +
      `-af "lowpass=f=900,afade=t=out:st=0:d=0.18:curve=exp,volume=0.5" ` +
      `-c:a pcm_s16le -ar ${SR} -ac 1 ${TMP_DIR}/thud-noise.wav`,
  );
  ff(
    `-i ${TMP_DIR}/thud-sine.wav -i ${TMP_DIR}/thud-noise.wav ` +
      `-filter_complex "[0:a][1:a]amix=inputs=2:normalize=0,afade=t=out:st=0.4:d=0.05[out]" ` +
      `-map "[out]" -c:a pcm_s16le -ar ${SR} -ac 1 ${OUT_DIR}/thud.wav`,
  );
}

/** A short blip with a pitch drop. YOU gets the brightest one. */
function buildPop(name: string, f0: number, decay: number): void {
  const f1 = f0 * 0.56;
  ff(
    `-f lavfi -i "aevalsrc='${sweep(f0, f1, 0.07, decay)}':s=${SR}:d=0.22:c=mono" ` +
      `-af "highpass=f=180,lowpass=f=4000,afade=t=out:st=0.18:d=0.04" ` +
      `-c:a pcm_s16le -ar ${SR} -ac 1 ${OUT_DIR}/${name}.wav`,
  );
}

/** Viewer counter increment: a tiny click, barely there. */
function buildClick(): void {
  ff(
    `-f lavfi -i "anoisesrc=c=white:r=${SR}:d=0.03:a=0.9:seed=5501" ` +
      `-af "highpass=f=1800,lowpass=f=6000,afade=t=out:st=0:d=0.028:curve=exp" ` +
      `-c:a pcm_s16le -ar ${SR} -ac 1 ${OUT_DIR}/click.wav`,
  );
}

/** Chat bubble: a soft two-tone tick, like a muted notification. */
function buildMsg(): void {
  // Soft attack (no click) then a gentle decay, twice, a semitone-free
  // interval apart so it reads as a UI tick rather than a musical note.
  const tone = (f: number) => `(1-exp(-t*260))*exp(-t*26)*sin(2*PI*${f}*t)`;
  ff(
    `-f lavfi -i "aevalsrc='${tone(640)}':s=${SR}:d=0.09:c=mono" ` +
      `-c:a pcm_s16le -ar ${SR} -ac 1 ${TMP_DIR}/msg-a.wav`,
  );
  ff(
    `-f lavfi -i "aevalsrc='${tone(880)}':s=${SR}:d=0.16:c=mono" ` +
      `-c:a pcm_s16le -ar ${SR} -ac 1 ${TMP_DIR}/msg-b.wav`,
  );
  ff(
    `-i ${TMP_DIR}/msg-a.wav -i ${TMP_DIR}/msg-b.wav ` +
      `-filter_complex "[0:a][1:a]concat=n=2:v=0:a=1,lowpass=f=3200,volume=0.8[out]" ` +
      `-map "[out]" -c:a pcm_s16le -ar ${SR} -ac 1 ${OUT_DIR}/msg.wav`,
  );
}

/**
 * Loop seam: the room emptying. ffmpeg's lowpass has a fixed cutoff, so the
 * downward sweep is built by layering three bands whose fades are staggered -
 * the top band leaves first, the bottom band last. Ends at digital silence
 * so the wrap point is clean.
 */
function buildWhoosh(): void {
  const bands: Array<[string, string, number, number]> = [
    ["hi", "highpass=f=2200,lowpass=f=7000", 0.0, 0.34],
    ["mid", "bandpass=f=900:w=1200", 0.12, 0.42],
    ["lo", "lowpass=f=420,highpass=f=60", 0.24, 0.52],
  ];
  for (const [name, filt, st, d] of bands) {
    ff(
      `-f lavfi -i "anoisesrc=c=brown:r=${SR}:d=0.8:a=0.9:seed=770${name.length}" ` +
        `-af "${filt},afade=t=out:st=${st}:d=${d}:curve=qsin" ` +
        `-c:a pcm_s16le -ar ${SR} -ac 1 ${TMP_DIR}/whoosh-${name}.wav`,
    );
  }
  ff(
    `-i ${TMP_DIR}/whoosh-hi.wav -i ${TMP_DIR}/whoosh-mid.wav -i ${TMP_DIR}/whoosh-lo.wav ` +
      `-filter_complex "[0:a]volume=0.5[a];[1:a]volume=0.9[b];[2:a]volume=1.0[c];` +
      `[a][b][c]amix=inputs=3:normalize=0,afade=t=out:st=0.7:d=0.1[out]" ` +
      `-map "[out]" -c:a pcm_s16le -ar ${SR} -ac 1 ${OUT_DIR}/whoosh.wav`,
  );
}

// --- Level plan -----------------------------------------------------------
//
// SFX peaks anchor the mix; the bed sits ~28dB under them, as specified.
// MASTER_TRIM is applied uniformly to every target, so it moves the whole mix
// without disturbing any relationship inside it. +2.5dB puts the loudest hit
// (the thud) at -0.5 dBFS, which is all the headroom there is to take.
//
// Raising the mix further means raising the bed and presence *relative* to
// the SFX, which costs the "felt more than heard" character. Measured
// integrated loudness for the alternatives, if that trade is ever wanted:
//
//   bed/presence peak   integrated   bed below SFX peak
//   -31 / -17 (this)    -24.3 LUFS   28 dB
//   -25 / -11           -20.8 LUFS   22 dB
//   -21 /  -7           -17.5 LUFS   18 dB
//   -18 /  -4           -14.8 LUFS   15 dB
const MASTER_TRIM = 2.5;

const PEAKS: Record<string, number> = {
  thud: -3,
  "pop-you": -6,
  "pop-friend-0": -9,
  "pop-friend-1": -9.5,
  "pop-friend-2": -10,
  "pop-friend-3": -10.5,
  "pop-friend-4": -11,
  "pop-friend-5": -11.5,
  click: -22,
  msg: -13,
  whoosh: -11,
  bed: -31,
  presence: -17,
};

function main() {
  try {
    sh("ffmpeg -version");
  } catch {
    console.error("ffmpeg is required and was not found on PATH.");
    process.exit(1);
  }

  rmSync(TMP_DIR, { recursive: true, force: true });
  mkdirSync(TMP_DIR, { recursive: true });
  mkdirSync(OUT_DIR, { recursive: true });

  console.log("Generating PullUp soundtrack (procedural, ffmpeg only)\n");

  console.log("  bed.wav        sub drone 47/52Hz + brown room tone");
  buildBed();

  console.log("  presence.wav   band-passed room presence, breathing");
  buildPresence();

  console.log("  thud.wav       120->40Hz impact + noise burst");
  buildThud();

  console.log("  pop-you.wav    bright blip, 900->504Hz");
  buildPop("pop-you", 900, 34);

  // Each friend lands a little lower than the one before.
  for (let i = 0; i < 6; i++) {
    const f0 = Math.round(820 * Math.pow(0.93, i));
    console.log(`  pop-friend-${i}.wav  blip, ${f0}Hz`);
    buildPop(`pop-friend-${i}`, f0, 36);
  }

  console.log("  click.wav      counter tick");
  buildClick();

  console.log("  msg.wav        two-tone chat tick");
  buildMsg();

  console.log("  whoosh.wav     room emptying, downward band sweep");
  buildWhoosh();

  console.log("\nNormalising peaks:");
  const names = Object.keys(PEAKS);
  for (const name of names) {
    const target = PEAKS[name] + MASTER_TRIM;
    const gain = normalizePeak(`${OUT_DIR}/${name}.wav`, target);
    let label = name;
    while (label.length < 14) label += " ";
    console.log(
      `  ${label} -> ${target.toFixed(1)} dBFS (${gain >= 0 ? "+" : ""}${gain.toFixed(1)} dB)`,
    );
  }

  rmSync(TMP_DIR, { recursive: true, force: true });
  console.log(`\nDone. ${names.length} files in ${OUT_DIR}/`);
}

main();
