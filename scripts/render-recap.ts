#!/usr/bin/env bun
/**
 * Render one "ArtistRecap" clip - the Who Showed Up recap sent to an artist
 * within a day of their show.
 *
 * Usage:
 *   bun scripts/render-recap.ts "Tj Gee"              # last 4 shows, live data
 *   bun scripts/render-recap.ts "Tj Gee" --n 6        # last 6 shows (cap 6)
 *   bun scripts/render-recap.ts --fixture             # the checked-in fixture
 *   bun scripts/render-recap.ts "Tj Gee" --fallback   # exercise the fallbacks
 *
 * Pulls the props by shelling out to `scripts/fetch-audience.ts` (the audience
 * data script), validates them against the shared zod schema, then renders.
 *
 * Output: out/Recap-{artist-slug}-{YYYY-MM-DD}.mp4, dated by the show being
 * recapped, not by today.
 */

import { execFileSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import {
  ArtistRecapPropsSchema,
  type ArtistRecapProps,
} from "../src/audience/schema";
import { ARTIST_RECAP_DURATION } from "../src/ArtistRecap";

const FETCH_SCRIPT = "scripts/fetch-audience.ts";
const FIXTURE = "src/audience/fixtures/recap.json";
// Eight stacked shows is unreadable at story size; the spec caps the run at 6.
const MAX_N = 6;

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isoDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
  return d.toISOString().slice(0, 10);
}

function parseArgs(argv: string[]) {
  const positional: string[] = [];
  let n = 4;
  let fixture = false;
  let fallback = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--n") {
      n = Number(argv[++i]);
    } else if (a.startsWith("--n=")) {
      n = Number(a.slice(4));
    } else if (a === "--fixture") {
      fixture = true;
    } else if (a === "--fallback") {
      fallback = true;
    } else if (a.startsWith("--")) {
      console.error(`Unknown flag: ${a}`);
      process.exit(1);
    } else {
      positional.push(a);
    }
  }

  if (!Number.isFinite(n) || n < 1) {
    console.error("--n must be a positive number.");
    process.exit(1);
  }
  return {
    artistName: positional[0],
    n: Math.min(n, MAX_N),
    fixture,
    fallback,
  };
}

function loadProps(
  artistName: string | undefined,
  n: number,
  useFixture: boolean,
): ArtistRecapProps {
  if (useFixture || !artistName) {
    if (!useFixture) {
      console.error(
        'Usage: bun scripts/render-recap.ts "Artist Name" [--n 4] | --fixture',
      );
      process.exit(1);
    }
    console.log(`Reading ${FIXTURE}`);
    return ArtistRecapPropsSchema.parse(
      JSON.parse(readFileSync(FIXTURE, "utf-8")),
    );
  }

  const out = `out/recap-${slugify(artistName)}.json`;

  if (!existsSync(FETCH_SCRIPT)) {
    // The audience data script lands in its own PR. Until it does, the
    // fixture keeps this script runnable end to end.
    console.warn(
      `${FETCH_SCRIPT} not found - falling back to ${FIXTURE}.\n` +
        "Merge the audience-data branch for live numbers.",
    );
    return ArtistRecapPropsSchema.parse(
      JSON.parse(readFileSync(FIXTURE, "utf-8")),
    );
  }

  console.log(
    `$ bun ${FETCH_SCRIPT} artist "${artistName}" --n ${n} --out ${out}`,
  );
  execFileSync(
    "bun",
    [FETCH_SCRIPT, "artist", artistName, "--n", String(n), "--out", out],
    { stdio: ["ignore", "inherit", "inherit"] },
  );

  return ArtistRecapPropsSchema.parse(JSON.parse(readFileSync(out, "utf-8")));
}

function render(compositionId: string, outPath: string, propsPath?: string) {
  const args = [
    "remotion",
    "render",
    "src/index.ts",
    compositionId,
    outPath,
    ...(propsPath ? [`--props=${propsPath}`] : []),
  ];
  console.log(`\n$ bunx ${args.join(" ")}\n`);
  execFileSync("bunx", args, {
    stdio: ["ignore", "inherit", "inherit"],
    cwd: process.cwd(),
  });
  console.log(`\nDone! ${outPath}`);
}

function main() {
  const { artistName, n, fixture, fallback } = parseArgs(process.argv.slice(2));

  mkdirSync("out", { recursive: true });

  // The fallback registration carries its own props - no photo, one session,
  // nobody countable - so it renders straight from Root.tsx.
  if (fallback) {
    const today = new Date().toISOString().slice(0, 10);
    render("ArtistRecapFallback", `out/Recap-fallback-${today}.mp4`);
    return;
  }

  const props = loadProps(artistName, n, fixture);
  // Trim to the requested run, newest kept.
  const sessions = props.sessions.slice(-n);
  const finalProps: ArtistRecapProps = { ...props, sessions };

  const newest = sessions[sessions.length - 1];
  const day = newest
    ? isoDay(newest.start)
    : new Date().toISOString().slice(0, 10);
  const slug = slugify(finalProps.artistName);

  const outPath = `out/Recap-${slug}-${day}.mp4`;
  const propsPath = `out/recap-props-${slug}-${day}.json`;
  writeFileSync(propsPath, JSON.stringify(finalProps, null, 2));

  console.log(
    `\n${finalProps.artistName} · ${sessions.length} show(s) · ` +
      `${ARTIST_RECAP_DURATION} frames (${(ARTIST_RECAP_DURATION / 30).toFixed(1)}s)`,
  );
  for (const s of sessions) {
    console.log(
      `  ${s.dateLabel} ${s.slotLabel} · ${s.uniques} uniques · ` +
        `${s.pulled} pulled · held ${Math.round(s.holdRate * 100)}% · ${s.quadrant}`,
    );
  }

  render("ArtistRecap", outPath, propsPath);
}

main();
