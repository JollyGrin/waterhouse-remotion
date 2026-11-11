#!/usr/bin/env bun
/**
 * Pick this week's music bed for the WeeklyLineup video.
 *
 *   bun scripts/pick-track.ts                  # pick, install into public/audio, print props JSON
 *   bun scripts/pick-track.ts --dry-run        # report pool status, touch nothing
 *   bun scripts/pick-track.ts --track "Sheeq"  # force a track (substring match)
 *   bun scripts/pick-track.ts --reset          # start a fresh round early
 *
 * Draws at random from the library folder without repeats. When every track has
 * been used the round counter ticks over and the pool refills automatically.
 *
 * Formats: mp3 is copied as-is. flac/wav are encoded to mp3. aiff goes through
 * macOS afconvert first — Remotion's bundled ffmpeg has no AIFF demuxer, and
 * Chromium cannot play AIFF either.
 *
 * audioStartFrom is derived by scanning 30-150Hz energy for the drop, so the
 * video opens on the good part of the track instead of a quiet intro.
 */

import { execFileSync } from "child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { basename, extname, join } from "path";

const STATE_PATH = "weekly/state.json";
const AUDIO_DIR = "public/audio";
const AUDIO_EXTS = [".mp3", ".wav", ".flac", ".aiff", ".aif", ".m4a"];

// Remotion ships its own ffmpeg; it needs its sibling dylibs on the library path.
const COMPOSITOR_DIR =
  "/Users/manuel/.bun/install/cache/@remotion/compositor-darwin-arm64@4.0.410@@@1";
const FFMPEG = join(COMPOSITOR_DIR, "ffmpeg");

type HistoryEntry = {
  date: string;
  file: string;
  audioTrack: string;
  audioStartFrom: number;
  round: number;
};

type State = {
  library: string;
  round: number;
  used: string[];
  history: HistoryEntry[];
};

// --- argument parsing ------------------------------------------------------

type Args = Record<string, string | boolean>;

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      i++;
    }
  }
  return args;
}

function str(args: Args, key: string): string | undefined {
  const v = args[key];
  return typeof v === "string" ? v : undefined;
}

// --- state -----------------------------------------------------------------

function readState(): State {
  if (!existsSync(STATE_PATH)) {
    throw new Error(`${STATE_PATH} is missing — create it before picking a track.`);
  }
  return JSON.parse(readFileSync(STATE_PATH, "utf8")) as State;
}

function writeState(state: State) {
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + "\n");
}

// --- library ---------------------------------------------------------------

function listLibrary(dir: string): string[] {
  if (!existsSync(dir)) throw new Error(`Music library not found: ${dir}`);
  return readdirSync(dir)
    .filter((f) => !f.startsWith("."))
    .filter((f) => AUDIO_EXTS.includes(extname(f).toLowerCase()))
    .sort();
}

function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// --- audio -----------------------------------------------------------------

function ffmpeg(args: string[]) {
  execFileSync(FFMPEG, ["-hide_banner", "-v", "error", ...args], {
    env: { ...process.env, DYLD_LIBRARY_PATH: COMPOSITOR_DIR },
  });
}

/** Put the track into public/audio as browser-playable mp3, return the path under public/. */
function installTrack(sourcePath: string, slug: string): string {
  mkdirSync(AUDIO_DIR, { recursive: true });
  const ext = extname(sourcePath).toLowerCase();
  const target = join(AUDIO_DIR, `${slug}.mp3`);

  if (ext === ".mp3") {
    copyFileSync(sourcePath, target);
    return target;
  }

  if (ext === ".aiff" || ext === ".aif") {
    // Bundled ffmpeg cannot demux AIFF — hand it to Core Audio first.
    const staging = join(tmpdir(), `wh-${slug}.wav`);
    try {
      execFileSync("afconvert", ["-f", "WAVE", "-d", "LEI16", sourcePath, staging]);
      ffmpeg(["-i", staging, "-c:a", "libmp3lame", "-b:a", "192k", target, "-y"]);
    } finally {
      rmSync(staging, { force: true });
    }
    return target;
  }

  ffmpeg(["-i", sourcePath, "-c:a", "libmp3lame", "-b:a", "192k", target, "-y"]);
  return target;
}

const DROP_SCAN = `
import sys, wave, numpy as np

path, need = sys.argv[1], float(sys.argv[2])
w = wave.open(path)
rate = w.getframerate()
x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32)
dur = len(x) / rate

win = int(0.25 * rate)
n = len(x) // win
if n < 8:
    print(0.0); sys.exit(0)

frames = x[: n * win].reshape(n, win)
# The bundled ffmpeg has no lowpass filter, so band-limit here instead.
spec = np.abs(np.fft.rfft(frames * np.hanning(win), axis=1)) ** 2
freqs = np.fft.rfftfreq(win, 1.0 / rate)
bass = spec[:, (freqs >= 30) & (freqs <= 150)].sum(axis=1)

# ~1s smoothing so a single kick in the intro does not read as the drop.
k = 4
smooth = np.convolve(bass, np.ones(k) / k, mode="same")
peak = smooth.max()
if peak <= 0:
    print(0.0); sys.exit(0)

norm = smooth / peak
hold = int(8 / 0.25)          # the level has to stay up for ~8s
start = 0.0
for i in range(len(norm)):
    if norm[i] < 0.55:
        continue
    tail = norm[i : i + hold]
    if len(tail) and tail.mean() >= 0.45:
        start = i * 0.25
        break

# Never start so late that the track runs out under the video.
print(round(min(start, max(0.0, dur - need)), 2))
`;

function findDrop(sourcePath: string, needSeconds: number): number {
  const decoded = join(tmpdir(), `wh-scan-${process.pid}.wav`);
  try {
    ffmpeg(["-i", sourcePath, "-ac", "1", "-ar", "8000", "-c:a", "pcm_s16le", "-f", "wav", decoded, "-y"]);
    const out = execFileSync("python3", ["-c", DROP_SCAN, decoded, String(needSeconds)]).toString().trim();
    const seconds = Number(out);
    return Number.isFinite(seconds) ? seconds : 0;
  } finally {
    rmSync(decoded, { force: true });
  }
}

// --- main ------------------------------------------------------------------

function main() {
  const args = parseArgs(process.argv.slice(2));
  const state = readState();
  const library = str(args, "library") ?? state.library;
  const need = Number(str(args, "need") ?? 25);

  const all = listLibrary(library);
  if (all.length === 0) throw new Error(`No audio files in ${library}`);

  if (args.reset) {
    state.used = [];
    state.round += 1;
  }

  // Anything deleted from the library should not keep a slot in the used list.
  state.used = state.used.filter((f) => all.includes(f));

  let remaining = all.filter((f) => !state.used.includes(f));
  let wrapped = false;
  if (remaining.length === 0) {
    state.used = [];
    state.round += 1;
    remaining = all;
    wrapped = true;
    console.error(`All ${all.length} tracks used — starting round ${state.round}.`);
  }

  const forced = str(args, "track");
  let choice: string;
  if (forced) {
    const hit = all.find((f) => f.toLowerCase().includes(forced.toLowerCase()));
    if (!hit) throw new Error(`No track in ${library} matches "${forced}"`);
    choice = hit;
  } else {
    choice = remaining[Math.floor(Math.random() * remaining.length)];
  }

  const title = basename(choice, extname(choice));

  if (args["dry-run"]) {
    console.error(
      `Round ${state.round}: ${remaining.length}/${all.length} unused. Would pick: ${title}`,
    );
    return;
  }

  const sourcePath = join(library, choice);
  const slug = slugify(title);
  const target = installTrack(sourcePath, slug);
  const audioStartFrom = findDrop(target, need);
  const audioTrack = `audio/${slug}.mp3`;

  state.used.push(choice);
  state.history.push({
    date: new Date().toISOString().slice(0, 10),
    file: choice,
    audioTrack,
    audioStartFrom,
    round: state.round,
  });
  writeState(state);

  const left = all.length - state.used.length;
  console.error(
    `Picked "${title}" — drop at ${audioStartFrom}s → ${target}. ` +
      `${left} track${left === 1 ? "" : "s"} left in round ${state.round}${wrapped ? " (pool refilled)" : ""}.`,
  );

  process.stdout.write(
    JSON.stringify({ title, audioTrack, audioStartFrom, remaining: left, round: state.round }, null, 2) + "\n",
  );
}

main();
