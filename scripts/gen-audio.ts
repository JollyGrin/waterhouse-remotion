#!/usr/bin/env bun
/**
 * Build the PullUp soundtrack.
 *
 *   bun run gen:audio
 *
 * Two sources, both license-free:
 *
 *  - The beds are synthesised from ffmpeg primitives (anoisesrc / aevalsrc +
 *    afade / lowpass / highpass / bandpass / volume) with fixed noise seeds,
 *    so they are deterministic and reproducible.
 *  - The one-shots come from Kenney's CC0 packs, committed under
 *    public/audio/pullup/kenney/ (see CREDITS.md, and scripts/fetch-kenney.ts
 *    to re-download them).
 *
 * The soundtrack is ENVIRONMENTAL on purpose: the same clip ships for every
 * artist and every genre, so the bed carries NO tonal component at all - a
 * sustained sine reads as a whine on phone speakers and on headphones.
 * Texture and weight only.
 *
 * Output: public/audio/pullup/*.wav (48kHz mono pcm_s16le), committed, so
 * rendering never depends on running this script.
 */

import { execSync } from "child_process";
import { existsSync, mkdirSync, rmSync } from "fs";

const OUT_DIR = "public/audio/pullup";
const KENNEY_DIR = "public/audio/pullup/kenney";
const TMP_DIR = "/tmp/waterhouse-pullup-audio";
const SR = 48000;

// The composition is 300 frames at 30fps.
const CLIP_SECONDS = 10;
// Seconds of crossfade used to wrap the looping beds onto themselves.
const WRAP = 1;
// Fade at each edge of a looping bed, in seconds. The rendered AAC track is
// ~48ms longer than the video and carries a decoder priming offset, so the
// exact boundary sample is not ours to control; fading the bed to silence
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
    .map(([hz, weight, phase]) => `${weight}*sin(2*PI*${hz}*t+${phase})`)
    .join("+");
  return `volume=volume='pow(10\\,${(depthDb / 20).toFixed(4)}*(${expr}))':eval=frame`;
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
  const gain = targetDb - parseFloat(m[1]);
  ff(
    `-i ${file} -af "volume=${gain.toFixed(3)}dB" -c:a pcm_s16le -ar ${SR} -ac 1 ${file}.norm.wav`,
  );
  ff(`-i ${file}.norm.wav -c:a copy ${file}`);
  rmSync(`${file}.norm.wav`, { force: true });
  return gain;
}

/**
 * Make a noise bed loop seamlessly: render CLIP_SECONDS + WRAP, then fold the
 * overhanging tail back over the head with an equal-power crossfade. The
 * result is exactly CLIP_SECONDS long and runs continuously into itself.
 */
function wrapLoop(src: string, dst: string): void {
  ff(
    `-i ${src} -filter_complex "` +
      `[0:a]atrim=0:${WRAP},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=${WRAP}:curve=qsin[a];` +
      `[0:a]atrim=${CLIP_SECONDS}:${CLIP_SECONDS + WRAP},asetpts=PTS-STARTPTS,afade=t=out:st=0:d=${WRAP}:curve=qsin[b];` +
      `[a][b]amix=inputs=2:normalize=0[x];` +
      `[0:a]atrim=${WRAP}:${CLIP_SECONDS},asetpts=PTS-STARTPTS[y];` +
      `[x][y]concat=n=2:v=0:a=1,` +
      `afade=t=in:st=0:d=${EDGE_FADE},afade=t=out:st=${CLIP_SECONDS - EDGE_FADE}:d=${EDGE_FADE}[out]" ` +
      `-map "[out]" -c:a pcm_s16le -ar ${SR} -ac 1 -t ${CLIP_SECONDS} ${dst}`,
  );
}

// --- BED: texture only, no tonal component --------------------------------

/**
 * Sparse vinyl-style grain: weight without pitch.
 *
 * Gating a noise source was the obvious approach and it does not work - a
 * hard agate still yields 25-50 bursts/s however high the threshold, which
 * reads as a noise floor rather than as crackle. Scripting the impulses is
 * the only way to actually land at a few per second.
 */
function buildGrain(
  dur: number,
  perSecond: number,
  name = "grain",
  seedBase = 9100,
  band: [number, number] = [400, 2600],
): string {
  const variants = 4;
  for (let v = 0; v < variants; v++) {
    ff(
      `-f lavfi -i "anoisesrc=c=white:r=${SR}:d=0.005:a=0.9:seed=${9100 + v}" ` +
        `-af "highpass=f=${band[0]},lowpass=f=${band[1]},afade=t=out:st=0:d=0.005:curve=exp" ` +
        `-c:a pcm_s16le -ar ${SR} -ac 1 ${TMP_DIR}/${name}-v${v}.wav`,
    );
  }

  const rng = makeRng(4242 + seedBase);
  const hits: Array<{ v: number; ms: number }> = [];
  // Irregular spacing, so the grain never sounds metronomic.
  let t = 0.05;
  while (t < dur - 0.05) {
    hits.push({ v: Math.floor(rng() * variants), ms: Math.round(t * 1000) });
    // mean of (0.45 + U*1.25) is 1.075, so divide it out to hit perSecond.
    t += (0.45 + rng() * 1.25) / (1.075 * perSecond);
  }

  const inputs: string[] = [];
  for (let v = 0; v < variants; v++) {
    inputs.push(`-i ${TMP_DIR}/${name}-v${v}.wav`);
  }

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
    // Vary each hit's level a little so the grain is not a repeating stamp.
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
    `                 ${hits.length} ${name} impulses over ${dur}s (${(hits.length / dur).toFixed(1)}/s)`,
  );
  return `${TMP_DIR}/${name}.wav`;
}

function buildBed(): void {
  const dur = CLIP_SECONDS + WRAP;

  // Room tone: brown noise under ~250Hz, breathing +/-2dB on a 3-5s cycle so
  // it moves like a room rather than sitting there like a fan.
  ff(
    `-f lavfi -i "anoisesrc=c=brown:r=${SR}:d=${dur}:a=0.9:seed=1701" ` +
      `-af "lowpass=f=250,lowpass=f=250,highpass=f=22,` +
      wander(2, [
        [0.2, 0.5, 0],
        [0.3, 0.3, 1.7],
        [0.5, 0.2, 3.1],
      ]) +
      `" -c:a pcm_s16le -ar ${SR} -ac 1 ${TMP_DIR}/bed-tone.wav`,
  );

  const grain = buildGrain(dur, 3);

  ff(
    `-i ${TMP_DIR}/bed-tone.wav -i ${grain} ` +
      `-filter_complex "[0:a]volume=1.0[t];[1:a]volume=0.18[g];[t][g]amix=inputs=2:normalize=0[out]" ` +
      `-map "[out]" -c:a pcm_s16le -ar ${SR} -ac 1 ${TMP_DIR}/bed-mix.wav`,
  );

  wrapLoop(`${TMP_DIR}/bed-mix.wav`, `${OUT_DIR}/bed.wav`);
}

// --- PRESENCE: people in a room, rising with the viewer count --------------
//
// Constant level on disk; the composition drives its volume from the viewer
// count schedule. Four detuned noise bands across 300-3000Hz, each with its
// own seed and its own slow wander, so they drift against each other the way
// a room of voices does. No tremolo, no tone.
//
// A real crowd murmur from Pixabay was the brief's first choice; pixabay.com
// answers 403 to a scripted fetch, so this is the documented fallback.
function buildPresence(): void {
  const dur = CLIP_SECONDS + WRAP;
  const bands: Array<{
    seed: number;
    f: number;
    w: number;
    wob: Array<[number, number, number]>;
    gain: number;
  }> = [
    {
      seed: 2911,
      f: 420,
      w: 280,
      wob: [
        [0.2, 0.7, 0.0],
        [0.5, 0.3, 2.2],
      ],
      gain: 1.0,
    },
    {
      seed: 3313,
      f: 900,
      w: 520,
      wob: [
        [0.3, 0.6, 1.1],
        [0.1, 0.4, 4.0],
      ],
      gain: 0.9,
    },
    {
      seed: 4177,
      f: 1600,
      w: 800,
      wob: [
        [0.1, 0.5, 2.7],
        [0.4, 0.5, 0.6],
      ],
      gain: 0.6,
    },
    {
      seed: 5233,
      f: 2600,
      w: 900,
      wob: [
        [0.4, 0.6, 3.4],
        [0.2, 0.4, 1.4],
      ],
      gain: 0.35,
    },
  ];

  const inputs: string[] = [];
  const parts: string[] = [];
  const labels: string[] = [];
  bands.forEach((b, i) => {
    ff(
      `-f lavfi -i "anoisesrc=c=pink:r=${SR}:d=${dur}:a=0.9:seed=${b.seed}" ` +
        `-af "bandpass=f=${b.f}:w=${b.w},bandpass=f=${b.f}:w=${b.w},` +
        wander(3, b.wob) +
        `,volume=24dB" -c:a pcm_s16le -ar ${SR} -ac 1 ${TMP_DIR}/pres-${i}.wav`,
    );
    inputs.push(`-i ${TMP_DIR}/pres-${i}.wav`);
    parts.push(`[${i}:a]volume=${b.gain}[b${i}]`);
    labels.push(`[b${i}]`);
  });

  ff(
    `${inputs.join(" ")} -filter_complex "${parts.join(";")};` +
      `${labels.join("")}amix=inputs=${labels.length}:normalize=0,highpass=f=300,lowpass=f=3000[out]" ` +
      `-map "[out]" -c:a pcm_s16le -ar ${SR} -ac 1 ${TMP_DIR}/presence-raw.wav`,
  );
  wrapLoop(`${TMP_DIR}/presence-raw.wav`, `${OUT_DIR}/presence.wav`);
}

// --- ONE-SHOTS from the Kenney CC0 packs ----------------------------------

/** Convert a pack sound to mono 48k and trim the silence off its front. */
function fromKenney(src: string, dst: string, extra = ""): void {
  const chain = [
    "silenceremove=start_periods=1:start_threshold=-55dB:start_silence=0:detection=peak",
    extra,
    "afade=t=in:st=0:d=0.002",
  ]
    .filter(Boolean)
    .join(",");
  ff(
    `-i ${KENNEY_DIR}/${src} -af "${chain}" -c:a pcm_s16le -ar ${SR} -ac 1 ${OUT_DIR}/${dst}.wav`,
  );
}

/**
 * Loop seam: the room emptying. ffmpeg's lowpass has a fixed cutoff, so the
 * downward sweep is built by layering three bands whose fades are staggered -
 * the top band leaves first, the bottom band last. Kenney has no reversed
 * whoosh, so this one stays synthesised. Ends at digital silence.
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

// --- Bed variants ---------------------------------------------------------
//
// Three alternative beds for the operator to pick by ear. All three obey the
// same rules as the base bed: no key, no melody, no tempo, no tonal drone -
// engagement comes from a sense of place and from build, not from music.
//
// Every texture here is synthesised. The brief asked for real recordings from
// pixabay.com; pixabay.com answers HTTP 403 to a scripted fetch and so does
// cdn.pixabay.com, so there is no way to fetch them from here. See CREDITS.md.

// Comma escaped for use inside an ffmpeg filter expression.
const C = "\\,";
const clip01 = (e: string) => `max(0${C}min(1${C}${e}))`;
/** 0 before `from`, 1 after `to`. */
const ramp = (from: number, to: number) =>
  clip01(`(t-${from})/${(to - from).toFixed(4)}`);
/** 1 before `from`, 0 after `to`. */
const fall = (from: number, to: number) =>
  clip01(`(${to}-t)/${(to - from).toFixed(4)}`);
/** Rises over [a,b], holds, falls over [c,d]. */
const windowEnv = (a: number, b: number, c: number, d: number) =>
  `min(${ramp(a, b)}${C}${fall(c, d)})`;
const volExpr = (e: string) => `volume=volume='${e}':eval=frame`;

/** A band of noise with a level envelope, written to a temp file. */
function noiseLayer(
  name: string,
  seed: number,
  dur: number,
  filters: string,
  env: string,
  gain: number,
): string {
  const out = `${TMP_DIR}/${name}.wav`;
  ff(
    `-f lavfi -i "anoisesrc=c=pink:r=${SR}:d=${dur}:a=0.9:seed=${seed}" ` +
      `-af "${filters},${volExpr(env)},volume=${gain}" ` +
      `-c:a pcm_s16le -ar ${SR} -ac 1 ${out}`,
  );
  return out;
}

function mixTo(dst: string, parts: string[]): void {
  const inputs = parts.map((p) => `-i ${p}`).join(" ");
  const labels = parts.map((_, i) => `[${i}:a]`).join("");
  ff(
    `${inputs} -filter_complex "${labels}amix=inputs=${parts.length}:normalize=0[out]" ` +
      `-map "[out]" -c:a pcm_s16le -ar ${SR} -ac 1 ${dst}`,
  );
}

/**
 * A riser: three noise bands fading in bottom-up so the energy climbs, then
 * handing off to the seam whoosh. Non-tonal - it is a filter opening, not a
 * pitch rising. Used by variants B and C so every loop builds into the thud.
 */
function riserLayers(dur: number): string[] {
  const spec: Array<[string, number, string, number, number, number]> = [
    // Gains are high on purpose: the riser has to climb clearly above the
    // room tone or the "tension -> hit" never reads. At 0.9/0.75/0.5 it only
    // moved the bed 1.6dB into the seam, which is inaudible.
    ["riser-lo", 6101, "lowpass=f=400,highpass=f=60", 7.5, 8.2, 3.4],
    ["riser-mid", 6203, "bandpass=f=900:w=1200", 8.0, 8.8, 3.0],
    ["riser-hi", 6301, "highpass=f=2200,lowpass=f=7000", 8.6, 9.2, 2.0],
  ];
  return spec.map(([name, seed, filt, inA, inB, gain]) =>
    noiseLayer(name, seed, dur, filt, windowEnv(inA, inB, 9.2, 9.7), gain),
  );
}

/** Variant A: outside -> inside. Rain and city, ducking as the room fills. */
function buildBedA(): void {
  const dur = CLIP_SECONDS + WRAP;
  // The outside world is present at both ends of the clip, so the loop is
  // consistent: rain -> room -> rain.
  const outside = `(1-0.8*${windowEnv(2.5, 3.5, 9.0, 9.8)})`;
  const inside = `(0.12+0.88*${windowEnv(2.5, 3.5, 9.0, 9.8)})`;

  const parts = [
    // Rain on glass: fine high texture.
    noiseLayer(
      "a-rain",
      7001,
      dur,
      `highpass=f=900,lowpass=f=9000,${wander(2, [
        [0.3, 0.6, 0.4],
        [0.5, 0.4, 2.0],
      ])}`,
      outside,
      0.55,
    ),
    // Distant city at night: far traffic wash.
    noiseLayer(
      "a-city",
      7103,
      dur,
      `lowpass=f=400,lowpass=f=400,${wander(3, [
        [0.1, 0.7, 1.2],
        [0.2, 0.3, 3.3],
      ])}`,
      outside,
      1.0,
    ),
    // Inside: the warm room takes over once you are in it.
    noiseLayer(
      "a-room",
      1701,
      dur,
      `lowpass=f=250,lowpass=f=250,highpass=f=22,${wander(2, [
        [0.2, 0.5, 0],
        [0.3, 0.3, 1.7],
        [0.5, 0.2, 3.1],
      ])}`,
      inside,
      1.0,
    ),
  ];
  // Rain needs droplets, not just hiss.
  const drops = buildGrain(dur, 9, "a-drops", 500, [1200, 7000]);
  ff(
    `-i ${drops} -af "${volExpr(outside)},volume=0.5" -c:a pcm_s16le -ar ${SR} -ac 1 ${TMP_DIR}/a-drops-env.wav`,
  );
  parts.push(`${TMP_DIR}/a-drops-env.wav`);

  mixTo(`${TMP_DIR}/bed-a-mix.wav`, parts);
  wrapLoop(`${TMP_DIR}/bed-a-mix.wav`, `${OUT_DIR}/bed-a.wav`);
}

/** Variant B: venue before the show. Crackle, PA power-up, riser into the hit. */
function buildBedB(): void {
  const dur = CLIP_SECONDS + WRAP;
  const parts = [
    noiseLayer(
      "b-room",
      1701,
      dur,
      `lowpass=f=250,lowpass=f=250,highpass=f=22,${wander(2, [
        [0.2, 0.5, 0],
        [0.3, 0.3, 1.7],
        [0.5, 0.2, 3.1],
      ])}`,
      "1",
      1.0,
    ),
    // PA power-up: bands opening bottom-up under the ask block, settling to
    // the low hiss of a rig that is now switched on.
    noiseLayer(
      "b-pa-lo",
      6401,
      dur,
      "lowpass=f=500,highpass=f=70",
      `(0.10+0.90*${windowEnv(1.0, 2.1, 2.4, 3.4)})`,
      0.55,
    ),
    noiseLayer(
      "b-pa-mid",
      6503,
      dur,
      "bandpass=f=1100:w=1400",
      `(0.08+0.92*${windowEnv(1.4, 2.4, 2.6, 3.6)})`,
      0.32,
    ),
    noiseLayer(
      "b-pa-hi",
      6607,
      dur,
      "highpass=f=3000,lowpass=f=8000",
      `(0.06+0.94*${windowEnv(1.7, 2.5, 2.7, 3.6)})`,
      0.18,
    ),
    ...riserLayers(dur),
  ];
  const crackle = buildGrain(dur, 6, "b-crackle", 400, [400, 2600]);
  ff(
    `-i ${crackle} -af "volume=0.5" -c:a pcm_s16le -ar ${SR} -ac 1 ${TMP_DIR}/b-crackle-env.wav`,
  );
  parts.push(`${TMP_DIR}/b-crackle-env.wav`);

  mixTo(`${TMP_DIR}/bed-b-mix.wav`, parts);
  wrapLoop(`${TMP_DIR}/bed-b-mix.wav`, `${OUT_DIR}/bed-b.wav`);
}

/** Variant C: cinematic weather. Thunder, wind gusts, the same riser. */
function buildBedC(): void {
  const dur = CLIP_SECONDS + WRAP;

  // Distant thunder: lowpassed noise bursts at irregular intervals. No pitch.
  const rng = makeRng(31337);
  const hits: number[] = [];
  let t = 0.6;
  while (t < dur - 1.6) {
    hits.push(Math.round(t * 1000));
    t += 2.4 + rng() * 2.6;
  }
  ff(
    `-f lavfi -i "anoisesrc=c=brown:r=${SR}:d=1.6:a=0.9:seed=8501" ` +
      `-af "lowpass=f=120,lowpass=f=120,afade=t=in:st=0:d=0.25:curve=qsin,afade=t=out:st=0.35:d=1.25:curve=exp" ` +
      `-c:a pcm_s16le -ar ${SR} -ac 1 ${TMP_DIR}/c-thunder-one.wav`,
  );
  const outs = hits.map((_, i) => `[s${i}]`);
  const chain = [
    outs.length === 1
      ? `[0:a]anull${outs[0]}`
      : `[0:a]asplit=${outs.length}${outs.join("")}`,
    ...hits.map(
      (ms, i) =>
        `[s${i}]adelay=${ms},volume=${(0.6 + ((i * 37) % 40) / 100).toFixed(2)}[d${i}]`,
    ),
    `${hits.map((_, i) => `[d${i}]`).join("")}amix=inputs=${hits.length}:normalize=0,apad[tout]`,
  ].join(";");
  ff(
    `-i ${TMP_DIR}/c-thunder-one.wav -filter_complex "${chain}" ` +
      `-map "[tout]" -t ${dur} -c:a pcm_s16le -ar ${SR} -ac 1 ${TMP_DIR}/c-thunder.wav`,
  );
  console.log(`                 ${hits.length} thunder rumbles over ${dur}s`);

  const parts = [
    `${TMP_DIR}/c-thunder.wav`,
    // Wind: broad texture with deep, slow gusts.
    noiseLayer(
      "c-wind",
      9001,
      dur,
      `bandpass=f=700:w=1600,${wander(6, [
        [0.1, 0.6, 0.9],
        [0.2, 0.25, 2.6],
        [0.3, 0.15, 4.4],
      ])}`,
      "1",
      0.8,
    ),
    noiseLayer(
      "c-room",
      1701,
      dur,
      `lowpass=f=250,lowpass=f=250,highpass=f=22`,
      "1",
      0.7,
    ),
    ...riserLayers(dur),
  ];

  mixTo(`${TMP_DIR}/bed-c-mix.wav`, parts);
  wrapLoop(`${TMP_DIR}/bed-c-mix.wav`, `${OUT_DIR}/bed-c.wav`);
}

// --- Level plan -----------------------------------------------------------
//
// Operator-chosen "one step up" loudness: ~-17.5 LUFS integrated.
//
// That row was measured with the old sine-plus-noise bed at -21 / -7 dBFS
// peak. This bed is noise only, which has a much higher crest factor, so the
// same peak now measures ~2.7 LU quieter. -18 / -4 is what actually lands on
// -17.6 LUFS. Raising or lowering these two together is the one knob that
// trades integrated loudness against how far the bed sits under the SFX.
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
  bed: -18,
  "bed-a": -18,
  "bed-b": -18,
  "bed-c": -18,
  presence: -4,
};

function main() {
  try {
    sh("ffmpeg -version");
  } catch {
    console.error("ffmpeg is required and was not found on PATH.");
    process.exit(1);
  }
  if (!existsSync(`${KENNEY_DIR}/pluck.ogg`)) {
    console.error(
      `Missing Kenney sources in ${KENNEY_DIR}. Run: bun run fetch:kenney`,
    );
    process.exit(1);
  }

  rmSync(TMP_DIR, { recursive: true, force: true });
  mkdirSync(TMP_DIR, { recursive: true });
  mkdirSync(OUT_DIR, { recursive: true });

  console.log("Generating PullUp soundtrack\n");

  console.log(
    "  bed.wav        brown room tone <250Hz + sparse grain, no tone",
  );
  buildBed();

  console.log("  presence.wav   four detuned noise bands, 300-3000Hz");
  buildPresence();

  console.log("  bed-a.wav      variant A: outside -> inside (rain + city)");
  buildBedA();
  console.log(
    "  bed-b.wav      variant B: pre-show venue (crackle, PA, riser)",
  );
  buildBedB();
  console.log("  bed-c.wav      variant C: weather (thunder, wind, riser)");
  buildBedC();

  console.log("  thud.wav       Kenney impactSoft_heavy");
  fromKenney("impact-soft-heavy.ogg", "thud", "lowpass=f=1200");

  console.log("  pop-you.wav    Kenney pluck");
  fromKenney("pluck.ogg", "pop-you");

  // The friends get the same pluck, stepped down a semitone at a time, so
  // they stay obviously related to the sound YOU made.
  for (let i = 0; i < 6; i++) {
    const ratio = Math.pow(2, -(i + 1) / 12);
    console.log(
      `  pop-friend-${i}.wav  Kenney pluck, ${i + 1} semitone(s) down`,
    );
    fromKenney(
      "pluck.ogg",
      `pop-friend-${i}`,
      `asetrate=${Math.round(SR * ratio)},aresample=${SR}`,
    );
  }

  console.log("  click.wav      Kenney tick");
  fromKenney("tick.ogg", "click");

  console.log("  msg.wav        Kenney confirmation");
  fromKenney("confirmation.ogg", "msg");

  console.log("  whoosh.wav     synthesised downward band sweep");
  buildWhoosh();

  console.log("\nNormalising peaks:");
  for (const name of Object.keys(PEAKS)) {
    const gain = normalizePeak(`${OUT_DIR}/${name}.wav`, PEAKS[name]);
    let label = name;
    while (label.length < 14) label += " ";
    console.log(
      `  ${label} -> ${PEAKS[name].toFixed(1)} dBFS (${gain >= 0 ? "+" : ""}${gain.toFixed(1)} dB)`,
    );
  }

  rmSync(TMP_DIR, { recursive: true, force: true });
  console.log(`\nDone. ${Object.keys(PEAKS).length} files in ${OUT_DIR}/`);
}

main();
