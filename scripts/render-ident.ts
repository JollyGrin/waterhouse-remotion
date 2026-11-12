#!/usr/bin/env bun
/**
 * Render the idents ported from nb-bumpers (src/ident/, #28). Per composition:
 *
 *   out/ident/Ident<Id>-preview.mp4  H.264 over the stand-in footage, to watch and share
 *   out/ident/Ident<Id>.mov          ProRes 4444 with alpha (yuva444p10le), for editing
 *   out/ident/Ident<Id>.webm         VP9 with alpha (yuva420p), for OBS stingers
 *
 * Usage:
 *   bun run render:ident Fuse-16x9                 # the Sessions intro, landscape
 *   bun run render:ident Fuse Fuse-16x9            # both cuts
 *   bun run render:ident --intro                   # Fuse + every FuseLines variant, both cuts
 *   bun run render:ident --all                     # every ident
 *   bun run render:ident Fuse --only prores,webm   # skip the preview
 *
 * Ids are the Studio ids with or without the "Ident" prefix (Fuse = IdentFuse).
 * Full renders are heavy (alpha PNG frames): run them on the GPU box, not a laptop.
 * Windows-safe: no shell, spawns the project's own Remotion CLI through Bun.
 */

import { mkdirSync } from "fs";
import { join } from "path";
import { IDENT_COMP_IDS, IDENT_PREFIX, SESSIONS_INTRO, identCompIds } from "../src/ident/ids";
import { hasAlpha, probeVideo } from "./render-bumper";

export type Output = "preview" | "prores" | "webm";
export const OUTPUTS: Output[] = ["preview", "prores", "webm"];

export interface Args {
  ids: string[];
  only: Output[];
}

const OUT_DIR = join("out", "ident");

function usage(message: string): never {
  console.error(`${message}\n`);
  console.error("Usage: bun run render:ident <Id...> | --intro | --all [--only preview,prores,webm]");
  console.error(`Ids: ${IDENT_COMP_IDS.map((c) => c.slice(IDENT_PREFIX.length)).join(", ")}`);
  process.exit(1);
}

/** "Fuse" or "IdentFuse" -> "IdentFuse"; null if it isn't an ident composition. */
export function resolveId(raw: string): string | null {
  const id = raw.indexOf(IDENT_PREFIX) === 0 ? raw : `${IDENT_PREFIX}${raw}`;
  return IDENT_COMP_IDS.indexOf(id) === -1 ? null : id;
}

export function parseArgs(argv: string[]): Args {
  const ids: string[] = [];
  let only: Output[] = OUTPUTS;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--all") ids.push(...IDENT_COMP_IDS);
    else if (a === "--intro") ids.push(...SESSIONS_INTRO.flatMap(identCompIds));
    else if (a === "--only") {
      const v = argv[++i];
      if (!v) usage("--only needs a value.");
      only = v.split(",").map((s) => s.trim()) as Output[];
      const bad = only.filter((o) => OUTPUTS.indexOf(o) === -1);
      if (bad.length) usage(`--only takes ${OUTPUTS.join(", ")}; got "${bad.join(", ")}".`);
    } else if (a.indexOf("--") === 0) usage(`Unknown flag ${a}.`);
    else {
      const id = resolveId(a);
      if (!id) usage(`"${a}" is not an ident.`);
      ids.push(id);
    }
  }
  if (!ids.length) usage("Name at least one ident, or pass --intro / --all.");
  return { ids: ids.filter((id, i) => ids.indexOf(id) === i), only };
}

/** The Remotion command line for one output of one composition. */
export function renderCommand(id: string, out: Output): { cmd: string[]; file: string } {
  const base = ["bun", join("node_modules", ".bin", "remotionb"), "render", join("src", "index.ts")];
  if (out === "preview") {
    const file = join(OUT_DIR, `${id}-preview.mp4`);
    return { file, cmd: [...base, `${id}-preview`, file, "--codec=h264", "--crf=16"] };
  }
  if (out === "prores") {
    const file = join(OUT_DIR, `${id}.mov`);
    return {
      file,
      cmd: [...base, id, file, "--codec=prores", "--prores-profile=4444", "--pixel-format=yuva444p10le", "--image-format=png"],
    };
  }
  const file = join(OUT_DIR, `${id}.webm`);
  return { file, cmd: [...base, id, file, "--codec=vp9", "--pixel-format=yuva420p", "--image-format=png"] };
}

async function run(cmd: string[]): Promise<void> {
  console.log(`\n$ ${cmd.join(" ")}`);
  const child = Bun.spawn(cmd, { stdin: "ignore", stdout: "inherit", stderr: "inherit" });
  const code = await child.exited;
  if (code !== 0) throw new Error(`${cmd[0]} exited with ${code}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  mkdirSync(OUT_DIR, { recursive: true });
  console.log(`=== Idents: ${args.ids.join(", ")} (${args.only.join(", ")}) ===`);
  for (const id of args.ids) {
    for (const out of args.only) {
      const { cmd, file } = renderCommand(id, out);
      await run(cmd);
      if (out !== "preview") {
        const format = out === "prores" ? "prores" : "webm";
        const probe = probeVideo(file);
        if (!probe) console.log("(ffprobe not found - alpha not verified.)");
        else if (!hasAlpha(probe, format)) throw new Error(`${file} is ${probe.codec}/${probe.pixFmt}: no alpha channel.`);
        else console.log(`Alpha OK: ${file} ${probe.codec} ${probe.pixFmt}`);
      }
      console.log(`Done: ${file}`);
    }
  }
  console.log(`\nAll done (${args.ids.length} comps).`);
}

if (/render-ident\.ts$/.test(process.argv[1] ?? "")) {
  main().catch((err) => {
    console.error("Error:", err);
    process.exit(1);
  });
}
