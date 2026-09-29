#!/usr/bin/env bun
/**
 * Render the looping "WaterhouseSession" clip for a Tuesday "Waterhouse
 * Sessions" night: Denzo hosts, usually interviews the guest, then the guest
 * plays. The guest forwards it to friends, same as a PullUp.
 *
 * Usage:
 *   bun run render:session --guest "Duncen"
 *   bun run render:session --guest "Duncen" --date 2026-10-06
 *   bun run render:session --guest "Duncen" --time 20:00
 *   bun run render:session --guest "Duncen" --interview-minutes 30
 *   bun run render:session --guest "Duncen" --no-interview
 *
 * --guest   the guest's stage name on the Waterhouse portal. A first name is
 *           enough if it is unambiguous ("Duncen" -> "Duncen Haakmat").
 * --date    YYYY-MM-DD, default today.
 * --time    HH:MM, default the Waterhouse Sessions slot on the portal
 *           calendar for that date.
 * --interview-minutes   default 20.
 * --no-interview        a plain guest set, Denzo still hosting.
 *
 * Photos for both Denzo and the guest come from their portal artist profiles.
 * Uses $WATERHOUSE_TOKEN if set, otherwise the public calendar endpoint.
 *
 * Output: out/Session-{guest-slug}-{YYYY-MM-DD}.mp4
 */

import { writeFileSync } from "fs";
import {
  SESSION_DURATION,
  SESSION_PHOTO_FAILED_MARKER,
} from "../src/WaterhouseSession";
import {
  hashSeed,
  initials,
  makeRng,
  pickDistinct,
  slugify,
} from "../src/pullup/plan";
import {
  DEFAULT_INTERVIEW_MINUTES,
  HOST_NAME,
  findSessionSlot,
  matchArtist,
  runningOrder,
  sessionStem,
  type SessionArtist,
  type SessionReservation,
} from "../src/session/plan";

const API_BASE = "https://api.waterhousestudios.nl/api";

// --- Chat pools: short, casual, muted-friendly one-liners ---
const INTERVIEW_CHAT = [
  "denzo ask about the first gig",
  "interview then set?? perfect",
  "staying for the set",
  "love these sessions",
  "tuesday ritual",
  "ask about the setup!",
  "tuned in from work",
  "what got you into djing?",
  "the story first, then the drop",
  "heyy \u{1F44B}",
];

const SET_CHAT = [
  "heyy \u{1F44B}",
  "tuesday ritual",
  "oh this goes hard",
  "the bass tho",
  "tuned in from work",
  "someone ID this",
  "sound is crisp",
  "10 min in, staying",
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

// --- Date helpers (local time, same as render-pullup.ts) ---
const DAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
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

const pad2 = (n: number) => (n < 10 ? `0${n}` : `${n}`);

function isoDay(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function hhmm(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** Local midnight of a `YYYY-MM-DD`, or null if it is not one. */
function parseDay(day: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return isoDay(d) === day ? d : null;
}

// --- Args ---
interface Args {
  guest: string;
  day: string;
  time: string | null;
  interview: boolean;
  interviewMinutes: number;
}

function usage(message: string): never {
  console.error(`${message}\n`);
  console.error(
    'Usage: bun run render:session --guest "Duncen" [--date YYYY-MM-DD] [--time HH:MM] [--interview-minutes 20] [--no-interview]',
  );
  process.exit(1);
}

function parseArgs(argv: string[]): Args {
  const value = (flag: string): string | null => {
    const i = argv.indexOf(flag);
    if (i === -1) return null;
    const v = argv[i + 1];
    if (v === undefined || v.indexOf("--") === 0)
      usage(`${flag} needs a value.`);
    return v;
  };

  const guest = value("--guest");
  if (!guest || !guest.trim()) usage("--guest is required.");

  const day = value("--date") ?? isoDay(new Date());
  if (!parseDay(day)) usage(`--date must be YYYY-MM-DD, got "${day}".`);

  const time = value("--time");
  if (time !== null && !/^\d{1,2}:\d{2}$/.test(time)) {
    usage(`--time must be HH:MM, got "${time}".`);
  }

  const minutesArg = value("--interview-minutes");
  const interviewMinutes =
    minutesArg === null ? DEFAULT_INTERVIEW_MINUTES : Number(minutesArg);
  if (
    !Number.isInteger(interviewMinutes) ||
    interviewMinutes < 1 ||
    interviewMinutes > 180
  ) {
    usage(`--interview-minutes must be a whole number 1-180.`);
  }

  return {
    guest: guest.trim(),
    day,
    time: time && time.length === 4 ? `0${time}` : time,
    interview: argv.indexOf("--no-interview") === -1,
    interviewMinutes,
  };
}

// --- API fetch ---
async function fetchReservations(
  token: string | null,
): Promise<SessionReservation[]> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}/reservations/public`, { headers });
  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as { reservations: SessionReservation[] };
  return data.reservations;
}

// Headers-only preflight, same as render-pullup.ts: weeds out dead profile
// URLs before Chromium sees them. Hosts that answer Bun and then refuse
// Chromium are caught at render time by <SafeImg>.
async function imageLoads(url: string | null): Promise<boolean> {
  if (!url) return false;
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Accept: "image/*" },
      signal: AbortSignal.timeout(8000),
    });
    const ok =
      res.ok && (res.headers.get("content-type") || "").indexOf("image") === 0;
    await res.body?.cancel();
    return ok;
  } catch {
    return false;
  }
}

// --- The room: the rest of the roster, minus whoever is on screen ---
async function buildAvatars(
  roster: SessionArtist[],
  featuredIds: string[],
  rng: () => number,
): Promise<Array<{ label: string; image: string | null }>> {
  const featured = new Set(featuredIds);
  const chosen = pickDistinct(
    roster.filter((a) => !featured.has(a.id)),
    6,
    rng,
  );

  const avatars: Array<{ label: string; image: string | null }> = [];
  for (const a of chosen) {
    avatars.push({
      label: initials(a.stage_name),
      image: (await imageLoads(a.profile_image_url))
        ? a.profile_image_url
        : null,
    });
  }

  const filler = pickDistinct(CHAT_NAMES, 6, rng);
  let f = 0;
  while (avatars.length < 6) {
    avatars.push({ label: initials(filler[f % filler.length]), image: null });
    f++;
  }
  return avatars;
}

// The first bubble is always yours; the other two are seeded picks from the
// pool for the night's format.
function buildChatLines(
  guest: string,
  interview: boolean,
  rng: () => number,
): Array<{ name: string; text: string }> {
  const names = pickDistinct(CHAT_NAMES, 2, rng);
  const texts = pickDistinct(interview ? INTERVIEW_CHAT : SET_CHAT, 2, rng);
  return [
    { name: "you", text: `let's go ${guest}!` },
    { name: names[0], text: texts[0] },
    { name: names[1], text: texts[1] },
  ];
}

// --- Render, teeing output so photo failures inside Chromium can be found ---
async function runRender(cmd: string[]): Promise<string> {
  const child = Bun.spawn(cmd, {
    cwd: process.cwd(),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });

  let captured = "";
  const tee = async (
    stream: ReadableStream<Uint8Array>,
    out: NodeJS.WriteStream,
  ) => {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      captured += text;
      out.write(text);
    }
  };

  await Promise.all([
    tee(child.stdout, process.stdout),
    tee(child.stderr, process.stderr),
  ]);
  const code = await child.exited;
  if (code !== 0) throw new Error(`remotion render exited with ${code}`);
  return captured;
}

/** Photos that passed the preflight and then failed inside Chromium. */
export function failedPhotosIn(output: string): string[] {
  const pattern = new RegExp(`${SESSION_PHOTO_FAILED_MARKER}\\s+(\\S+)`, "g");
  return Array.from(new Set(Array.from(output.matchAll(pattern), (m) => m[1])));
}

/** A person's name and usable photo, noting why there is none. */
async function person(
  label: string,
  typed: string,
  artist: SessionArtist | null,
  problems: string[],
): Promise<{ name: string; image: string | null }> {
  if (!artist) {
    problems.push(`${label} "${typed}" is not on the portal - initials only.`);
    return { name: typed, image: null };
  }
  if (!artist.profile_image_url) {
    problems.push(
      `${label} ${artist.stage_name} has no profile photo on the portal - initials only.`,
    );
    return { name: artist.stage_name, image: null };
  }
  if (!(await imageLoads(artist.profile_image_url))) {
    problems.push(
      `${label} ${artist.stage_name}'s photo does not load - initials only:\n     ${artist.profile_image_url}`,
    );
    return { name: artist.stage_name, image: null };
  }
  return { name: artist.stage_name, image: artist.profile_image_url };
}

// --- Main ---
async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log("=== Waterhouse Sessions Renderer ===\n");

  const date = parseDay(args.day) as Date;
  if (date.getDay() !== 2) {
    console.log(
      `!! ${args.day} is a ${DAYS[date.getDay()]}, not a Tuesday. Rendering anyway.\n`,
    );
  }

  const token = process.env.WATERHOUSE_TOKEN || null;
  console.log(
    token ? "Using $WATERHOUSE_TOKEN." : "Public calendar, no authentication.",
  );
  const reservations = await fetchReservations(token);

  // Everyone ever seen on a reservation is the studio family.
  const rosterById = new Map<string, SessionArtist>();
  for (const r of reservations) {
    for (const a of r.artists) {
      if (!rosterById.has(a.id)) rosterById.set(a.id, a);
    }
  }
  const roster = Array.from(rosterById.values());

  const slot = findSessionSlot(reservations, args.day, (iso) =>
    isoDay(new Date(iso)),
  );
  let eventTime: string;
  if (args.time) {
    eventTime = args.time;
    console.log(`Start time ${eventTime} (--time).`);
  } else if (slot) {
    eventTime = hhmm(new Date(slot.start_time));
    console.log(`Start time ${eventTime} from the portal calendar.`);
  } else {
    usage(
      `No approved Waterhouse Sessions booking on ${args.day} in the portal calendar. Pass --time HH:MM.`,
    );
  }

  const slotArtists = slot ? slot.artists : [];
  const problems: string[] = [];

  const hostMatch = matchArtist(HOST_NAME, slotArtists, roster);
  const hostArtist = hostMatch.kind === "found" ? hostMatch.artist : null;

  const guestMatch = matchArtist(
    args.guest,
    slotArtists.filter((a) => a.id !== hostArtist?.id),
    roster,
  );
  if (guestMatch.kind === "ambiguous") {
    usage(
      `"${args.guest}" matches more than one artist: ${guestMatch.candidates
        .map((a) => a.stage_name)
        .join(", ")}. Use the full stage name.`,
    );
  }
  const guestArtist = guestMatch.kind === "found" ? guestMatch.artist : null;
  if (
    slot &&
    guestArtist &&
    !slotArtists.some((a) => a.id === guestArtist.id)
  ) {
    console.log(
      `!! ${guestArtist.stage_name} is not linked to the ${args.day} session booking on the portal. Rendering anyway.`,
    );
  }

  const guest = await person("Guest", args.guest, guestArtist, problems);
  const host = await person("Host", HOST_NAME, hostArtist, problems);

  const seed = hashSeed(`session:${args.day}:${slugify(guest.name)}`);
  const rng = makeRng(seed);

  const props = {
    guest,
    host,
    eventDay: DAYS[date.getDay()],
    eventTime,
    eventDate: `${DAYS[date.getDay()].slice(0, 3)} ${date.getDate()} ${MONTHS[date.getMonth()]}`,
    interview: args.interview,
    interviewMinutes: args.interviewMinutes,
    avatars: await buildAvatars(
      roster,
      [guestArtist?.id, hostArtist?.id].filter((id): id is string => !!id),
      rng,
    ),
    chatLines: buildChatLines(guest.name, args.interview, rng),
    seed: seed % 4,
  };

  const stem = sessionStem(args.guest, args.day);
  const outPath = `out/${stem}.mp4`;
  const propsPath = `/tmp/waterhouse-${stem}.json`;
  writeFileSync(propsPath, JSON.stringify(props, null, 2));

  console.log(
    `\n${guest.name} with ${host.name}, ${props.eventDate}: ${runningOrder({
      hostName: host.name,
      eventTime,
      interview: args.interview,
      interviewMinutes: args.interviewMinutes,
    })}`,
  );
  console.log(
    `${SESSION_DURATION} frames (${(SESSION_DURATION / 30).toFixed(1)}s) -> ${outPath}`,
  );

  const cmd = [
    "bunx",
    "remotion",
    "render",
    "src/index.ts",
    "WaterhouseSession",
    outPath,
    `--props=${propsPath}`,
  ];
  console.log(`\n$ ${cmd.join(" ")}`);
  const output = await runRender(cmd);

  // A failed face (guest or host) is the loud case; a room avatar falling
  // back to initials is only worth a note.
  const roomFallbacks: string[] = [];
  for (const src of failedPhotosIn(output)) {
    const who =
      src === guest.image ? "Guest" : src === host.image ? "Host" : null;
    if (who) {
      problems.push(
        `${who} photo loaded in the preflight but not in the render:\n     ${src}`,
      );
    } else {
      roomFallbacks.push(src);
    }
  }

  console.log(`\nDone! ${outPath}`);

  if (roomFallbacks.length > 0) {
    console.log(
      `\n(${roomFallbacks.length} room avatar(s) fell back to initials - fine to forward:)`,
    );
    for (const src of roomFallbacks) console.log(`   ${src}`);
  }

  // Loud on purpose: the clip looks finished and is missing a face.
  if (problems.length > 0) {
    console.log(`\n!! ${outPath} shows INITIALS where a face should be:`);
    for (const p of problems) console.log(`   - ${p}`);
    console.log("   Fix the profile image on the portal before forwarding it.");
  }
}

// Only when run as the script, so a test can import from here.
if (/render-session\.ts$/.test(process.argv[1] ?? "")) {
  main().catch((err) => {
    console.error("Error:", err);
    process.exit(1);
  });
}
