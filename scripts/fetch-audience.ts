#!/usr/bin/env bun
/**
 * Build props for the "Who Showed Up" recaps from live data.
 *
 * Pulls stream sessions + 30-second chatter snapshots from the event logger
 * and bookings from the Waterhouse API, runs them through
 * `src/audience/metrics.ts`, and writes JSON that validates against
 * `src/audience/schema.ts`. Data only — no rendering happens here.
 *
 * Usage:
 *   bun scripts/fetch-audience.ts artist "Tj Gee" --n 4 --out out/recap-tj-gee.json
 *   bun scripts/fetch-audience.ts week --end 2026-09-03 --out out/weekly-2026-w36.json
 *   bun scripts/fetch-audience.ts --fixtures
 *
 * Flags:
 *   --n <count>       sessions in an artist recap (default 4)
 *   --end <date>      last day of the window, YYYY-MM-DD (default: today)
 *   --days <count>    override the raw-data window. By default it is derived
 *                     from the sessions being analysed, so the 30-day
 *                     "pulled" and 90-day "returning" lookbacks always have
 *                     history behind them.
 *   --out <path>      where to write; defaults to out/<something>.json
 *
 * Everything it reads is public; no token is needed.
 */

import { mkdirSync, writeFileSync } from "fs";
import { dirname } from "path";
import {
  analyseSession,
  assignBadges,
  buildAttendance,
  buildExclusions,
  chatStatsOrNull,
  dateLabel,
  dayLabel,
  computeHoldRate,
  matchSessionToArtists,
  returningWindowStart,
  peakAcross,
  pulledWindowStart,
  rangeLabel,
  rankBoardRows,
  shortWeekLabel,
  studioEndOfDayMs,
  studioToday,
  timeLabel,
  toBoardRow,
  toMs,
  userIdsInSessions,
  weekLabel,
  type ArtistRef,
  type AttendedSession,
  type BoardCandidate,
  type ChatMessage,
  type ChatterSnapshot,
  type ReservationRef,
  type SessionMatch,
  type StreamSession,
} from "../src/audience/metrics";
import {
  artistRecapPropsSchema,
  houseWeeklyPropsSchema,
  type ArtistRecapProps,
  type HouseWeeklyProps,
  type NextWeekSlot,
  type SessionAudience,
} from "../src/audience/schema";

const LOGGER_BASE = "https://event-logger-production.up.railway.app";
const API_BASE = "https://api.waterhousestudios.nl/api";

const PAGE_SIZE = 1000;
/** Sessions and reservations are cheap, so we scan a wide net for them. */
const SCAN_DAYS = 400;
/** Cushion on the computed snapshot window, so a lookback never clips. */
const WINDOW_MARGIN_DAYS = 3;
const DEFAULT_RECAP_SESSIONS = 4;
const HOUSE_SERIES_WEEKS = 8;

const MS_PER_MIN = 60 * 1000;
const MS_PER_DAY = 24 * 60 * MS_PER_MIN;

// --- Raw API shapes -------------------------------------------------------

interface RawSession {
  start: string;
  end: string;
  duration_min: number;
  peak_viewers: number;
  unique_viewers: number;
  interactions: { follows?: number } | null;
}

interface RawChatEvent {
  timestamp: string;
  user_id: string;
  username: string;
}

interface RawSnapshot {
  timestamp: string;
  total_count: number;
  user_ids: string[];
  usernames: string[];
}

interface RawArtist {
  id: string;
  stage_name: string;
  profile_image_url: string | null;
  social_media: unknown;
}

interface RawReservation {
  id: string;
  start_time: string;
  end_time: string;
  status: string;
  purpose: string | null;
  artists: RawArtist[];
}

// --- Fetching -------------------------------------------------------------

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`GET ${url} -> ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as T;
}

/** Every stream the logger recorded in the window, oldest first. */
async function fetchSessions(
  startIso: string,
  endIso: string,
): Promise<StreamSession[]> {
  const out: StreamSession[] = [];
  let offset = 0;
  for (;;) {
    const url =
      `${LOGGER_BASE}/api/sessions/summary?start=${encodeURIComponent(startIso)}` +
      `&end=${encodeURIComponent(endIso)}&limit=${PAGE_SIZE}&offset=${offset}` +
      `&sparkline_points=2`;
    const page = await getJson<{ sessions: RawSession[]; total: number }>(url);
    for (const s of page.sessions) {
      out.push({
        start: s.start,
        end: s.end,
        durationMin: s.duration_min,
        peakViewers: s.peak_viewers,
        uniqueViewers: s.unique_viewers,
        follows: (s.interactions && s.interactions.follows) || 0,
      });
    }
    offset += page.sessions.length;
    if (page.sessions.length === 0 || offset >= page.total) break;
  }
  out.sort((a, b) => toMs(a.start) - toMs(b.start));
  return out;
}

/** Every 30-second chatter poll in the window. This is the slow one. */
async function fetchSnapshots(
  startIso: string,
  endIso: string,
): Promise<ChatterSnapshot[]> {
  const out: ChatterSnapshot[] = [];
  let offset = 0;
  for (;;) {
    const url =
      `${LOGGER_BASE}/api/chatters/snapshots?start=${encodeURIComponent(startIso)}` +
      `&end=${encodeURIComponent(endIso)}&limit=${PAGE_SIZE}&offset=${offset}`;
    const page = await getJson<{ snapshots: RawSnapshot[] }>(url);
    for (const s of page.snapshots) {
      out.push({
        timestamp: s.timestamp,
        userIds: s.user_ids || [],
        usernames: s.usernames || [],
      });
    }
    offset += page.snapshots.length;
    process.stdout.write(`\r  snapshots: ${out.length}`);
    if (page.snapshots.length < PAGE_SIZE) break;
  }
  process.stdout.write("\n");
  return out;
}

/**
 * Every chat line in the window. Chat capture is a later phase of the logger,
 * so an empty result is expected for now and means "no data", not "silence" —
 * `chatStatsOrNull` turns an empty session window into a null rather than a 0.
 */
async function fetchChat(
  startIso: string,
  endIso: string,
): Promise<ChatMessage[]> {
  const out: ChatMessage[] = [];
  let offset = 0;
  for (;;) {
    const url =
      `${LOGGER_BASE}/api/events/chat?start=${encodeURIComponent(startIso)}` +
      `&end=${encodeURIComponent(endIso)}&limit=${PAGE_SIZE}&offset=${offset}`;
    const page = await getJson<{ events: RawChatEvent[] | null }>(url);
    const events = page.events || [];
    for (const e of events) {
      out.push({
        timestamp: e.timestamp,
        userId: e.user_id,
        username: e.username,
      });
    }
    offset += events.length;
    if (events.length < PAGE_SIZE) break;
  }
  return out;
}

/**
 * `social_media` comes back as an object, a JSON string, or (for artists
 * edited more than once) an array of both. Dig a Twitch login out of any of
 * them so we can exclude the artist from their own audience.
 */
function extractTwitchLogin(social: unknown): string | null {
  if (!social) return null;
  if (typeof social === "string") {
    try {
      return extractTwitchLogin(JSON.parse(social));
    } catch {
      return null;
    }
  }
  if (Array.isArray(social)) {
    for (const entry of social) {
      const found = extractTwitchLogin(entry);
      if (found) return found;
    }
    return null;
  }
  if (typeof social !== "object") return null;
  const record = social as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (key.toLowerCase().indexOf("twitch") === -1) continue;
    const value = record[key];
    if (typeof value !== "string" || value.trim() === "") continue;
    const parts = value.trim().replace(/\/+$/, "").split("/");
    return parts[parts.length - 1].replace(/^@/, "").toLowerCase();
  }
  return null;
}

function toArtistRef(a: RawArtist): ArtistRef {
  return {
    id: a.id,
    stageName: a.stage_name,
    image: a.profile_image_url,
    twitchLogin: extractTwitchLogin(a.social_media),
  };
}

async function fetchReservations(): Promise<ReservationRef[]> {
  const data = await getJson<{ reservations: RawReservation[] }>(
    `${API_BASE}/reservations/public`,
  );
  return data.reservations.map((r) => ({
    id: r.id,
    purpose: r.purpose,
    start: r.start_time,
    end: r.end_time,
    status: r.status,
    artists: (r.artists || []).map(toArtistRef),
  }));
}

// Roster rows carry stale profile URLs (dead CDN links, 404s). Remotion's
// <Img> retries a failing image every frame, so weed them out here and let
// the compositions fall back to initials.
const imageCache = new Map<string, boolean>();

async function usableImage(url: string | null): Promise<string | null> {
  if (!url) return null;
  const cached = imageCache.get(url);
  if (cached !== undefined) return cached ? url : null;
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
  imageCache.set(url, ok);
  if (!ok) console.log(`  (dropping unreachable image ${url})`);
  return ok ? url : null;
}

// --- Analysis context -----------------------------------------------------

/** Sessions joined to their artists — enough to decide how far back to fetch. */
interface Joined {
  sessions: StreamSession[];
  matches: Map<string, SessionMatch>;
}

/** The cheap half of the load: what happened, and who it belonged to. */
interface Scan extends Joined {
  reservations: ReservationRef[];
}

interface Context {
  sessions: StreamSession[];
  snapshots: ChatterSnapshot[];
  chat: ChatMessage[];
  reservations: ReservationRef[];
  /** Session index (by start ISO) -> the artists it belongs to. */
  matches: Map<string, SessionMatch>;
  /** Sessions pre-joined to their artists, for the 90-day attendance maths. */
  attended: AttendedSession[];
  /** Oldest snapshot we hold; anything before this is a blind spot. */
  dataStartMs: number;
}

/**
 * Sessions and bookings only. Both are small, so this reaches back a long way
 * and lets the caller work out how much snapshot history it actually needs.
 */
async function scanSessions(endMs: number): Promise<Scan> {
  const startIso = new Date(endMs - SCAN_DAYS * MS_PER_DAY).toISOString();
  const endIso = new Date(endMs).toISOString();

  const reservations = await fetchReservations();
  console.log(`  reservations: ${reservations.length}`);
  const sessions = await fetchSessions(startIso, endIso);
  console.log(`  sessions: ${sessions.length} (last ${SCAN_DAYS} days)`);

  const matches = new Map<string, SessionMatch>();
  for (const s of sessions) {
    matches.set(s.start, matchSessionToArtists(s, reservations));
  }
  return { sessions, reservations, matches };
}

/**
 * The expensive half: snapshots and chat for `[startMs, endMs]`. The window
 * is computed from the sessions we mean to analyse, so the 30-day "pulled"
 * and 90-day "returning" lookbacks always have data behind them without
 * pulling a year of polls we would never read.
 */
async function loadContext(
  scan: Scan,
  startMs: number,
  endMs: number,
): Promise<Context> {
  const startIso = new Date(startMs).toISOString();
  const endIso = new Date(endMs).toISOString();
  console.log(`Data window: ${startIso} -> ${endIso}`);

  const snapshots = await fetchSnapshots(startIso, endIso);
  const chat = await fetchChat(startIso, endIso);
  console.log(
    chat.length > 0
      ? `  chat: ${chat.length} messages in the window`
      : "  chat: no rows - every session's chat will be null",
  );

  const sessions = scan.sessions.filter((s) => toMs(s.start) >= startMs);
  const matches = new Map<string, SessionMatch>();
  const attended: AttendedSession[] = [];
  for (const s of sessions) {
    const match = scan.matches.get(s.start) || {
      artists: [],
      reservation: null,
      shared: false,
    };
    matches.set(s.start, match);
    attended.push({ session: s, artistIds: match.artists.map((a) => a.id) });
  }

  return {
    sessions,
    snapshots,
    chat,
    reservations: scan.reservations,
    matches,
    attended,
    dataStartMs: startMs,
  };
}

/** How far back a session must see for both lookbacks to be complete. */
function requiredStartFor(sessionStartMs: number): number {
  return returningWindowStart(sessionStartMs) - WINDOW_MARGIN_DAYS * MS_PER_DAY;
}

function matchFor(ctx: Joined, session: StreamSession): SessionMatch {
  return (
    ctx.matches.get(session.start) || {
      artists: [],
      reservation: null,
      shared: false,
    }
  );
}

/** Sessions credited to one artist, oldest first. */
function sessionsForArtist(ctx: Joined, artistId: string): StreamSession[] {
  return ctx.sessions.filter((s) => {
    for (const a of matchFor(ctx, s).artists) {
      if (a.id === artistId) return true;
    }
    return false;
  });
}

interface Analysed {
  session: StreamSession;
  audience: SessionAudience;
  entries: ReturnType<typeof analyseSession>["entries"];
}

/** Sessions we have already grumbled about, so the warning fires once. */
const warned = new Set<string>();

/**
 * Run one session through the metrics module, resolving both lookbacks: the
 * 30-day "has anyone seen you before" window, and the 90-day attendance
 * record that decides whether this artist is the viewer's main artist.
 */
function analyse(
  ctx: Context,
  session: StreamSession,
  artist: ArtistRef,
): Analysed {
  const match = matchFor(ctx, session);
  const sStart = toMs(session.start);
  const lookbackStart = pulledWindowStart(sStart);
  const mainStart = returningWindowStart(sStart);
  if (mainStart < ctx.dataStartMs && !warned.has(session.start)) {
    warned.add(session.start);
    console.warn(
      `  ! ${session.start}: 90-day lookback reaches before the fetched window; "pulled"/"returning" may be overstated (raise --days)`,
    );
  }

  const exclusions = buildExclusions([artist.twitchLogin]);

  const result = analyseSession({
    session,
    snapshots: ctx.snapshots,
    exclusions,
    priorUserIds: userIdsInSessions(
      ctx.snapshots,
      ctx.sessions,
      lookbackStart,
      sStart,
    ),
    attendance: buildAttendance(
      ctx.snapshots,
      ctx.attended,
      artist.id,
      mainStart,
      sStart,
    ),
    chat: chatStatsOrNull(ctx.chat, [session], exclusions),
    slotIso: match.reservation ? match.reservation.start : null,
    shared: match.shared,
  });

  return { session, audience: result.audience, entries: result.entries };
}

// --- artist recap ---------------------------------------------------------

function findArtist(
  reservations: ReservationRef[],
  query: string,
): ArtistRef | null {
  const needle = query.trim().toLowerCase();
  let fuzzy: ArtistRef | null = null;
  for (const r of reservations) {
    for (const a of r.artists) {
      const name = a.stageName.toLowerCase();
      if (name === needle) return a;
      if (!fuzzy && name.indexOf(needle) !== -1) fuzzy = a;
    }
  }
  return fuzzy;
}

async function buildArtistRecap(
  ctx: Context,
  artist: ArtistRef,
  n: number,
  nowMs: number,
): Promise<ArtistRecapProps> {
  const all = sessionsForArtist(ctx, artist.id);
  if (all.length === 0) {
    throw new Error(
      `No sessions matched "${artist.stageName}" in the fetched window.`,
    );
  }

  const analysed: Analysed[] = all.map((session) =>
    analyse(ctx, session, artist),
  );

  let bestUniques = 0;
  let bestCrowd = 0;
  for (const a of analysed) {
    bestUniques = Math.max(bestUniques, a.audience.uniques);
    bestCrowd = Math.max(bestCrowd, a.audience.crowd);
  }

  const shown = analysed.slice(Math.max(0, analysed.length - n));

  // The next booking this artist is on.
  let next: ReservationRef | null = null;
  for (const r of ctx.reservations) {
    if (r.status !== "approved") continue;
    if (toMs(r.start) <= nowMs) continue;
    let onIt = false;
    for (const a of r.artists) {
      if (a.id === artist.id) onIt = true;
    }
    if (!onIt) continue;
    if (!next || toMs(r.start) < toMs(next.start)) next = r;
  }

  return {
    artistName: artist.stageName,
    artistImage: await usableImage(artist.image),
    sessions: shown.map((a) => a.audience),
    bestUniques,
    bestCrowd,
    nextSlot: next
      ? {
          dayLabel: dayLabel(next.start),
          time: timeLabel(next.start),
          dateLabel: dateLabel(next.start),
        }
      : null,
  };
}

/** "Radio: Sudden Rave" -> "Sudden Rave". */
function purposeName(r: ReservationRef): string {
  return (
    (r.purpose || "").replace(/^(Radio|Reserved|Private):\s*/i, "").trim() ||
    "Waterhouse"
  );
}

// --- weekly board ---------------------------------------------------------

/** New-to-house viewers in [fromMs, toMs): unseen in the 30 days before. */
function housePulled(
  ctx: Context,
  fromMs: number,
  toMsExclusive: number,
): number {
  const inWindow = userIdsInSessions(
    ctx.snapshots,
    ctx.sessions,
    fromMs,
    toMsExclusive,
  );
  const before = userIdsInSessions(
    ctx.snapshots,
    ctx.sessions,
    pulledWindowStart(fromMs),
    fromMs,
  );
  let pulled = 0;
  for (const id of inWindow) {
    if (!before.has(id)) pulled++;
  }
  return pulled;
}

async function buildHouseWeekly(
  ctx: Context,
  windowStartMs: number,
  windowEndMs: number,
): Promise<HouseWeeklyProps> {
  const inWindow = ctx.sessions.filter((s) => {
    const t = toMs(s.start);
    return t >= windowStartMs && t < windowEndMs;
  });

  // One bucket per artist with at least one session in the window.
  const buckets = new Map<
    string,
    { artist: ArtistRef; analysed: Analysed[]; shared: boolean }
  >();

  for (const session of inWindow) {
    const match = matchFor(ctx, session);
    for (const artist of match.artists) {
      const a = analyse(ctx, session, artist);
      const bucket = buckets.get(artist.id);
      if (bucket) {
        bucket.analysed.push(a);
        bucket.shared = bucket.shared || match.shared;
      } else {
        buckets.set(artist.id, {
          artist,
          analysed: [a],
          shared: match.shared,
        });
      }
    }
  }

  const candidates: BoardCandidate[] = [];
  for (const bucket of buckets.values()) {
    const ordered = bucket.analysed
      .slice()
      .sort((a, b) => toMs(a.session.start) - toMs(b.session.start));

    // Aggregate across the artist's sessions this week without counting
    // anyone twice: a viewer's kind is the one from their first appearance.
    const kinds = new Map<string, string>();
    const stayed = new Set<string>();
    for (const a of ordered) {
      for (const e of a.entries) {
        if (!kinds.has(e.userId)) kinds.set(e.userId, e.kind);
        if (e.stayed) stayed.add(e.userId);
      }
    }
    const peak = peakAcross(ordered.map((a) => a.audience));

    let pulled = 0;
    let returning = 0;
    for (const kind of kinds.values()) {
      if (kind === "pulled") pulled++;
      else if (kind === "returning") returning++;
    }
    const uniques = kinds.size;
    const crowd = pulled + returning;

    let follows = 0;
    for (const a of ordered) follows += a.audience.follows;

    // Chatters are distinct across the week, so this is computed over the
    // whole set of sessions rather than summed per session.
    const chat = chatStatsOrNull(
      ctx.chat,
      ordered.map((a) => a.session),
      buildExclusions([bucket.artist.twitchLogin]),
    );

    // Delta against the artist's own last session before this window.
    const history = sessionsForArtist(ctx, bucket.artist.id);
    let prior: StreamSession | null = null;
    for (const s of history) {
      if (toMs(s.start) < windowStartMs) prior = s;
    }
    const deltaCrowd = prior
      ? crowd - analyse(ctx, prior, bucket.artist).audience.crowd
      : null;

    candidates.push({
      artistId: bucket.artist.id,
      artistName: bucket.artist.stageName,
      artistImage: bucket.artist.image,
      crowd,
      pulled,
      returning,
      uniques,
      holdRate: computeHoldRate(stayed.size, uniques),
      peak,
      follows,
      chat,
      deltaCrowd,
      shared: bucket.shared,
      badges: [],
      firstSessionMs: toMs(ordered[0].session.start),
    });
  }

  assignBadges(candidates);
  const ranked = rankBoardRows(candidates);
  for (const row of ranked) {
    row.artistImage = await usableImage(row.artistImage);
  }

  // House totals.
  let houseFollows = 0;
  for (const s of inWindow) houseFollows += s.follows;

  const houseIds = userIdsInSessions(
    ctx.snapshots,
    ctx.sessions,
    windowStartMs,
    windowEndMs,
  );

  const houseSeries: Array<{ weekLabel: string; pulled: number }> = [];
  for (let i = HOUSE_SERIES_WEEKS - 1; i >= 0; i--) {
    const blockEnd = windowEndMs - i * 7 * MS_PER_DAY;
    const blockStart = blockEnd - 7 * MS_PER_DAY;
    houseSeries.push({
      weekLabel: shortWeekLabel(new Date(blockEnd - 1)),
      pulled: housePulled(ctx, blockStart, blockEnd),
    });
  }

  // What is booked for the week after the one we just recapped.
  const nextWeek: NextWeekSlot[] = [];
  const upcoming = ctx.reservations
    .filter((r) => {
      const t = toMs(r.start);
      return (
        r.status === "approved" &&
        t >= windowEndMs &&
        t < windowEndMs + 7 * MS_PER_DAY
      );
    })
    .sort((a, b) => toMs(a.start) - toMs(b.start));

  for (const r of upcoming) {
    // A booking with nobody linked still belongs on the board — the purpose
    // line is the name, same fallback render-pullup.ts uses.
    if (r.artists.length === 0) {
      nextWeek.push({
        dayLabel: dayLabel(r.start),
        time: timeLabel(r.start),
        artistName: purposeName(r),
        beat: null,
      });
      continue;
    }
    for (const artist of r.artists) {
      const history = sessionsForArtist(ctx, artist.id);
      let beat: number | null = null;
      if (history.length > 0) {
        beat = analyse(ctx, history[history.length - 1], artist).audience.crowd;
      }
      nextWeek.push({
        dayLabel: dayLabel(r.start),
        time: timeLabel(r.start),
        artistName: artist.stageName,
        beat,
      });
    }
  }

  const windowEndIso = new Date(windowEndMs - 1).toISOString();
  const windowStartIso = new Date(windowStartMs).toISOString();

  return {
    weekLabel: weekLabel(new Date(windowEndMs - 1)),
    rangeLabel: rangeLabel(windowStartIso, windowEndIso),
    shows: inWindow.length,
    uniques: houseIds.size,
    pulled: housePulled(ctx, windowStartMs, windowEndMs),
    follows: houseFollows,
    rows: ranked.map(toBoardRow),
    houseSeries,
    nextWeek,
  };
}

// --- CLI ------------------------------------------------------------------

function flag(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1 || i + 1 >= process.argv.length) return null;
  return process.argv[i + 1];
}

function hasFlag(name: string): boolean {
  return process.argv.indexOf(`--${name}`) !== -1;
}

/** `--end 2026-09-03` means "through the end of Sep 3" in studio time. */
function endOfDayMs(day: string | null, nowMs: number): number {
  return studioEndOfDayMs(day || studioToday(nowMs));
}

function write(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  console.log(`\nWrote ${path}`);
}

/**
 * Belt and braces: nothing we emit may contain a Twitch login. URLs are
 * stripped first — profile images live on cdn.waterhousestudios.nl, which
 * would otherwise look like the house account's login.
 */
function assertNoLogins(json: string, ctx: Context): void {
  const logins = new Set<string>();
  for (const snap of ctx.snapshots) {
    for (const u of snap.usernames) logins.add(u.toLowerCase());
  }
  const haystack = json.toLowerCase().replace(/https?:\/\/[^"\s]+/g, "");
  for (const login of logins) {
    if (login.length >= 4 && haystack.indexOf(login) !== -1) {
      throw new Error(`Output leaks the Twitch login "${login}"`);
    }
  }
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "artist"
  );
}

/** The recap fixture follows whoever played most recently. */
function mostRecentArtist(scan: Scan): ArtistRef | null {
  for (let i = scan.sessions.length - 1; i >= 0; i--) {
    const artists = matchFor(scan, scan.sessions[i]).artists;
    if (artists.length > 0) return artists[0];
  }
  return null;
}

/** Earliest instant that lets every session in `sessions` be analysed fully. */
function requiredStartOver(sessions: StreamSession[]): number {
  let earliest = Number.POSITIVE_INFINITY;
  for (const s of sessions) {
    earliest = Math.min(earliest, requiredStartFor(toMs(s.start)));
  }
  return earliest;
}

/**
 * Earliest instant an artist recap has to be able to see.
 *
 * The recap analyses every session of the artist inside the window, not just
 * the `n` it shows, so widening the window can pull in an older session that
 * in turn needs more history. Iterate until that settles.
 */
function recapStartFor(scan: Scan, artist: ArtistRef, n: number): number {
  const all = sessionsForArtist(scan, artist.id);
  if (all.length === 0) {
    throw new Error(
      `No sessions matched "${artist.stageName}" in the last ${SCAN_DAYS} days.`,
    );
  }
  let start = requiredStartFor(toMs(all[Math.max(0, all.length - n)].start));
  for (;;) {
    const included = all.filter((s) => toMs(s.start) >= start);
    const next = requiredStartOver(included);
    if (next >= start) return start;
    start = next;
  }
}

/**
 * Earliest instant a weekly board has to be able to see. Besides the week
 * itself, the board analyses each artist's previous session (for
 * `deltaCrowd`) and the most recent session of everyone booked next week
 * (for `beat`) — both of which can be months old.
 */
function weeklyStartFor(
  scan: Scan,
  windowStartMs: number,
  windowEndMs: number,
): number {
  const analysed: StreamSession[] = [];
  const artistIds = new Set<string>();

  for (const s of scan.sessions) {
    const t = toMs(s.start);
    if (t < windowStartMs || t >= windowEndMs) continue;
    analysed.push(s);
    for (const a of matchFor(scan, s).artists) artistIds.add(a.id);
  }

  // Everyone booked in the week after the window, for the "beat" number.
  for (const r of scan.reservations) {
    const t = toMs(r.start);
    if (r.status !== "approved") continue;
    if (t < windowEndMs || t >= windowEndMs + 7 * MS_PER_DAY) continue;
    for (const a of r.artists) artistIds.add(a.id);
  }

  for (const artistId of artistIds) {
    const history = sessionsForArtist(scan, artistId);
    if (history.length > 0) analysed.push(history[history.length - 1]);
    let prior: StreamSession | null = null;
    for (const s of history) {
      if (toMs(s.start) < windowStartMs) prior = s;
    }
    if (prior) analysed.push(prior);
  }

  const seriesStart = windowEndMs - HOUSE_SERIES_WEEKS * 7 * MS_PER_DAY;
  return Math.min(
    requiredStartOver(analysed),
    // The house series only needs the 30-day "pulled" lookback per block.
    pulledWindowStart(seriesStart) - WINDOW_MARGIN_DAYS * MS_PER_DAY,
  );
}

async function main() {
  const mode = process.argv[2];
  const fixtures = hasFlag("fixtures");
  const nowMs = Date.now();
  const endMs = endOfDayMs(flag("end"), nowMs);
  const scanEndMs = Math.min(endMs, nowMs);

  const scan = await scanSessions(scanEndMs);

  // `--days` forces the window; otherwise it is derived from the sessions we
  // are about to analyse, so both lookbacks always have data behind them.
  const forcedDays = flag("days");
  const startFor = (derived: number) =>
    forcedDays ? scanEndMs - Number(forcedDays) * MS_PER_DAY : derived;

  if (fixtures) {
    const artist = mostRecentArtist(scan);
    if (!artist) throw new Error("No session in the window matched an artist.");

    const weekEnd = endMs;
    const ctx = await loadContext(
      scan,
      startFor(
        Math.min(
          recapStartFor(scan, artist, DEFAULT_RECAP_SESSIONS),
          weeklyStartFor(scan, weekEnd - 7 * MS_PER_DAY, weekEnd),
        ),
      ),
      scanEndMs,
    );

    console.log(`\nRecap fixture: ${artist.stageName}`);
    const recap = artistRecapPropsSchema.parse(
      await buildArtistRecap(ctx, artist, DEFAULT_RECAP_SESSIONS, nowMs),
    );
    assertNoLogins(JSON.stringify(recap, null, 2), ctx);
    write("src/audience/fixtures/recap.json", recap);

    console.log(
      `Weekly fixture: 7 days ending ${new Date(weekEnd - 1).toISOString()}`,
    );
    const weekly = houseWeeklyPropsSchema.parse(
      await buildHouseWeekly(ctx, weekEnd - 7 * MS_PER_DAY, weekEnd),
    );
    assertNoLogins(JSON.stringify(weekly, null, 2), ctx);
    write("src/audience/fixtures/weekly.json", weekly);
    return;
  }

  if (mode === "artist") {
    const name = process.argv[3];
    if (!name || name.indexOf("--") === 0) {
      throw new Error(`Usage: bun scripts/fetch-audience.ts artist "<name>"`);
    }
    const artist = findArtist(scan.reservations, name);
    if (!artist) throw new Error(`No artist matching "${name}".`);
    const n = Number(flag("n") || DEFAULT_RECAP_SESSIONS);
    const ctx = await loadContext(
      scan,
      startFor(recapStartFor(scan, artist, n)),
      scanEndMs,
    );

    const props = artistRecapPropsSchema.parse(
      await buildArtistRecap(ctx, artist, n, nowMs),
    );
    assertNoLogins(JSON.stringify(props, null, 2), ctx);
    for (const s of props.sessions) {
      console.log(
        `  ${s.dateLabel} ${s.slotLabel}: peak ${s.peak}, ${s.uniques} uniques, ` +
          `crowd ${s.crowd} (${s.pulled} pulled / ${s.returning} returning / ` +
          `${s.regulars} regular), hold ${s.holdRate}, ${s.follows} follows, ` +
          `chat ${s.chat ? `${s.chat.messages}/${s.chat.chatters}` : "n/a"}, ` +
          `${s.quadrant}`,
      );
    }
    write(flag("out") || `out/recap-${slugify(artist.stageName)}.json`, props);
    return;
  }

  if (mode === "week") {
    const windowStartMs = endMs - 7 * MS_PER_DAY;
    const ctx = await loadContext(
      scan,
      startFor(weeklyStartFor(scan, windowStartMs, endMs)),
      scanEndMs,
    );

    const props = houseWeeklyPropsSchema.parse(
      await buildHouseWeekly(ctx, windowStartMs, endMs),
    );
    assertNoLogins(JSON.stringify(props, null, 2), ctx);
    console.log(
      `  ${props.weekLabel} (${props.rangeLabel}): ${props.shows} shows, ` +
        `${props.uniques} uniques, ${props.pulled} pulled, ${props.follows} follows`,
    );
    for (const r of props.rows) {
      console.log(
        `  ${r.artistName}: crowd ${r.crowd} (${r.pulled}+${r.returning}), ` +
          `${r.uniques} uniques, peak ${r.peak}, hold ${r.holdRate}, ` +
          `${r.follows} follows` +
          (r.badges.length ? ` [${r.badges.join(", ")}]` : ""),
      );
    }
    write(
      flag("out") ||
        `out/weekly-${new Date(endMs - 1).toISOString().slice(0, 10)}.json`,
      props,
    );
    return;
  }

  console.error(
    [
      "Usage:",
      '  bun scripts/fetch-audience.ts artist "Tj Gee" --n 4 --out out/recap.json',
      "  bun scripts/fetch-audience.ts week --end 2026-09-03 --out out/weekly.json",
      "  bun scripts/fetch-audience.ts --fixtures",
    ].join("\n"),
  );
  process.exit(1);
}

main().catch((err) => {
  console.error("Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
