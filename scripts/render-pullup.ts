#!/usr/bin/env bun
/**
 * Render one looping "PullUp" clip per event from the Waterhouse Studios
 * calendar API. Artists forward these to friends before their show.
 *
 * A solo booking gets a clip named after the artist. A shared booking - two
 * or more artists on the same reservation - gets ONE clip named after the
 * event, with everybody on the bill in the player frame.
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
 * Output: out/PullUp-{artist-or-event-slug}-{YYYY-MM-DD}.mp4
 */

import { execSync } from "child_process";
import { writeFileSync } from "fs";
import { PULLUP_DURATION } from "../src/PullUp";
import {
  hashSeed,
  initials,
  jobFeaturedIds,
  jobName,
  jobSeedSource,
  jobSlug,
  makeRng,
  pickDistinct,
  planJobs,
  type PullUpArtist,
  type PullUpJob,
} from "../src/pullup/plan";
import {
  PANEL_ASPECT,
  PLAYER_ASPECT,
  frameFace,
  type Framing,
} from "../src/pullup/framing";
import { detectFace, type Detection } from "./face-detect";

const API_BASE = "https://api.waterhousestudios.nl/api";

// --- Types matching the API response ---
type Artist = PullUpArtist;

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

// Roster rows carry stale profile URLs (dead SoundCloud CDN links, 404s), so
// weed them out once up front and let the composition fall back to initials.
// This is a cheap first pass, not a guarantee: a host can answer Bun and
// still refuse Chromium (imgproxy.ra.co behind Cloudflare does exactly that),
// which is why <SafeImg> in src/PullUp.tsx catches the rest at render time.
const imageCache = new Map<string, Uint8Array | null>();

async function imageBytes(url: string | null): Promise<Uint8Array | null> {
  if (!url) return null;
  const cached = imageCache.get(url);
  if (cached !== undefined) return cached;

  let bytes: Uint8Array | null = null;
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Accept: "image/*" },
      signal: AbortSignal.timeout(8000),
    });
    if (
      res.ok &&
      (res.headers.get("content-type") || "").indexOf("image") === 0
    ) {
      bytes = new Uint8Array(await res.arrayBuffer());
    }
  } catch {
    bytes = null;
  }
  if (!bytes) {
    console.log(`  (skipping unreachable image ${url})`);
  }
  imageCache.set(url, bytes);
  return bytes;
}

async function imageLoads(url: string | null): Promise<boolean> {
  return (await imageBytes(url)) !== null;
}

// A photo, framed. `targetAspect` is the window it has to hang in; pass null
// for the small round avatars, which stay a plain centred cover crop.
const faceCache = new Map<string, Detection | null>();

async function photo(
  url: string | null,
  targetAspect: number | null,
): Promise<{ image: string | null; framing?: Framing }> {
  const bytes = await imageBytes(url);
  if (!bytes || !url) return { image: null };
  if (targetAspect === null) return { image: url };

  if (!faceCache.has(url)) {
    faceCache.set(url, await detectFace(bytes));
  }
  const detection = faceCache.get(url) ?? null;
  if (!detection) return { image: url };

  const framing = frameFace({
    imageWidth: detection.imageWidth,
    imageHeight: detection.imageHeight,
    face: detection.face,
    targetAspect,
  });
  console.log(
    detection.face
      ? `  (face at ${detection.face.x},${detection.face.y} ${detection.face.width}x${detection.face.height} -> ${framing.fit} ${framing.position})`
      : `  (no face found in ${url})`,
  );
  return { image: url, framing };
}

// --- Build the "room" from the rest of the roster ---
async function buildAvatars(
  roster: Artist[],
  featuredIds: string[],
  rng: () => number,
): Promise<Array<{ label: string; image: string | null }>> {
  const featured = new Set(featuredIds);
  const others = roster.filter((a) => !featured.has(a.id));
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
  headliner: string,
  rng: () => number,
): Array<{ name: string; text: string }> {
  const names = pickDistinct(CHAT_NAMES, 2, rng);
  const texts = pickDistinct(CHAT_POOL, 2, rng);
  return [
    { name: "you", text: `let's go ${headliner}!` },
    { name: names[0], text: texts[0] },
    { name: names[1], text: texts[1] },
  ];
}

// --- Render one clip ---
async function renderClip(job: PullUpJob, roster: Artist[]): Promise<string> {
  const event = job.event;
  const seed = hashSeed(jobSeedSource(job));
  const rng = makeRng(seed);

  // The headline name: the artist, or the night they share. The chat's "you"
  // line follows it, so a shared clip reads "let's go Beatshopping!".
  const name = jobName(job);

  // Only shared bookings carry `performers`; a solo clip's props stay exactly
  // the shape they have always been.
  // A two-artist bill splits the window down the middle, so each photo is
  // framed against a much narrower box. Three or more become round chips,
  // which do not need framing at all.
  const billAspect =
    job.kind === "shared" && job.artists.length === 2 ? PANEL_ASPECT : null;

  const performers =
    job.kind === "shared"
      ? await Promise.all(
          job.artists.map(async (a) => ({
            name: a.stage_name,
            ...(await photo(a.profile_image_url, billAspect)),
          })),
        )
      : undefined;

  const solo =
    job.kind === "solo"
      ? await photo(job.artist.profile_image_url, PLAYER_ASPECT)
      : { image: null as string | null, framing: undefined };

  const props = {
    artistName: name,
    artistImage: solo.image,
    ...(solo.framing ? { artistFraming: solo.framing } : {}),
    genre: job.kind === "solo" ? job.artist.genre || job.artist.bio : null,
    eventDay: formatDay(event.start_time),
    eventTime: formatTime(event.start_time),
    eventDate: formatDate(event.start_time),
    avatars: await buildAvatars(roster, jobFeaturedIds(job), rng),
    chatLines: buildChatLines(name, rng),
    ...(performers ? { performers } : {}),
    seed: seed % 4,
  };

  const stem = `${jobSlug(job)}-${isoDay(event.start_time)}`;
  const outPath = `out/PullUp-${stem}.mp4`;
  const propsPath = `/tmp/waterhouse-pullup-${stem}.json`;
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

  // One clip per artist, except a shared booking, which is one per event.
  const jobs = planJobs(chosen);

  console.log(
    `\nRendering ${jobs.length} clip(s), ${PULLUP_DURATION} frames each (${(PULLUP_DURATION / 30).toFixed(1)}s):`,
  );
  for (const j of jobs) {
    const bill =
      j.kind === "shared"
        ? ` (${j.artists.map((a) => a.stage_name).join(" + ")})`
        : "";
    console.log(
      `  ${formatDate(j.event.start_time)} ${formatTime(j.event.start_time)} - ${jobName(j)}${bill}`,
    );
  }

  const written: string[] = [];
  for (const j of jobs) {
    written.push(await renderClip(j, roster));
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
