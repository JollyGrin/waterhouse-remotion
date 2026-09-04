#!/usr/bin/env bun
/**
 * Build the shared sound kit for the two "Who Showed Up" recap videos
 * (ArtistRecap and HouseWeekly).
 *
 *   bun run gen:audio:recap
 *
 * Same approach as scripts/gen-audio.ts, and the same two sources:
 *
 *  - The bed is synthesised from ffmpeg primitives (anoisesrc / afade /
 *    lowpass / highpass / volume) with fixed seeds, so it is deterministic.
 *  - The one-shots come from Kenney's CC0 packs, reusing the files already
 *    committed under public/audio/pullup/kenney/ rather than a second copy.
 *    See public/audio/recap/CREDITS.md.
 *
 * Two rules carried over from PullUp, for the same reasons:
 *
 *  - NO tonal component anywhere. No oscillator, no key, no tempo. A
 *    sustained sine reads as a whine on phone speakers, and these clips have
 *    to sit under a voice-free stat video for 25 seconds without tiring.
 *  - Weight comes from filtered noise, not from pitch. The low thump in
 *    slam.wav is brown noise under 70 Hz, not a sine.
 *
 * The helpers below are deliberately duplicated from gen-audio.ts instead of
 * imported: that script runs main() at module load, so importing it would
 * regenerate the whole PullUp soundtrack as a side effect.
 *
 * Output: public/audio/recap/*.wav (48kHz mono pcm_s16le), committed, so
 * rendering never depends on running this script.
 */

import { execSync } from "child_process";
import { existsSync, mkdirSync, rmSync } from "fs";

const OUT_DIR = "public/audio/recap";
const KENNEY_DIR = "public/audio/pullup/kenney";
const TMP_DIR = "/tmp/waterhouse-recap-audio";
const SR = 48000;

/**
 * Bed length. Both recaps are 25 s or shorter and will trim, so the extra
 * second is headroom rather than something anyone hears.
 */
const BED_SECONDS = 26;
/** Seconds of crossfade used to wrap the bed onto itself. */
const WRAP = 1;
const BED_FADE_IN = 0.5;
const BED_FADE_OUT = 1.5;

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

/** Deterministic RNG (mulberry32), so the grain lands the same way every run. */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A slow amplitude wander, +/- `depthDb`, built from low-frequency sines whose
 * periods all divide the clip exactly - so the wander itself loops. Nothing
 * here is audible as pitch: it only moves the level of a noise band.
 */
function wander(
  depthDb: number,
  parts: Array<[number, number, number]>,
): string {
  const expr = parts
    .map(
      ([hz, amp, phase]) =>
        `${amp.toFixed(3)}*sin(2*PI*${hz.toFixed(3)}*t+${phase.toFixed(3)})`,
    )
    .join("+");
  const depth = Math.pow(10, depthDb / 20) - 1;
  return `volume=volume='1+${depth.toFixed(4)}*(${expr})':eval=frame`;
}

/** Read a file's peak level in dBFS. */
function peakOf(file: string, from?: number, to?: number): number {
  const window =
    from === undefined || to === undefined ? "" : `-ss ${from} -t ${to - from}`;
  const probe = sh(
    `ffmpeg -hide_banner ${window} -i ${file} -af volumedetect -f null - 2>&1 || true`,
  );
  const m = probe.match(/max_volume:\s*(-?[\d.]+) dB/);
  if (!m) throw new Error(`could not read peak level of ${file}`);
  return parseFloat(m[1]);
}

/** Peak-normalise a file to `targetDb` dBFS, optionally on a window only. */
function normalizePeak(
  file: string,
  targetDb: number,
  from?: number,
  to?: number,
): number {
  const gain = targetDb - peakOf(file, from, to);
  ff(
    `-i ${file} -af "volume=${gain.toFixed(3)}dB" -c:a pcm_s16le -ar ${SR} -ac 1 ${file}.norm.wav`,
  );
  ff(`-i ${file}.norm.wav -c:a copy ${file}`);
  rmSync(`${file}.norm.wav`, { force: true });
  return gain;
}

/**
 * Fold the overhanging tail back over the head with an equal-power crossfade,
 * so the texture runs continuously into itself, then apply the asked-for edge
 * fades. The fades mean the file is not gapless-loopable end to end - but the
 * material underneath them is, so a loop never lands on a discontinuity, only
 * on a dip. Both recaps are shorter than the bed and trim before the tail.
 */
function wrapAndFade(src: string, dst: string, dur: number): void {
  ff(
    `-i ${src} -filter_complex "` +
      `[0:a]atrim=0:${WRAP},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=${WRAP}:curve=qsin[a];` +
      `[0:a]atrim=${dur}:${dur + WRAP},asetpts=PTS-STARTPTS,afade=t=out:st=0:d=${WRAP}:curve=qsin[b];` +
      `[a][b]amix=inputs=2:normalize=0[x];` +
      `[0:a]atrim=${WRAP}:${dur},asetpts=PTS-STARTPTS[y];` +
      `[x][y]concat=n=2:v=0:a=1,` +
      `afade=t=in:st=0:d=${BED_FADE_IN}:curve=qsin,` +
      `afade=t=out:st=${dur - BED_FADE_OUT}:d=${BED_FADE_OUT}:curve=qsin[out]" ` +
      `-map "[out]" -c:a pcm_s16le -ar ${SR} -ac 1 -t ${dur} ${dst}`,
  );
}

/** Convert a Kenney pack sound to mono 48k and trim the silence off its front. */
function fromKenney(src: string, dst: string, extra = "", seconds?: number) {
  const chain = [
    "silenceremove=start_periods=1:start_threshold=-55dB:start_silence=0:detection=peak",
    extra,
    "afade=t=in:st=0:d=0.002",
  ]
    .filter(Boolean)
    .join(",");
  ff(
    `-i ${KENNEY_DIR}/${src} -af "${chain}" ${seconds ? `-t ${seconds}` : ""} ` +
      `-c:a pcm_s16le -ar ${SR} -ac 1 ${OUT_DIR}/${dst}.wav`,
  );
}

function mixTo(dst: string, parts: Array<[string, number]>): void {
  const inputs = parts.map(([f]) => `-i ${f}`).join(" ");
  const chains = parts
    .map(([, g], i) => `[${i}:a]volume=${g.toFixed(3)}[v${i}]`)
    .join(";");
  const labels = parts.map((_, i) => `[v${i}]`).join("");
  ff(
    `${inputs} -filter_complex "${chains};${labels}amix=inputs=${parts.length}:normalize=0[out]" ` +
      `-map "[out]" -c:a pcm_s16le -ar ${SR} -ac 1 ${dst}`,
  );
}

// --- BED: texture only, and very quiet -------------------------------------

/**
 * Sparse vinyl-style grain: weight without pitch. Impulses are scripted
 * rather than gated, because gating a noise source yields 25-50 bursts/s
 * however high the threshold, which reads as a noise floor instead of grain.
 */
function buildGrain(dur: number, perSecond: number, name: string): string {
  const variants = 4;
  for (let v = 0; v < variants; v++) {
    ff(
      `-f lavfi -i "anoisesrc=c=white:r=${SR}:d=0.005:a=0.9:seed=${5200 + v}" ` +
        `-af "highpass=f=500,lowpass=f=2200,afade=t=out:st=0:d=0.005:curve=exp" ` +
        `-c:a pcm_s16le -ar ${SR} -ac 1 ${TMP_DIR}/${name}-v${v}.wav`,
    );
  }

  const rng = makeRng(5150);
  const hits: Array<{ v: number; ms: number }> = [];
  let t = 0.05;
  while (t < dur - 0.05) {
    hits.push({ v: Math.floor(rng() * variants), ms: Math.round(t * 1000) });
    // mean of (0.45 + U*1.25) is 1.075, so divide it out to hit perSecond.
    t += (0.45 + rng() * 1.25) / (1.075 * perSecond);
  }

  const inputs: string[] = [];
  for (let v = 0; v < variants; v++)
    inputs.push(`-i ${TMP_DIR}/${name}-v${v}.wav`);

  const useCount = [0, 0, 0, 0];
  for (const h of hits) useCount[h.v]++;

  const parts: string[] = [];
  for (let v = 0; v < variants; v++) {
    if (useCount[v] === 0) continue;
    const outs: string[] = [];
    for (let k = 0; k < useCount[v]; k++) outs.push(`[s${v}_${k}]`);
    parts.push(
      useCount[v] === 1
        ? `[${v}:a]anull${outs[0]}`
        : `[${v}:a]asplit=${useCount[v]}${outs.join("")}`,
    );
  }

  const seen = [0, 0, 0, 0];
  const labels: string[] = [];
  hits.forEach((h, i) => {
    const k = seen[h.v]++;
    const g = (0.45 + ((i * 7919) % 100) / 180).toFixed(3);
    parts.push(`[s${h.v}_${k}]adelay=${h.ms},volume=${g}[d${i}]`);
    labels.push(`[d${i}]`);
  });
  parts.push(
    `${labels.join("")}amix=inputs=${labels.length}:normalize=0,apad[gout]`,
  );

  ff(
    `${inputs.join(" ")} -filter_complex "${parts.join(";")}" ` +
      `-map "[gout]" -t ${dur} -c:a pcm_s16le -ar ${SR} -ac 1 ${TMP_DIR}/${name}.wav`,
  );
  console.log(
    `                 ${hits.length} grain impulses over ${dur}s (${(hits.length / dur).toFixed(1)}/s)`,
  );
  return `${TMP_DIR}/${name}.wav`;
}

/**
 * The bed is the PullUp texture pulled right back: brown room tone under
 * 220 Hz breathing +/-2 dB, plus grain at roughly a third of PullUp's density
 * so it reads as air rather than as crackle. It lands ~12 dB under the PullUp
 * beds, which is the whole point - these videos are numbers on screen, and
 * the bed must never compete with the one-shots that mark them.
 */
function buildBed(): void {
  const dur = BED_SECONDS + WRAP;

  ff(
    `-f lavfi -i "anoisesrc=c=brown:r=${SR}:d=${dur}:a=0.9:seed=2609" ` +
      `-af "lowpass=f=220,lowpass=f=220,highpass=f=25,` +
      wander(2, [
        [0.1153, 0.5, 0],
        [0.2308, 0.3, 1.7],
        [0.3846, 0.2, 3.1],
      ]) +
      `" -c:a pcm_s16le -ar ${SR} -ac 1 ${TMP_DIR}/bed-tone.wav`,
  );

  const grain = buildGrain(dur, 1.2, "bed-grain");

  mixTo(`${TMP_DIR}/bed-mix.wav`, [
    [`${TMP_DIR}/bed-tone.wav`, 1.0],
    [grain, 0.12],
  ]);
  wrapAndFade(`${TMP_DIR}/bed-mix.wav`, `${OUT_DIR}/bed.wav`, BED_SECONDS);
}

// --- ONE-SHOTS -------------------------------------------------------------

const IMPACT = `${KENNEY_DIR}/impact-soft-heavy.ogg`;
const TRIM =
  "silenceremove=start_periods=1:start_threshold=-55dB:start_silence=0:detection=peak";

/**
 * A low sub thump: brown noise squeezed under `cutoff` with a fast decay.
 * Noise, not a sine, so it has weight with no pitch - the same reason the
 * PullUp beds have no oscillator in them.
 */
function subThump(dst: string, cutoff: number, dur: number, seed: number) {
  ff(
    `-f lavfi -i "anoisesrc=c=brown:r=${SR}:d=${dur}:a=0.9:seed=${seed}" ` +
      `-af "lowpass=f=${cutoff},lowpass=f=${cutoff},afade=t=out:st=0.01:d=${(dur - 0.01).toFixed(3)}:curve=exp" ` +
      `-c:a pcm_s16le -ar ${SR} -ac 1 ${dst}`,
  );
}

/**
 * slam.wav - the hook name and the BEAT reveal.
 *
 * The Kenney impact has the right character but a long ringing tail that
 * reads as a gong, so it is rebuilt in layers exactly as PullUp's thud is:
 * a full-band attack that dies by 120 ms and a lowpassed body out to 260 ms.
 * A sub thump underneath makes it the heavier of the two impacts.
 */
function buildSlam(): void {
  ff(
    `-i ${IMPACT} -af "${TRIM},lowpass=f=1400,afade=t=out:st=0.03:d=0.09" -t 0.30 ` +
      `-c:a pcm_s16le -ar ${SR} -ac 1 ${TMP_DIR}/slam-attack.wav`,
  );
  ff(
    `-i ${IMPACT} -af "${TRIM},lowpass=f=180,lowpass=f=180,afade=t=out:st=0.10:d=0.16" -t 0.30 ` +
      `-c:a pcm_s16le -ar ${SR} -ac 1 ${TMP_DIR}/slam-body.wav`,
  );
  subThump(`${TMP_DIR}/slam-sub.wav`, 70, 0.3, 6601);

  mixTo(`${OUT_DIR}/slam.wav`, [
    [`${TMP_DIR}/slam-attack.wav`, 0.9],
    [`${TMP_DIR}/slam-body.wav`, 1.0],
    [`${TMP_DIR}/slam-sub.wav`, 0.55],
  ]);
}

/**
 * land.wav - a big number arriving. The same impact with the attack rolled
 * off and no sub, so it reads as a settle rather than a hit.
 */
function buildLand(): void {
  ff(
    `-i ${IMPACT} -af "${TRIM},lowpass=f=650,afade=t=out:st=0.04:d=0.12" -t 0.22 ` +
      `-c:a pcm_s16le -ar ${SR} -ac 1 ${TMP_DIR}/land-attack.wav`,
  );
  ff(
    `-i ${IMPACT} -af "${TRIM},lowpass=f=200,lowpass=f=200,afade=t=out:st=0.06:d=0.14" -t 0.22 ` +
      `-c:a pcm_s16le -ar ${SR} -ac 1 ${TMP_DIR}/land-body.wav`,
  );
  mixTo(`${OUT_DIR}/land.wav`, [
    [`${TMP_DIR}/land-attack.wav`, 0.55],
    [`${TMP_DIR}/land-body.wav`, 1.0],
  ]);
}

/**
 * whoosh.wav - beat to beat. PullUp's downward band sweep, compressed into
 * 280 ms and softened: ffmpeg's lowpass has a fixed cutoff, so the downward
 * sweep is three bands whose fades are staggered, the top leaving first.
 * Ends at digital silence.
 */
function buildWhoosh(): void {
  const bands: Array<[string, string, number, number, number]> = [
    ["hi", "highpass=f=1800,lowpass=f=5200", 0.0, 0.14, 0.35],
    ["mid", "bandpass=f=800:w=900", 0.05, 0.16, 0.75],
    ["lo", "lowpass=f=380,highpass=f=55", 0.1, 0.17, 1.0],
  ];
  const parts: Array<[string, number]> = [];
  for (const [name, filt, st, d, g] of bands) {
    const file = `${TMP_DIR}/whoosh-${name}.wav`;
    ff(
      `-f lavfi -i "anoisesrc=c=brown:r=${SR}:d=0.28:a=0.9:seed=880${name.length}" ` +
        `-af "${filt},afade=t=in:st=0:d=0.02:curve=qsin,afade=t=out:st=${st}:d=${d}:curve=qsin" ` +
        `-c:a pcm_s16le -ar ${SR} -ac 1 ${file}`,
    );
    parts.push([file, g]);
  }
  mixTo(`${TMP_DIR}/whoosh-mix.wav`, parts);
  ff(
    `-i ${TMP_DIR}/whoosh-mix.wav -af "afade=t=out:st=0.25:d=0.03" -t 0.28 ` +
      `-c:a pcm_s16le -ar ${SR} -ac 1 ${OUT_DIR}/whoosh.wav`,
  );
}

/**
 * rise.wav - 600 ms into the BEAT reveal. Three noise bands opening bottom
 * up, which is a filter opening rather than a pitch rising: there is no
 * tonal content, so it never fights whatever the viewer is playing over it.
 * Ends exactly on 600 ms so it can butt straight into slam.wav.
 */
function buildRise(): void {
  const bands: Array<[string, string, number, number]> = [
    ["lo", "lowpass=f=400,highpass=f=60", 0.0, 0.9],
    ["mid", "bandpass=f=900:w=1100", 0.18, 0.8],
    ["hi", "highpass=f=1800,lowpass=f=6000", 0.34, 0.5],
  ];
  const parts: Array<[string, number]> = [];
  for (const [name, filt, start, g] of bands) {
    const file = `${TMP_DIR}/rise-${name}.wav`;
    const fadeIn = (0.6 - start).toFixed(3);
    ff(
      `-f lavfi -i "anoisesrc=c=brown:r=${SR}:d=0.6:a=0.9:seed=440${name.length}" ` +
        `-af "${filt},afade=t=in:st=${start}:d=${fadeIn}:curve=qsin" ` +
        `-c:a pcm_s16le -ar ${SR} -ac 1 ${file}`,
    );
    parts.push([file, g]);
  }
  mixTo(`${TMP_DIR}/rise-mix.wav`, parts);
  // A hair of fade at the very end so the hand-off to slam is not a step.
  ff(
    `-i ${TMP_DIR}/rise-mix.wav -af "afade=t=out:st=0.58:d=0.02" -t 0.6 ` +
      `-c:a pcm_s16le -ar ${SR} -ac 1 ${OUT_DIR}/rise.wav`,
  );
}

// --- Level plan ------------------------------------------------------------
//
// The brief: every one-shot peaks at or below -6 dBFS, and the bed sits
// around -30 dBFS so it is clearly under all of them. That is a much wider
// gap than PullUp's (-1 SFX / -5.5 bed), because these videos are read, not
// watched - the bed is there to stop the silence between beats feeling dead,
// and nothing more.
const PEAKS: Record<string, number> = {
  slam: -6,
  land: -8,
  rise: -9,
  chime: -11,
  whoosh: -12,
  pop: -12,
  tick: -20,
  bed: -30,
};

function main() {
  try {
    sh("ffmpeg -version");
  } catch {
    console.error("ffmpeg is required and was not found on PATH.");
    process.exit(1);
  }
  if (!existsSync(IMPACT)) {
    console.error(
      `Missing Kenney sources in ${KENNEY_DIR}. Run: bun run fetch:kenney`,
    );
    process.exit(1);
  }

  rmSync(TMP_DIR, { recursive: true, force: true });
  mkdirSync(TMP_DIR, { recursive: true });
  mkdirSync(OUT_DIR, { recursive: true });

  console.log("Generating recap sound kit\n");

  console.log(
    `  bed.wav        ${BED_SECONDS}s room tone <220Hz + sparse grain, no tone`,
  );
  buildBed();

  console.log("  slam.wav       Kenney impact + sub thump, ring removed");
  buildSlam();

  console.log("  land.wav       Kenney impact, attack rolled off");
  buildLand();

  console.log("  pop.wav        Kenney pluck, shortened and darkened");
  fromKenney(
    "pluck.ogg",
    "pop",
    "lowpass=f=3200,afade=t=out:st=0.05:d=0.07",
    0.12,
  );

  console.log("  tick.wav       Kenney tick");
  fromKenney("tick.ogg", "tick");

  console.log("  chime.wav      Kenney confirmation, low-passed soft");
  fromKenney(
    "confirmation.ogg",
    "chime",
    "lowpass=f=1600,lowpass=f=1600,afade=t=out:st=0.22:d=0.20",
    0.45,
  );

  console.log("  whoosh.wav     synthesised downward band sweep, 280ms");
  buildWhoosh();

  console.log("  rise.wav       synthesised bottom-up filter opening, 600ms");
  buildRise();

  console.log("\nNormalising peaks:");
  for (const name of Object.keys(PEAKS)) {
    // The bed is levelled on its body, past the fade in and before the fade
    // out, so the fades do not set the gain.
    const gain =
      name === "bed"
        ? normalizePeak(`${OUT_DIR}/${name}.wav`, PEAKS[name], 2, 20)
        : normalizePeak(`${OUT_DIR}/${name}.wav`, PEAKS[name]);
    let label = name;
    while (label.length < 8) label += " ";
    console.log(
      `  ${label} -> ${PEAKS[name].toFixed(1)} dBFS (${gain >= 0 ? "+" : ""}${gain.toFixed(1)} dB)`,
    );
  }

  rmSync(TMP_DIR, { recursive: true, force: true });
  console.log(`\nDone. ${Object.keys(PEAKS).length} files in ${OUT_DIR}/`);
}

main();
