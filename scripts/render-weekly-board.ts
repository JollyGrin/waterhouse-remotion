#!/usr/bin/env bun
/**
 * Render the Monday "House Weekly" board - the week's shows, the board ranked
 * by pulled, the four badges, the house line and next week's lineup.
 *
 * Usage:
 *   bun scripts/render-weekly-board.ts                     # week ending today
 *   bun scripts/render-weekly-board.ts --end 2026-09-03    # 7 days to that date
 *   bun scripts/render-weekly-board.ts --fixture           # checked-in fixture
 *   bun scripts/render-weekly-board.ts --props out/x.json  # props you already have
 *
 * Live data comes from `scripts/fetch-audience.ts week`, which this script
 * runs for you. Props are validated against houseWeeklyPropsSchema before the
 * renderer is ever started, so a data problem fails in a second rather than
 * after a two-minute encode.
 *
 * Output: out/HouseWeekly-{YYYY-Www}.mp4
 */

import { execFileSync } from "child_process";
import { existsSync, mkdirSync, readFileSync } from "fs";
import { houseWeeklyPropsSchema } from "../src/audience/schema";

const FETCH_SCRIPT = "scripts/fetch-audience.ts";
const FIXTURE = "src/audience/fixtures/weekly.json";

// --- Args ---
interface Args {
  end: string; // YYYY-MM-DD
  fixture: boolean;
  props: string | null;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { end: today(), fixture: false, props: null };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--fixture") {
      args.fixture = true;
    } else if (arg === "--end") {
      const value = argv[++i];
      if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        fail("--end needs a date as YYYY-MM-DD");
      }
      args.end = value;
    } else if (arg === "--props") {
      const value = argv[++i];
      if (!value) fail("--props needs a path");
      args.props = value;
    } else {
      fail(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function fail(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}

// ISO-8601 week of the day the window ends on - the same label the group chat
// uses to talk about "week 36".
function isoWeekLabel(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) fail(`Not a date: ${date}`);

  // Thursday of this week decides which year the week belongs to.
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(
    ((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7,
  );

  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

// --- Main ---
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const week = isoWeekLabel(args.end);

  mkdirSync("out", { recursive: true });

  let propsPath: string;

  if (args.props) {
    propsPath = args.props;
    if (!existsSync(propsPath)) fail(`No such props file: ${propsPath}`);
    console.log(`Using props from ${propsPath}`);
  } else if (args.fixture) {
    propsPath = FIXTURE;
    console.log(`Using the checked-in fixture (${FIXTURE})`);
  } else {
    propsPath = `out/weekly-${week}.json`;
    if (!existsSync(FETCH_SCRIPT)) {
      fail(
        `${FETCH_SCRIPT} is missing - it ships with the audience-data work.\n` +
          `       Render the checked-in week instead with:\n` +
          `         bun scripts/render-weekly-board.ts --fixture`,
      );
    }
    console.log(`Fetching audience data for the week ending ${args.end}...`);
    execFileSync(
      "bun",
      [FETCH_SCRIPT, "week", "--end", args.end, "--out", propsPath],
      { stdio: ["ignore", "inherit", "inherit"] },
    );
  }

  // Validate before rendering: a bad shape should cost a second, not an encode.
  const parsed = houseWeeklyPropsSchema.safeParse(
    JSON.parse(readFileSync(propsPath, "utf-8")),
  );
  if (!parsed.success) {
    console.error(`Props at ${propsPath} do not match houseWeeklyPropsSchema:`);
    for (const issue of parsed.error.issues) {
      console.error(`  ${issue.path.join(".") || "(root)"}: ${issue.message}`);
    }
    process.exit(1);
  }

  const props = parsed.data;
  console.log(
    `\n${props.rangeLabel} · ${props.shows} show(s) · ${props.uniques} in the room · ${props.pulled} new`,
  );
  for (const [i, row] of props.rows.entries()) {
    console.log(
      `  ${i + 1}. ${row.artistName}${row.shared ? "*" : ""} - pulled ${row.pulled}, hold ${Math.round(row.holdRate * 100)}%`,
    );
  }
  if (props.nextWeek.length === 0) {
    console.log("  (next week's lineup is not published yet)");
  }

  const outPath = `out/HouseWeekly-${week}.mp4`;
  const renderArgs = [
    "remotion",
    "render",
    "src/index.ts",
    "HouseWeekly",
    outPath,
    `--props=${propsPath}`,
  ];

  console.log(`\n$ bunx ${renderArgs.join(" ")}\n`);
  execFileSync("bunx", renderArgs, {
    stdio: ["ignore", "inherit", "inherit"],
    cwd: process.cwd(),
  });

  console.log(`\nDone! Output: ${outPath}`);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
