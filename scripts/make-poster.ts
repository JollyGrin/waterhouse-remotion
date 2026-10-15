#!/usr/bin/env bun
/**
 * Render one Waterhouse Radio session cover.
 *
 *   bun scripts/make-poster.ts --name "Timo Feyman" --date 30.7.2026 \
 *     --photo ~/Downloads/timo.jpg [--session 12] [--scale 0.66] [--x 0.05] [--y -0.10]
 *
 * The photo may be a local file or a URL. Its background is removed with Apple's
 * Vision framework (scripts/cutout.swift) unless it already has transparency, in
 * which case it is trusted as a hand-made cut-out and only trimmed.
 *
 * The session number auto-increments from posters/state.json when not given.
 */

import { execFileSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join, extname } from "path";
import { assessPhoto, computeFraming, faceUnion, type Box, type ModeName } from "./framing";

const STATE_PATH = "posters/state.json";

const MODES: ModeName[] = ["front", "window", "window-full"];

const ARTIST_DIR = "public/artists";
const OUT_DIR = "out/posters";

type State = { lastSession: number; sessions: Record<string, string> };

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

function num(args: Args, key: string, fallback: number): number {
  const v = str(args, key);
  if (v === undefined) return fallback;
  const n = Number(v);
  if (Number.isNaN(n)) throw new Error(`--${key} must be a number, got "${v}"`);
  return n;
}

const slugify = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

// --- session numbering -----------------------------------------------------

function readState(): State {
  if (!existsSync(STATE_PATH)) return { lastSession: 0, sessions: {} };
  return JSON.parse(readFileSync(STATE_PATH, "utf-8")) as State;
}

function recordSession(state: State, session: number, name: string, date: string) {
  if (session > state.lastSession) state.lastSession = session;
  state.sessions[String(session)] = `${name} ${date}`;
  writeState(state);
}

function writeState(state: State) {
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + "\n");
}

// --- photo preparation -----------------------------------------------------

type VisionReport = { width: number; height: number; instances: number; faces: Box[] };

/** True when the image already carries a real alpha channel worth trusting. */
function hasTransparency(path: string): boolean {
  const out = execFileSync("python3", [
    "-c",
    [
      "import sys",
      "from PIL import Image",
      "im = Image.open(sys.argv[1])",
      "a = im.convert('RGBA').getchannel('A')",
      "lo, hi = a.getextrema()",
      "print('yes' if lo < 250 else 'no')",
    ].join("\n"),
    path,
  ]);
  return out.toString().trim() === "yes";
}

/** Crop away fully transparent margins so the subject drives the framing. */
function trimToSubject(src: string, dest: string): void {
  execFileSync("python3", [
    "-c",
    [
      "import sys",
      "from PIL import Image",
      "im = Image.open(sys.argv[1]).convert('RGBA')",
      "box = im.getchannel('A').getbbox()",
      "if box is None: sys.exit('the cut-out is fully transparent')",
      "im.crop(box).save(sys.argv[2])",
    ].join("\n"),
    src,
    dest,
  ]);
}

type PreparedPhoto = {
  /** Path under public/, ready for staticFile(). */
  path: string;
  size: { width: number; height: number };
  /** Face rectangles in the trimmed image's own pixels. */
  faces: Box[];
  /** Their union, or null when nothing usable was found. */
  face: Box | null;
};

async function preparePhoto(source: string, slug: string): Promise<PreparedPhoto> {
  mkdirSync(ARTIST_DIR, { recursive: true });
  const dest = join(ARTIST_DIR, `${slug}.png`);

  let local = source;
  let downloaded: string | undefined;
  if (/^https?:\/\//.test(source)) {
    console.log(`Downloading ${source}`);
    const res = await fetch(source);
    if (!res.ok) throw new Error(`could not fetch photo: ${res.status}`);
    downloaded = join(tmpdir(), `wh-photo-${slug}${extname(new URL(source).pathname) || ".jpg"}`);
    writeFileSync(downloaded, Buffer.from(await res.arrayBuffer()));
    local = downloaded;
  }
  if (!existsSync(local)) throw new Error(`no such photo: ${local}`);

  if (hasTransparency(local)) {
    console.log("Photo already has an alpha channel — trusting it as a hand-made cut-out.");
    trimToSubject(local, dest);
  } else {
    console.log("Removing background (Vision)...");
    const masked = join(tmpdir(), `wh-cutout-${slug}.png`);
    try {
      execFileSync("swift", ["scripts/cutout.swift", local, masked], { stdio: ["ignore", "pipe", "inherit"] });
    } catch {
      throw new Error(
        "background removal failed. Cut the photo out by hand, save it as a " +
          "transparent PNG, and pass that with --photo instead."
      );
    }
    trimToSubject(masked, dest);
    rmSync(masked, { force: true });
  }
  if (downloaded) rmSync(downloaded, { force: true });

  // Detect on the finished cut-out rather than the original. Vision reads a
  // masked greyscale subject slightly differently from the photo it came from,
  // and the framing targets were themselves measured by running this detector
  // over finished posters — so both ends have to look at the same kind of image
  // or the rendered face comes out ~15% oversized.
  const report: VisionReport = JSON.parse(
    execFileSync("swift", ["scripts/cutout.swift", "--detect", dest]).toString().trim()
  );

  const union = faceUnion(report.faces);
  console.log(
    union
      ? `Found ${report.faces.length} face${report.faces.length === 1 ? "" : "s"} — framing on ${report.faces.length === 1 ? "it" : "them"}.`
      : "No face detected — falling back to framing on the top of the subject."
  );

  return {
    path: dest,
    size: { width: report.width, height: report.height },
    faces: report.faces,
    face: union,
  };
}

// --- main ------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const name = str(args, "name");
  const date = str(args, "date");
  const photoSource = str(args, "photo");
  if (!name || !date) {
    console.error(
      "Usage: bun scripts/make-poster.ts --name <artist> --date <D.M.YYYY> [--session N]\n\n" +
        "Renders the type-only cover. No photo needed; the session number\n" +
        "auto-increments when you leave it out.\n\n" +
        "To build a cover around an artist photo instead, add --photo <file|url>:\n" +
        "       [--mode front|window|window-full] [--scale N] [--x N] [--y N]\n" +
        "       [--fade N] [--font anton|fjalla|oswald] [--grain N] [--anyway]\n" +
        "--scale is the subject's height as a fraction of the canvas; --x/--y nudge it\n" +
        "(fractions of the canvas, positive is right / down)."
    );
    process.exit(1);
  }

  const state = readState();
  const session = Math.round(num(args, "session", state.lastSession + 1));
  const slug = slugify(name);

  mkdirSync(OUT_DIR, { recursive: true });
  const outPath = join(OUT_DIR, `session-${String(session).padStart(3, "0")}-${slug}.png`);

  // No photo means the type-only cover, which is the default: it needs nothing
  // beyond the three pieces of information above and looks identical every time.
  if (!photoSource) {
    const props = {
      artistName: name,
      sessionNumber: session,
      dateLabel: date,
      variant: "blueprint",
      grainOpacity: num(args, "grain", 0.18),
    };
    const propsPath = join(tmpdir(), `wh-poster-${slug}.json`);
    writeFileSync(propsPath, JSON.stringify(props, null, 2));
    console.log(`Rendering session ${session} — ${name} (${date})`);
    execFileSync(
      "bunx",
      ["remotion", "still", "src/index.ts", "SessionPosterType", outPath, `--props=${propsPath}`],
      { stdio: ["ignore", "inherit", "inherit"] }
    );
    recordSession(state, session, name, date);
    console.log(`\nDone: ${outPath}`);
    return;
  }

  const mode = (str(args, "mode") ?? "front") as ModeName;
  if (!MODES.includes(mode)) throw new Error(`--mode must be one of ${MODES.join(", ")}`);

  const photo = await preparePhoto(photoSource, slug);

  const verdict = assessPhoto(photo.size, photo.faces);
  if (!verdict.ok) {
    const message =
      `This photo is not going to make a good poster: ${verdict.reason}.\n` +
      "Supply a head-and-shoulders portrait with --photo, or pass --anyway to render it regardless.";
    if (!args.anyway) {
      console.error(message);
      process.exit(2);
    }
    console.warn(`Warning: ${verdict.reason}. Rendering anyway.`);
  }

  const auto = computeFraming(mode, photo.size, photo.face);

  const props = {
    artistName: name,
    sessionNumber: session,
    dateLabel: date,
    photo: photo.path.replace(/^public\//, ""),
    photoScale: num(args, "scale", auto.photoScale),
    photoOffsetX: num(args, "x", auto.photoOffsetX),
    photoOffsetY: num(args, "y", auto.photoOffsetY),
    photoMode: mode,
    // A photo whose crop stops short of the canvas edge would otherwise end on a
    // visible horizontal line. Only laid-over photos can float like that;
    // window modes are clipped by the mark anyway.
    photoBottomFade: num(
      args,
      "fade",
      mode === "window"
        ? // In the window the photo stops partway down the house on purpose;
          // fading it lets the grey take over instead of ending on a cut line.
          0.32
        : mode === "front" && auto.photoScale + auto.photoOffsetY < 0.999
          ? 0.18
          : 0
    ),
    nameFont: str(args, "font") ?? "anton",
    grainOpacity: num(args, "grain", 0.18),
  };

  const propsPath = join(tmpdir(), `wh-poster-${slug}.json`);
  writeFileSync(propsPath, JSON.stringify(props, null, 2));

  console.log(`Rendering session ${session} — ${name} (${date})`);
  execFileSync(
    "bunx",
    ["remotion", "still", "src/index.ts", "SessionPoster", outPath, `--props=${propsPath}`],
    { stdio: ["ignore", "inherit", "inherit"] }
  );

  recordSession(state, session, name, date);

  console.log(`\nDone: ${outPath}`);
  console.log(
    `Framing: scale ${props.photoScale.toFixed(3)} x ${props.photoOffsetX.toFixed(3)} ` +
      `y ${props.photoOffsetY.toFixed(3)} fade ${props.photoBottomFade}` +
      ` — override with --scale / --x / --y / --fade.`
  );
  console.log(`Cut-out cached at ${photo.path}, so re-renders are instant.`);
}

main().catch((err) => {
  console.error("Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
