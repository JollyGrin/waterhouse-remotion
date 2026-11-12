/**
 * Find ffmpeg / ffprobe on any machine the repo is cloned to.
 *
 * Remotion installs one compositor package per platform under
 * node_modules/@remotion/, each with its own ffmpeg and ffprobe. On macOS
 * those binaries load sibling dylibs, so they need DYLD_LIBRARY_PATH pointed
 * at their folder: run them with `ffEnv(bin)`.
 */

import { existsSync } from "fs";
import { dirname, join, resolve } from "path";

export type FfTool = "ffmpeg" | "ffprobe";

const COMPOSITORS = [
  "compositor-darwin-arm64",
  "compositor-darwin-x64",
  "compositor-linux-x64-gnu",
  "compositor-linux-arm64-gnu",
  "compositor-linux-x64-musl",
  "compositor-linux-arm64-musl",
  "compositor-win32-x64-msvc",
];

/** The binary Remotion ships for this platform, or null if none is installed. */
export function bundledBin(tool: FfTool): string | null {
  const exe = process.platform === "win32" ? `${tool}.exe` : tool;
  for (const pkg of COMPOSITORS) {
    const p = join("node_modules", "@remotion", pkg, exe);
    if (existsSync(p)) return p;
  }
  return null;
}

/** The tool from PATH (no shell involved), or null. */
export function pathBin(tool: FfTool): string | null {
  return Bun.which(tool);
}

/** PATH first, then Remotion's bundled copy. */
export function findBin(tool: FfTool): string | null {
  return pathBin(tool) ?? bundledBin(tool);
}

/** Environment for spawning `bin`: adds the dylib folder for Remotion's macOS binaries. */
export function ffEnv(bin: string): NodeJS.ProcessEnv {
  if (process.platform !== "darwin" || !bin.includes("@remotion")) return process.env;
  return { ...process.env, DYLD_LIBRARY_PATH: resolve(dirname(bin)) };
}
