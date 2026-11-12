#!/usr/bin/env bun
/**
 * Render the "SessionBumper" OBS stinger for the Tuesday "Waterhouse
 * Sessions" stream: a VP9 webm with a real alpha channel.
 *
 * Usage:
 *   bun run render:bumper --idea door
 *   bun run render:bumper --idea corner
 *   bun run render:bumper --idea lamp
 *   bun run render:bumper --idea paper
 *   bun run render:bumper --idea neon
 *   bun run render:bumper --idea vhs
 *   bun run render:bumper --idea fader
 *   bun run render:bumper --idea flap
 *   bun run render:bumper --idea door --guest "Duncen"   # "with Denzo and Duncen"
 *   bun run render:bumper --idea door --idle             # just the idle state, loopable
 *   bun run render:bumper --idea corner --strip          # also the frame strip into out/
 *   bun run render:bumper --idea door --matte            # Track Matte fallback (opaque mp4)
 *   bun run render:bumper --idea door --format prores    # out/Bumper-door.mov for editing
 *
 * --idea    door | corner | lamp | paper | neon | vhs | fader | flap (required).
 * --guest   a name for the card; without it the card reads "with Denzo".
 * --idle    door: the open-door card held (2 s, camera drifting); corner:
 *           the drift up to the corner, no hit; lamp: the lit mark, lamp
 *           swaying, moth on; paper: the finished sheet, boiling on twos;
 *           neon: the lit sign in the rain, beam B buzzing; vhs: the tape
 *           intro wobbling; fader: the strip with the fader up, needle on
 *           the music; flap: the finished board, one tile rattling.
 *           Written as out/Bumper-{idea}-idle.webm.
 * --strip   additionally render out/Bumper-{idea}-frames.png: every 10th
 *           frame over a checkerboard, to pick an idea or attach to a PR.
 * --format  webm (default): VP9 with alpha, for OBS. prores: ProRes 4444
 *           with alpha (yuva444p10le) as out/Bumper-{idea}.mov, for cutting
 *           the bumper into edited session videos - NLEs rarely take VP9
 *           alpha.
 * --matte   instead of the alpha webm, render out/Bumper-{idea}-matte.mp4:
 *           3840x1080, the bumper over black on the left and its alpha as a
 *           luma matte on the right, for OBS's Track Matte stinger mode.
 *
 * Output: out/Bumper-{idea}.webm (VP9, yuva420p, Opus audio). The script
 * checks the pixel format with ffprobe afterwards and fails if alpha is
 * missing.
 */

import { mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { ffEnv, findBin } from "./lib/ff";
import {
  BUMPER_IDEAS,
  bumperOutName,
  type BumperIdea,
} from "../src/bumper/SessionBumper";
import { vhsDateStamp } from "../src/bumper/Vhs";

type Idea = BumperIdea;
type Format = "webm" | "prores";

interface Args {
  idea: Idea;
  guest: string | null;
  idle: boolean;
  strip: boolean;
  matte: boolean;
  format: Format;
}

// Codec flags and what ffprobe must report for a real alpha channel.
const FORMATS: Record<
  Format,
  { ext: string; flags: string[]; codec: string; pixFmt: string }
> = {
  webm: {
    ext: "webm",
    flags: ["--codec=vp9", "--pixel-format=yuva420p", "--image-format=png"],
    codec: "vp9",
    pixFmt: "yuva420p",
  },
  prores: {
    ext: "mov",
    flags: [
      "--codec=prores",
      "--prores-profile=4444",
      "--pixel-format=yuva444p10le",
      "--image-format=png",
    ],
    codec: "prores",
    pixFmt: "yuva444p10le",
  },
};

function usage(message: string): never {
  console.error(`${message}\n`);
  console.error(
    'Usage: bun run render:bumper --idea door|corner|lamp|paper|neon|vhs|fader|flap [--guest "Name"] [--idle] [--strip] [--matte] [--format webm|prores]',
  );
  process.exit(1);
}

export function parseArgs(argv: string[]): Args {
  const value = (flag: string): string | null => {
    const i = argv.indexOf(flag);
    if (i === -1) return null;
    const v = argv[i + 1];
    if (v === undefined || v.indexOf("--") === 0)
      usage(`${flag} needs a value.`);
    return v;
  };
  const idea = value("--idea") as Idea | null;
  if (!idea || BUMPER_IDEAS.indexOf(idea) === -1) {
    usage(`--idea must be one of ${BUMPER_IDEAS.join(", ")}, got "${idea ?? ""}".`);
  }
  const guest = value("--guest");
  const format = value("--format") ?? "webm";
  if (format !== "webm" && format !== "prores") {
    usage(`--format must be "webm" or "prores", got "${format}".`);
  }
  return {
    idea,
    guest: guest && guest.trim() ? guest.trim() : null,
    idle: argv.indexOf("--idle") !== -1,
    strip: argv.indexOf("--strip") !== -1,
    matte: argv.indexOf("--matte") !== -1,
    format,
  };
}

// The project's own Remotion CLI, run with Bun; no bunx on the PATH needed.
const REMOTION = ["bun", "node_modules/.bin/remotionb"];

async function run(cmd: string[]): Promise<void> {
  console.log(`\n$ ${cmd.join(" ")}`);
  const child = Bun.spawn(cmd, {
    cwd: process.cwd(),
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await child.exited;
  if (code !== 0) throw new Error(`${cmd[0]} exited with ${code}`);
}

/** ffprobe from PATH, else the one Remotion ships. */
const ffprobeBin = () => findBin("ffprobe");

export interface Probe {
  codec: string;
  pixFmt: string;
  // Matroska's alpha flag on the stream. ffmpeg's built-in VP9 decoder
  // reports yuv420p for alpha webms (the alpha plane is a block addition),
  // so this tag is what proves alpha when libvpx-vp9 is not available.
  alphaMode: boolean;
}

/** Codec, pixel format and alpha flag of the first video stream. */
export function probeVideo(file: string): Probe | null {
  const bin = ffprobeBin();
  if (!bin) return null;
  const query = (extra: string[]) =>
    Bun.spawnSync(
      [
        bin,
        "-v",
        "error",
        ...extra,
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=codec_name,pix_fmt:stream_tags=alpha_mode",
        "-of",
        "default=nw=1",
        file,
      ],
      { env: ffEnv(bin) },
    );
  // Decoding through libvpx-vp9 reports yuva420p directly; Remotion's
  // trimmed ffprobe does not know that option, so fall back to the plain
  // probe and the alpha_mode tag.
  let res = query(["-c:v", "libvpx-vp9"]);
  if (res.exitCode !== 0) res = query([]);
  const fields = new Map<string, string>();
  for (const line of res.stdout.toString().split("\n")) {
    const i = line.indexOf("=");
    if (i > 0) fields.set(line.slice(0, i), line.slice(i + 1));
  }
  const codec = fields.get("codec_name");
  if (!codec) return null;
  return {
    codec,
    pixFmt: fields.get("pix_fmt") ?? "",
    alphaMode: fields.get("TAG:alpha_mode") === "1",
  };
}

/**
 * ProRes 4444 reports an alpha pixel format directly (ffmpeg decodes it as
 * yuva444p12le, whatever bit depth it was encoded at); VP9 may only tag it.
 */
export const hasAlpha = (p: Probe, format: Format = "webm") =>
  p.codec === FORMATS[format].codec &&
  (format === "prores"
    ? p.pixFmt.indexOf("yuva444p") === 0
    : p.pixFmt === FORMATS[format].pixFmt || p.alphaMode);

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log("=== SessionBumper Renderer ===\n");

  mkdirSync("out", { recursive: true });
  // The VHS burns the render date into the picture.
  const props = {
    idea: args.idea,
    guestName: args.guest,
    idle: args.idle,
    vhsDate: vhsDateStamp(new Date()),
  };
  const stem = bumperOutName(props).replace(/\.webm$/, "");
  const propsPath = join(tmpdir(), `waterhouse-bumper-${stem}.json`);
  writeFileSync(propsPath, JSON.stringify(props, null, 2));

  if (args.matte) {
    const mattePath = `out/${stem}-matte.mp4`;
    await run([
      ...REMOTION,
      "render",
      "src/index.ts",
      "SessionBumperMatte",
      mattePath,
      `--props=${propsPath}`,
      "--codec=h264",
    ]);
    console.log(
      `\nDone! ${mattePath} - OBS Stinger, Track Matte, layout "Same file, side by side", left fill / right matte.`,
    );
    return;
  }

  const format = FORMATS[args.format];
  const outPath = `out/${stem}.${format.ext}`;

  // The composition's calculateMetadata already defaults to these, but
  // remotion.config.ts sets jpeg frames for the other clips and config
  // beats composition defaults, so say it on the command line too.
  await run([
    ...REMOTION,
    "render",
    "src/index.ts",
    "SessionBumper",
    outPath,
    `--props=${propsPath}`,
    ...format.flags,
  ]);

  const probe = probeVideo(outPath);
  if (!probe) {
    console.log("\n(ffprobe not found - alpha not verified.)");
  } else if (!hasAlpha(probe, args.format)) {
    throw new Error(
      `${outPath} is ${probe.codec}/${probe.pixFmt}, expected ${format.codec}/${format.pixFmt} - no alpha channel.`,
    );
  } else {
    console.log(
      `\nAlpha OK: ${probe.codec} ${probe.pixFmt}${probe.alphaMode ? " (alpha_mode=1)" : ""}`,
    );
  }
  console.log(`Done! ${outPath}`);

  if (args.strip) {
    const stripProps = {
      idea: args.idea,
      guestName: args.guest,
      vhsDate: props.vhsDate,
      step: 10,
      columns: 4,
    };
    const stripPropsPath = join(tmpdir(), `waterhouse-bumper-strip-${args.idea}.json`);
    writeFileSync(stripPropsPath, JSON.stringify(stripProps, null, 2));
    const stripPath = `out/Bumper-${args.idea}-frames.png`;
    await run([
      ...REMOTION,
      "still",
      "src/index.ts",
      "SessionBumperStrip",
      stripPath,
      `--props=${stripPropsPath}`,
      "--frame=0",
    ]);
    console.log(`Strip: ${stripPath}`);
  }
}

if (/render-bumper\.ts$/.test(process.argv[1] ?? "")) {
  main().catch((err) => {
    console.error("Error:", err);
    process.exit(1);
  });
}
