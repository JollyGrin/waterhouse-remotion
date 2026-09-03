#!/usr/bin/env bun
/**
 * Render one looping "PullUp" clip per artist per event, from the Waterhouse
 * Studios calendar API. Artists forward these to friends before their show.
 *
 * Usage:
 *   bun scripts/render-pullup.ts          # interactive picker (next 5 events)
 *   bun scripts/render-pullup.ts --all    # every approved event in the next 7
 *                                         # days, no prompts
 *
 * Interactive mode prompts for a bearer token (or a full curl command); press
 * Enter for the public endpoint without auth. `--all` never prompts: it uses
 * $WATERHOUSE_TOKEN if set, otherwise no auth.
 *
 * Output: out/PullUp-{artist-slug}-{YYYY-MM-DD}.mp4
 */

import { execSync } from "child_process";
import { writeFileSync } from "fs";
import { PULLUP_DURATION } from "../src/PullUp";

const API_BASE = "https://api.waterhousestudios.nl/api";

// --- Types matching the API response ---
interface Artist {
  id: string;
  stage_name: string;
  bio: string | null;
  genre: string | null;
  website: string | null;
  social_media: string | null;
  profile_image_url: string | null;
}

interface Reservation {
  id: string;
  start_time: string;
  end_time: string;
  status: string;
  purpose: string | null;
  description: string | null;
  guest_name: string | null;
  color: string | null;
  artists: Artist[];
}

// --- Chat pool: short, casual, muted-friendly one-liners ---
const CHAT_POOL = [
  "heyy \u{1F44B}",
  "track 3 is nasty",
  "what is this??",
  "oh this goes hard",
  "who is on rn",
  "the bass tho",
  "tuned in from work",
  "shazam is useless here",
  "10 min in, staying",
  "sound is crisp",
  "someone ID this",
  "back for round two",
];

const CHAT_NAMES = [
  "mira",
  "joos",
  "sef",
  "tunahead",
  "nadi",
  "roos",
  "bram",
  "kx",
  "lore",
  "vic",
  "dani",
  "flo",
];

// --- Deterministic seeded RNG (mulberry32) ---
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

function pickDistinct<T>(pool: T[], count: number, rng: () => number): T[] {
  const remaining = pool.slice();
  const out: T[] = [];
  while (out.length < count && remaining.length > 0) {
    const i = Math.floor(rng() * remaining.length);
    out.push(remaining.splice(i, 1)[0]);
  }
  return out;
}

function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// --- Token extraction (same behaviour as render-weekly.ts) ---
function extractBearerToken(input: string): string | null {
  if (!input.includes(" ") && input.includes(".")) {
    return input.trim();
  }
  const match = input.match(/Bearer\s+([A-Za-z0-9_\-\.]+)/);
  return match ? match[1] : null;
}

// --- Date helpers ---
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

function formatDay(dateStr: string): string {
  return DAYS[new Date(dateStr).getDay()].toUpperCase();
}

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function isoDay(dateStr: string): string {
  const d = new Date(dateStr);
  const m = `${d.getMonth() + 1}`;
  const day = `${d.getDate()}`;
  return `${d.getFullYear()}-${m.length < 2 ? `0${m}` : m}-${day.length < 2 ? `0${day}` : day}`;
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "artist"
  );
}

function initials(name: string): string {
  // Strip punctuation first - stage names like "(N)ARZ" would otherwise
  // yield "(N" as their avatar label.
  const parts = name
    .replace(/[^A-Za-z0-9\s]/g, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "??";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

// --- API fetch ---
async function fetchReservations(token: string | null): Promise<Reservation[]> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}/reservations/public`, { headers });
  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as { reservations: Reservation[] };
  return data.reservations;
}

// Roster rows carry stale profile URLs (dead SoundCloud CDN links, 404s).
// Remotion's <Img> retries a failing image on every frame, so weed them out
// once up front and let the composition fall back to initials.
const imageCache = new Map<string, boolean>();

async function imageLoads(url: string | null): Promise<boolean> {
  if (!url) return false;
  const cached = imageCache.get(url);
  if (cached !== undefined) return cached;

  let ok = false;
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Accept: "image/*" },
      signal: AbortSignal.timeout(8000),
    });
    ok =
      res.ok && (res.headers.get("content-type") || "").indexOf("image") === 0;
  } catch {
    ok = false;
  }
  if (!ok) {
    console.log(`  (skipping unreachable image ${url})`);
  }
  imageCache.set(url, ok);
  return ok;
}

// --- Build the "room" from the rest of the roster ---
async function buildAvatars(
  roster: Artist[],
  featuredId: string,
  rng: () => number,
): Promise<Array<{ label: string; image: string | null }>> {
  const others = roster.filter((a) => a.id !== featuredId);
  const chosen = pickDistinct(others, 6, rng);

  const avatars: Array<{ label: string; image: string | null }> = [];
  for (const a of chosen) {
    avatars.push({
      label: initials(a.stage_name),
      image: (await imageLoads(a.profile_image_url))
        ? a.profile_image_url
        : null,
    });
  }

  // Pad with initials-only stand-ins if the roster is small.
  const filler = pickDistinct(CHAT_NAMES, 6, rng);
  let f = 0;
  while (avatars.length < 6) {
    avatars.push({
      label: initials(filler[f % filler.length]),
      image: null,
    });
    f++;
  }
  return avatars;
}

// The first bubble is always yours - you are the first one in the room, and
// the composition styles the "you" line with the accent colour to match the
// leading YOU avatar. The other two are seeded picks from the pool.
function buildChatLines(
  artistName: string,
  rng: () => number,
): Array<{ name: string; text: string }> {
  const names = pickDistinct(CHAT_NAMES, 2, rng);
  const texts = pickDistinct(CHAT_POOL, 2, rng);
  return [
    { name: "you", text: `let's go ${artistName}!` },
    { name: names[0], text: texts[0] },
    { name: names[1], text: texts[1] },
  ];
}

// --- Render one clip ---
async function renderClip(
  event: Reservation,
  artist: Artist,
  roster: Artist[],
): Promise<string> {
  const seedSource = `${event.id}:${artist.id}`;
  const seed = hashSeed(seedSource);
  const rng = makeRng(seed);

  const props = {
    artistName: artist.stage_name,
    artistImage: (await imageLoads(artist.profile_image_url))
      ? artist.profile_image_url
      : null,
    genre: artist.genre || artist.bio,
    eventDay: formatDay(event.start_time),
    eventTime: formatTime(event.start_time),
    eventDate: formatDate(event.start_time),
    avatars: await buildAvatars(roster, artist.id, rng),
    chatLines: buildChatLines(artist.stage_name, rng),
    seed: seed % 4,
  };

  const outPath = `out/PullUp-${slugify(artist.stage_name)}-${isoDay(event.start_time)}.mp4`;
  const propsPath = `/tmp/waterhouse-pullup-${slugify(artist.stage_name)}-${isoDay(event.start_time)}.json`;
  writeFileSync(propsPath, JSON.stringify(props, null, 2));

  const cmd = [
    "bunx",
    "remotion",
    "render",
    "src/index.ts",
    "PullUp",
    outPath,
    `--props=${propsPath}`,
  ].join(" ");

  console.log(`\n$ ${cmd}`);
  execSync(cmd, {
    stdio: ["ignore", "inherit", "inherit"],
    cwd: process.cwd(),
  });
  return outPath;
}

// A reservation with no linked artists still gets a clip, using the purpose
// line as the name — same fallback WeeklyLineup uses.
function syntheticArtist(event: Reservation): Artist {
  const name =
    event.purpose?.replace(/^(Radio|Reserved|Private):\s*/i, "") || "Event";
  return {
    id: `synthetic-${event.id}`,
    stage_name: name,
    bio: null,
    genre: null,
    website: null,
    social_media: null,
    profile_image_url: null,
  };
}

// --- Main ---
async function main() {
  const all = process.argv.indexOf("--all") !== -1;

  console.log("=== Waterhouse PullUp Renderer ===\n");

  let token: string | null = null;
  if (all) {
    token = process.env.WATERHOUSE_TOKEN || null;
    console.log(
      token
        ? "--all: using $WATERHOUSE_TOKEN.\n"
        : "--all: no prompts, no authentication.\n",
    );
  } else {
    console.log(
      "Paste a bearer token, a full curl command, or press Enter for no auth:",
    );
    const input = (await readLine()).trim();
    if (input) {
      token = extractBearerToken(input);
      if (!token) {
        console.error("Could not extract a bearer token from your input.");
        process.exit(1);
      }
      console.log(`Using token: ${token.slice(0, 20)}...${token.slice(-10)}\n`);
    } else {
      console.log("Proceeding without authentication.\n");
    }
  }

  console.log("Fetching reservations...");
  const allReservations = await fetchReservations(token);
  const reservations = allReservations.filter((r) => r.status === "approved");
  console.log(
    `Found ${allReservations.length} total, ${reservations.length} approved.`,
  );

  // Everyone we've ever seen on a reservation is "the studio family".
  const rosterById = new Map<string, Artist>();
  for (const r of allReservations) {
    for (const a of r.artists) {
      if (!rosterById.has(a.id)) rosterById.set(a.id, a);
    }
  }
  const roster = Array.from(rosterById.values());

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const upcomingAll = reservations
    .filter((r) => new Date(r.start_time) >= today)
    .sort(
      (a, b) =>
        new Date(a.start_time).getTime() - new Date(b.start_time).getTime(),
    );

  let chosen: Reservation[];

  if (all) {
    const weekEnd = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
    chosen = upcomingAll.filter((r) => new Date(r.start_time) < weekEnd);
    if (chosen.length === 0) {
      console.error("No approved events in the next 7 days.");
      process.exit(1);
    }
  } else {
    const upcoming = upcomingAll.slice(0, 5);
    if (upcoming.length === 0) {
      console.error("No upcoming events found.");
      process.exit(1);
    }

    console.log("\nUpcoming events (toggle with number, Enter to confirm):\n");
    const selected = new Set<number>(upcoming.map((_, i) => i));

    const printMenu = () => {
      for (let i = 0; i < upcoming.length; i++) {
        const r = upcoming[i];
        const check = selected.has(i) ? "[x]" : "[ ]";
        const artistNames = r.artists.map((a) => a.stage_name).join(", ");
        const label = `${formatDate(r.start_time)} ${formatTime(r.start_time)} - ${r.purpose || "Event"}${artistNames ? ` (${artistNames})` : ""}`;
        console.log(`  ${i + 1}) ${check} ${label}`);
      }
      console.log("\nType numbers to toggle (e.g. 1 3), then Enter to render:");
    };

    printMenu();

    for (;;) {
      const line = (await readLine()).trim();
      if (line === "") break;
      const nums = line.split(/[\s,]+/).map(Number);
      for (const n of nums) {
        if (n >= 1 && n <= upcoming.length) {
          if (selected.has(n - 1)) {
            selected.delete(n - 1);
          } else {
            selected.add(n - 1);
          }
        }
      }
      console.log("");
      printMenu();
    }

    chosen = upcoming.filter((_, i) => selected.has(i));
    if (chosen.length === 0) {
      console.error("No events selected.");
      process.exit(1);
    }
  }

  // One clip per artist per event.
  const jobs: Array<{ event: Reservation; artist: Artist }> = [];
  for (const event of chosen) {
    const artists =
      event.artists.length > 0 ? event.artists : [syntheticArtist(event)];
    for (const artist of artists) {
      jobs.push({ event, artist });
    }
  }

  console.log(
    `\nRendering ${jobs.length} clip(s), ${PULLUP_DURATION} frames each (${(PULLUP_DURATION / 30).toFixed(1)}s):`,
  );
  for (const j of jobs) {
    console.log(
      `  ${formatDate(j.event.start_time)} ${formatTime(j.event.start_time)} - ${j.artist.stage_name}`,
    );
  }

  const written: string[] = [];
  for (const j of jobs) {
    written.push(await renderClip(j.event, j.artist, roster));
  }

  console.log(`\nDone! ${written.length} file(s):`);
  for (const w of written) {
    console.log(`  ${w}`);
  }
}

// Reads one line from stdin. Keeps whatever else arrived in the same chunk
// buffered, so the picker also works when input is piped in.
let stdinBuffer = "";

function readLine(): Promise<string> {
  return new Promise((resolve) => {
    const newlineIdx = stdinBuffer.indexOf("\n");
    if (newlineIdx !== -1) {
      const line = stdinBuffer.slice(0, newlineIdx);
      stdinBuffer = stdinBuffer.slice(newlineIdx + 1);
      resolve(line.trim());
      return;
    }

    const stdin = process.stdin;
    stdin.setEncoding("utf-8");
    stdin.resume();

    const onData = (chunk: string) => {
      stdinBuffer += chunk;
      const idx = stdinBuffer.indexOf("\n");
      if (idx !== -1) {
        const line = stdinBuffer.slice(0, idx);
        stdinBuffer = stdinBuffer.slice(idx + 1);
        stdin.removeListener("data", onData);
        stdin.pause();
        resolve(line.trim());
      }
    };

    stdin.on("data", onData);
  });
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
