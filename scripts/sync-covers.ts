#!/usr/bin/env bun
/**
 * Builds the whole cover set: every mix already on SoundCloud, plus the shows
 * still to come from the Waterhouse calendar.
 *
 *   bun scripts/sync-covers.ts            # render anything missing
 *   bun scripts/sync-covers.ts --dry      # just show what it would do
 *   bun scripts/sync-covers.ts --force    # redraw covers that already exist
 *   bun scripts/sync-covers.ts --past     # skip the upcoming shows
 *   bun scripts/sync-covers.ts --weeks 6  # look further ahead (default 3)
 *
 * Session numbers for published mixes are derived, not guessed: sort by show
 * date, break same-day ties on upload time. That reproduces all six covers whose
 * numbers were already known. Upcoming shows continue the count, which makes them
 * a prediction — a cancelled show shifts everything after it, so they are written
 * to a separate folder and labelled provisional.
 */

import { execFileSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { fetchMixes, type Mix } from "./soundcloud";

const STATE_PATH = "posters/state.json";
const PUBLISHED_DIR = "out/posters";
const UPCOMING_DIR = "out/posters/upcoming";
const CALENDAR = "https://api.waterhousestudios.nl/api/reservations/public";

type State = { lastSession: number; sessions: Record<string, string> };

const slugify = (n: string) =>
  n.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const dateLabel = (d: Date) => `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`;

type Cover = {
  session: number;
  artist: string;
  date: Date;
  dir: string;
  provisional: boolean;
};

function render(cover: Cover, force: boolean, dry: boolean): "rendered" | "skipped" {
  const file = join(
    cover.dir,
    `session-${String(cover.session).padStart(3, "0")}-${slugify(cover.artist)}.png`
  );
  if (!force && existsSync(file)) return "skipped";
  if (dry) return "rendered";
  mkdirSync(cover.dir, { recursive: true });
  const props = {
    artistName: cover.artist,
    sessionNumber: cover.session,
    dateLabel: dateLabel(cover.date),
    variant: "blueprint",
    grainOpacity: 0.18,
  };
  const propsPath = join(tmpdir(), `wh-sync-${cover.session}.json`);
  writeFileSync(propsPath, JSON.stringify(props));
  execFileSync(
    "bunx",
    ["remotion", "still", "src/index.ts", "SessionPosterType", file, `--props=${propsPath}`, "--log=error"],
    { stdio: ["ignore", "pipe", "pipe"] }
  );
  return "rendered";
}

type Reservation = {
  start_time: string;
  status: string;
  purpose: string | null;
  artists: Array<{ stage_name: string }>;
};

/** Sessions run Tuesday to Thursday; the rest of the calendar is other bookings. */
const SESSION_DAYS = new Set([2, 3, 4]);
const PLACEHOLDER = /\btbd\b|to be determined/i;

async function fetchUpcoming(
  after: Date,
  weeks: number,
  anyDay: boolean
): Promise<{ shows: Array<{ artist: string; date: Date }>; unnamed: string[] }> {
  const res = await fetch(CALENDAR, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`calendar returned ${res.status}`);
  const { reservations } = (await res.json()) as { reservations: Reservation[] };
  const horizon = new Date(Date.now() + weeks * 7 * 864e5);

  const shows: Array<{ artist: string; date: Date }> = [];
  const unnamed: string[] = [];
  for (const r of reservations) {
    if (r.status !== "approved") continue;
    const date = new Date(r.start_time);
    // Compare on the calendar day: the last published mix is stored at midnight,
    // and its own booking sits later that evening, so a raw > comparison would
    // draw a second cover for a show that is already up.
    const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    if (day <= after || date > horizon) continue;
    if (!anyDay && !SESSION_DAYS.has(date.getDay())) continue;
    // Private bookings carry neither an artist nor a "Radio:" purpose.
    if (r.artists.length === 0 && !/^radio:/i.test(r.purpose ?? "")) continue;
    const artist =
      r.artists.map((a) => a.stage_name).join(" & ") ||
      (r.purpose ?? "").replace(/^radio:\s*/i, "").trim();
    if (!artist) continue;
    // A placeholder booking has no name to set yet; naming it "TBD" on a cover
    // would be worse than leaving it out.
    if (PLACEHOLDER.test(artist)) {
      unnamed.push(`${dateLabel(date)} — ${artist}`);
      continue;
    }
    shows.push({ artist, date });
  }
  shows.sort((a, b) => a.date.getTime() - b.date.getTime());
  return { shows, unnamed };
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const dry = args.has("--dry");
  const force = args.has("--force");

  console.log("Reading SoundCloud...");
  const { mixes, skipped } = await fetchMixes();
  console.log(`${mixes.length} mixes read.`);
  for (const s of skipped) console.log(`  ignored (title doesn't parse): ${s}`);

  const covers: Cover[] = mixes.map((m: Mix, i) => ({
    session: i + 1,
    artist: m.artist,
    date: m.date,
    dir: PUBLISHED_DIR,
    provisional: false,
  }));

  // Flag same-day pairs: their order comes from upload time, which is a guess at
  // which show actually ran first.
  const byDay = new Map<string, Cover[]>();
  for (const c of covers) {
    const k = dateLabel(c.date);
    byDay.set(k, [...(byDay.get(k) ?? []), c]);
  }
  const ties = [...byDay.values()].filter((v) => v.length > 1);

  let unnamed: string[] = [];
  if (!args.has("--past")) {
    const weeksArg = process.argv[process.argv.indexOf("--weeks") + 1];
    const weeks = args.has("--weeks") && weeksArg ? Number(weeksArg) : 3;
    const last = covers[covers.length - 1];
    const res = await fetchUpcoming(last ? last.date : new Date(), weeks, args.has("--all-days"));
    unnamed = res.unnamed;
    console.log(`${res.shows.length} upcoming session(s) in the next ${weeks} week(s).`);
    let n = mixes.length;
    for (const u of res.shows) {
      covers.push({
        session: ++n,
        artist: u.artist,
        date: u.date,
        dir: UPCOMING_DIR,
        provisional: true,
      });
    }
  }

  console.log("");
  let made = 0;
  for (const c of covers) {
    const status = render(c, force, dry);
    if (status === "rendered") made++;
    const tag = c.provisional ? " (provisional)" : "";
    console.log(
      `  ${String(c.session).padStart(3, "0")}  ${dateLabel(c.date).padEnd(11)} ${c.artist}${tag}` +
        (status === "skipped" ? "   — already drawn" : "")
    );
  }

  if (!dry) {
    const state: State = existsSync(STATE_PATH)
      ? (JSON.parse(readFileSync(STATE_PATH, "utf-8")) as State)
      : { lastSession: 0, sessions: {} };
    for (const c of covers.filter((x) => !x.provisional)) {
      state.sessions[String(c.session)] = `${c.artist} ${dateLabel(c.date)}`;
      state.lastSession = Math.max(state.lastSession, c.session);
    }
    writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + "\n");
  }

  console.log(`\n${dry ? "Would render" : "Rendered"} ${made} cover(s).`);
  if (unnamed.length) {
    console.log("\nCalendar entries with no artist named yet — no cover drawn:");
    for (const u of unnamed) console.log(`  ${u}`);
  }
  if (ties.length) {
    console.log("\nSame-day shows — order is from upload time, worth a sanity check:");
    for (const t of ties) {
      console.log(
        `  ${dateLabel(t[0].date)}: ` +
          t.map((c) => `${String(c.session).padStart(3, "0")} ${c.artist}`).join("  then  ")
      );
    }
  }
}

main().catch((err) => {
  console.error("Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
