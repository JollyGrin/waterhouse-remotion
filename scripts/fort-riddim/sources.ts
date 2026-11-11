// Where the FORT RIDDIM source footage lives. It was shot on a phone and is not in
// the repo: pass each file as a flag or an env var (flag wins).

import { existsSync } from "node:fs";

export type Source = { flag: string; env: string; what: string };

export const PROMO_SOURCE: Source = {
  flag: "--source",
  env: "FORT_RIDDIM_PROMO_SRC",
  what: "the animated disc with its audio (FORTRIDDIMPROMO.MP4)",
};

/** The value of `--flag <path>` or of the env var, else undefined. */
export function sourceArg(s: Source, argv = process.argv.slice(2)): string | undefined {
  const i = argv.indexOf(s.flag);
  if (i >= 0 && argv[i + 1]) return argv[i + 1];
  return process.env[s.env] || undefined;
}

/** The source path, or a clear error naming the flag and env var to set. */
export function requireSource(s: Source, argv = process.argv.slice(2)): string {
  const path = sourceArg(s, argv);
  if (!path) throw new Error(`missing ${s.what}: pass ${s.flag} <path> or set ${s.env}`);
  if (!existsSync(path)) throw new Error(`${s.flag} / ${s.env}: no such file ${path}`);
  return path;
}
