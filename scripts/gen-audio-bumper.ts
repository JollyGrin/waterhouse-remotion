#!/usr/bin/env bun
/**
 * Build the SessionBumper one-shots in public/audio/bumper/.
 *
 *   bun run gen:audio:bumper
 *
 * Every file is derived from a clip that is already in the repo (the PullUp
 * and Recap kits, and Kenney's CC0 sources under public/audio/pullup/kenney)
 * or synthesised from a formula - nothing is downloaded. See CREDITS.md.
 *
 * The DSP is done here in TypeScript on 16-bit PCM: Remotion's bundled
 * ffmpeg has no areverse / lowpass / afade filters and there is no system
 * ffmpeg on the render box. ffmpeg is only used to decode the .ogg sources.
 */

import { existsSync, readFileSync, writeFileSync } from "fs";

const OUT_DIR = "public/audio/bumper";
const SR = 48000;

const FFMPEG = [
  "node_modules/@remotion/compositor-linux-x64-gnu/ffmpeg",
  "node_modules/@remotion/compositor-linux-arm64-gnu/ffmpeg",
  "node_modules/@remotion/compositor-darwin-arm64/ffmpeg",
  "node_modules/@remotion/compositor-darwin-x64/ffmpeg",
].find((p) => existsSync(p));

// --- WAV in / out (48 kHz mono pcm_s16le, like the other kits) ---

export function readWav(path: string): Float32Array {
  const buf = readFileSync(path);
  if (buf.toString("ascii", 0, 4) !== "RIFF") throw new Error(`${path}: not a WAV`);
  let pos = 12;
  let channels = 1;
  let rate = SR;
  let bits = 16;
  while (pos + 8 <= buf.length) {
    const id = buf.toString("ascii", pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    const body = pos + 8;
    if (id === "fmt ") {
      channels = buf.readUInt16LE(body + 2);
      rate = buf.readUInt32LE(body + 4);
      bits = buf.readUInt16LE(body + 14);
    } else if (id === "data") {
      if (bits !== 16) throw new Error(`${path}: ${bits}-bit, expected 16`);
      if (rate !== SR) throw new Error(`${path}: ${rate} Hz, expected ${SR}`);
      const n = Math.floor(size / 2 / channels);
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        let s = 0;
        for (let c = 0; c < channels; c++) {
          s += buf.readInt16LE(body + (i * channels + c) * 2);
        }
        out[i] = s / channels / 32768;
      }
      return out;
    }
    pos = body + size + (size % 2);
  }
  throw new Error(`${path}: no data chunk`);
}

export function writeWav(path: string, samples: Float32Array): void {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    data.writeInt16LE(Math.round(v * 32767), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(SR, 24);
  header.writeUInt32LE(SR * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  writeFileSync(path, Buffer.concat([header, data]));
}

/** Decode any source (ogg, wav) to 48 kHz mono through the bundled ffmpeg. */
function decode(src: string): Float32Array {
  if (/\.wav$/.test(src)) return readWav(src);
  if (!FFMPEG) throw new Error("no ffmpeg found to decode " + src);
  const tmp = `/tmp/waterhouse-bumper-${src.replace(/[^a-z0-9]/gi, "-")}.wav`;
  const res = Bun.spawnSync([
    FFMPEG, "-hide_banner", "-loglevel", "error", "-y",
    "-i", src, "-ac", "1", "-ar", String(SR), "-c:a", "pcm_s16le", tmp,
  ]);
  if (res.exitCode !== 0) throw new Error(res.stderr.toString());
  return readWav(tmp);
}

// --- DSP primitives ---

export const reverse = (x: Float32Array) => Float32Array.from(x).reverse();

/** Play back at `rate` (0.5 = an octave down and twice as long). Linear. */
export function resample(x: Float32Array, rate: number): Float32Array {
  const n = Math.floor(x.length / rate);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = i * rate;
    const k = Math.floor(p);
    const t = p - k;
    const a = x[k] ?? 0;
    const b = x[k + 1] ?? a;
    out[i] = a + (b - a) * t;
  }
  return out;
}

/** One-pole low-pass, applied `passes` times for a steeper roll-off. */
export function lowpass(x: Float32Array, hz: number, passes = 1): Float32Array {
  let out = Float32Array.from(x);
  const a = 1 - Math.exp((-2 * Math.PI * hz) / SR);
  for (let p = 0; p < passes; p++) {
    let y = 0;
    for (let i = 0; i < out.length; i++) {
      y += a * (out[i] - y);
      out[i] = y;
    }
  }
  return out;
}

export function highpass(x: Float32Array, hz: number): Float32Array {
  const low = lowpass(x, hz);
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = x[i] - low[i];
  return out;
}

/** Linear fades at both ends, in seconds. */
export function fade(x: Float32Array, inSec: number, outSec: number): Float32Array {
  const out = Float32Array.from(x);
  const nIn = Math.floor(inSec * SR);
  const nOut = Math.floor(outSec * SR);
  for (let i = 0; i < nIn && i < out.length; i++) out[i] *= i / nIn;
  for (let i = 0; i < nOut && i < out.length; i++) {
    out[out.length - 1 - i] *= i / nOut;
  }
  return out;
}

export function normalize(x: Float32Array, peakDb: number): Float32Array {
  let peak = 0;
  for (const v of x) peak = Math.max(peak, Math.abs(v));
  const g = peak > 0 ? Math.pow(10, peakDb / 20) / peak : 1;
  return x.map((v) => v * g);
}

export function trimLeadingSilence(x: Float32Array, thresholdDb = -50): Float32Array {
  const t = Math.pow(10, thresholdDb / 20);
  let i = 0;
  while (i < x.length && Math.abs(x[i]) < t) i++;
  return x.slice(Math.max(0, i - 48));
}

/** mulberry32: the grain lands the same way every run. */
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
 * The lamp's hum: a 60 Hz fundamental with four harmonics, a slow 0.4 Hz
 * tremolo, and a whisper of band-limited noise so it is not a pure tone.
 * The only intentionally tonal sound in the kits - it is a lamp.
 */
export function hum(seconds: number): Float32Array {
  const n = Math.floor(seconds * SR);
  const out = new Float32Array(n);
  const rng = makeRng(7);
  const partials: Array<[number, number]> = [
    [60, 1], [120, 0.55], [180, 0.3], [240, 0.18], [300, 0.08],
  ];
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let v = 0;
    for (const [hz, amp] of partials) v += amp * Math.sin(2 * Math.PI * hz * t);
    const tremolo = 1 + 0.16 * Math.sin(2 * Math.PI * 0.4 * t);
    out[i] = v * tremolo * 0.4 + (rng() * 2 - 1) * 0.02;
  }
  return fade(lowpass(out, 1800), 0.4, 0.3);
}

const PULLUP = "public/audio/pullup";
const RECAP = "public/audio/recap";
const KENNEY = "public/audio/pullup/kenney";

function build() {
  const out = (name: string, x: Float32Array) => {
    writeWav(`${OUT_DIR}/${name}.wav`, x);
    console.log(`  ${name}.wav  ${(x.length / SR).toFixed(2)} s`);
  };
  console.log("=== bumper audio ===");

  // The door's push: the PullUp room-emptying sweep backwards, so it swells
  // from silence into the hit. Slowed a touch so it lasts ~20 frames.
  out(
    "cymbal-reverse",
    normalize(fade(reverse(resample(decode(`${PULLUP}/whoosh.wav`), 1.2)), 0.05, 0.004), -8),
  );

  // The hinge: Kenney's pluck two octaves down and dulled - a short creak.
  out(
    "creak",
    normalize(fade(lowpass(resample(trimLeadingSilence(decode(`${KENNEY}/pluck.ogg`)), 0.25), 1500, 2), 0.002, 0.03), -12),
  );

  // The lamp.
  out("hum", normalize(hum(4), -22));

  // Low thump for the blow-out: the soft impact slowed and rolled off.
  out(
    "thump",
    normalize(fade(lowpass(resample(trimLeadingSilence(decode(`${KENNEY}/impact-soft-heavy.ogg`)), 0.7), 320, 2), 0.001, 0.05), -6),
  );

  // Paper tap: the recap tick an octave down, dulled.
  out(
    "tap",
    normalize(fade(lowpass(resample(decode(`${RECAP}/tick.wav`), 0.5), 2500, 2), 0.001, 0.01), -14),
  );

  // Paper rustle: the PullUp whoosh low-passed twice at 1.2 kHz, with its
  // top end gone so it reads as paper, not air.
  out(
    "rustle",
    normalize(fade(highpass(lowpass(decode(`${PULLUP}/whoosh.wav`), 1200, 2), 120), 0.01, 0.05), -14),
  );
}

if (/gen-audio-bumper\.ts$/.test(process.argv[1] ?? "")) build();
