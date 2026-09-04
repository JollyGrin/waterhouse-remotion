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
 *   --days <count>    how far back to pull raw data (default 100, 200 for
 *                     --fixtures so recaps reach back a full set of shows)
 *   --out <path>      where to write; defaults to out/<something>.json
 *
 * Everything it reads is public; no token is needed.
 */

import { mkdirSync, writeFileSync } from "fs";
import { dirname } from "path";
import {
  analyseSession,
  assignBadges,
  buildExclusions,
  dateLabel,
  dayLabel,
  computeHoldRate,
  matchSessionToArtists,
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
  type BoardCandidate,
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
const DEFAULT_WINDOW_DAYS = 100;
// Fixtures reach further back so the recap fixture has a full set of shows.
const FIXTURE_WINDOW_DAYS = 200;
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

interface Context {
  sessions: StreamSession[];
  snapshots: ChatterSnapshot[];
  reservations: ReservationRef[];
  /** Session index (by start ISO) -> the artists it belongs to. */
  matches: Map<string, SessionMatch>;
  /** Oldest snapshot we hold; anything before this is a blind spot. */
  dataStartMs: number;
}

async function loadContext(endMs: number, days: number): Promise<Context> {
  const startIso = new Date(endMs - days * MS_PER_DAY).toISOString();
  const endIso = new Date(endMs).toISOString();

  console.log(`Window: ${startIso} -> ${endIso}`);
  const reservations = await fetchReservations();
  console.log(`  reservations: ${reservations.length}`);
  const sessions = await fetchSessions(startIso, endIso);
  console.log(`  sessions: ${sessions.length}`);
  const snapshots = await fetchSnapshots(startIso, endIso);

  const matches = new Map<string, SessionMatch>();
  for (const s of sessions) {
    matches.set(s.start, matchSessionToArtists(s, reservations));
  }

  return {
    sessions,
    snapshots,
    reservations,
    matches,
    dataStartMs: endMs - days * MS_PER_DAY,
  };
}

function matchFor(ctx: Context, session: StreamSession): SessionMatch {
  return (
    ctx.matches.get(session.start) || {
      artists: [],
      reservation: null,
      shared: false,
    }
  );
}

/** Sessions credited to one artist, oldest first. */
function sessionsForArtist(ctx: Context, artistId: string): StreamSession[] {
  return ctx.sessions.filter((s) => {
    for (const a of matchFor(ctx, s).artists) {
      if (a.id === artistId) return true;
    }
    return false;
  });
}

function sessionUserIds(ctx: Context, session: StreamSession): Set<string> {
  return userIdsInSessions(
    ctx.snapshots,
    [session],
    toMs(session.start),
    toMs(session.end) + 1,
  );
}

interface Analysed {
  session: StreamSession;
  audience: SessionAudience;
  entries: ReturnType<typeof analyseSession>["entries"];
}

/** Sessions we have already grumbled about, so the warning fires once. */
const warned = new Set<string>();

/**
 * Run one session through the metrics module, resolving both lookbacks:
 * everyone seen in the previous 30 days, and everyone in `previous`.
 */
function analyse(
  ctx: Context,
  session: StreamSession,
  artist: ArtistRef | null,
  previous: StreamSession | null,
): Analysed {
  const match = matchFor(ctx, session);
  const sStart = toMs(session.start);
  const lookbackStart = pulledWindowStart(sStart);
  if (lookbackStart < ctx.dataStartMs && !warned.has(session.start)) {
    warned.add(session.start);
    console.warn(
      `  ! ${session.start}: 30-day lookback reaches before the fetched window; "pulled" may be overstated (raise --days)`,
    );
  }

  const logins: Array<string | null> = artist
    ? [artist.twitchLogin]
    : match.artists.map((a) => a.twitchLogin);

  const result = analyseSession({
    session,
    snapshots: ctx.snapshots,
    exclusions: buildExclusions(logins),
    priorUserIds: userIdsInSessions(
      ctx.snapshots,
      ctx.sessions,
      lookbackStart,
      sStart,
    ),
    previousSessionUserIds: previous
      ? sessionUserIds(ctx, previous)
      : new Set<string>(),
    slotIso: match.reservation ? match.reservation.start : null,
    shared: match.shared,
  });

  return { session, audience: result.audience, entries: result.entries };
}

// --- artist recap ---------------------------------------------------------

function findArtist(ctx: Context, query: string): ArtistRef | null {
  const needle = query.trim().toLowerCase();
  let fuzzy: ArtistRef | null = null;
  for (const r of ctx.reservations) {
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

  const analysed: Analysed[] = [];
  for (let i = 0; i < all.length; i++) {
    analysed.push(analyse(ctx, all[i], artist, i > 0 ? all[i - 1] : null));
  }

  let bestUniques = 0;
  for (const a of analysed) {
    bestUniques = Math.max(bestUniques, a.audience.uniques);
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
      const history = sessionsForArtist(ctx, artist.id);
      const idx = history.findIndex((s) => s.start === session.start);
      const previous = idx > 0 ? history[idx - 1] : null;
      const a = analyse(ctx, session, artist, previous);
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
    let pulled = 0;
    let cameBack = 0;
    for (const kind of kinds.values()) {
      if (kind === "pulled") pulled++;
      else if (kind === "cameBack") cameBack++;
    }
    const uniques = kinds.size;

    // Delta against the artist's own last session before this window.
    const history = sessionsForArtist(ctx, bucket.artist.id);
    let prior: StreamSession | null = null;
    for (const s of history) {
      if (toMs(s.start) < windowStartMs) prior = s;
    }
    let deltaUniques: number | null = null;
    if (prior) {
      const priorIdx = history.findIndex((s) => s.start === prior!.start);
      const priorAnalysis = analyse(
        ctx,
        prior,
        bucket.artist,
        priorIdx > 0 ? history[priorIdx - 1] : null,
      );
      deltaUniques = uniques - priorAnalysis.audience.uniques;
    }

    candidates.push({
      artistId: bucket.artist.id,
      artistName: bucket.artist.stageName,
      artistImage: bucket.artist.image,
      pulled,
      uniques,
      holdRate: computeHoldRate(stayed.size, uniques),
      deltaUniques,
      shared: bucket.shared,
      badges: [],
      cameBack,
      firstSessionMs: toMs(ordered[0].session.start),
    });
  }

  assignBadges(candidates);
  const ranked = rankBoardRows(candidates);
  for (const row of ranked) {
    row.artistImage = await usableImage(row.artistImage);
  }

  // House totals.
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
        const last = history[history.length - 1];
        const lastIdx = history.length - 1;
        beat = analyse(
          ctx,
          last,
          artist,
          lastIdx > 0 ? history[lastIdx - 1] : null,
        ).audience.uniques;
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

async function main() {
  const mode = process.argv[2];
  const fixtures = hasFlag("fixtures");
  const days = Number(
    flag("days") || (fixtures ? FIXTURE_WINDOW_DAYS : DEFAULT_WINDOW_DAYS),
  );
  const nowMs = Date.now();
  const endMs = endOfDayMs(flag("end"), nowMs);
  const ctx = await loadContext(Math.min(endMs, nowMs), days);

  if (fixtures) {
    // Recap: whoever played most recently. Weekly: the last full 7 days.
    let artist: ArtistRef | null = null;
    for (let i = ctx.sessions.length - 1; i >= 0 && !artist; i--) {
      const artists = matchFor(ctx, ctx.sessions[i]).artists;
      if (artists.length > 0) artist = artists[0];
    }
    if (!artist) throw new Error("No session in the window matched an artist.");

    console.log(`\nRecap fixture: ${artist.stageName}`);
    const recap = artistRecapPropsSchema.parse(
      await buildArtistRecap(ctx, artist, DEFAULT_RECAP_SESSIONS, nowMs),
    );
    const recapJson = JSON.stringify(recap, null, 2);
    assertNoLogins(recapJson, ctx);
    write("src/audience/fixtures/recap.json", recap);

    const weekEnd = endMs;
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
    const artist = findArtist(ctx, name);
    if (!artist) throw new Error(`No artist matching "${name}".`);
    const n = Number(flag("n") || DEFAULT_RECAP_SESSIONS);
    const props = artistRecapPropsSchema.parse(
      await buildArtistRecap(ctx, artist, n, nowMs),
    );
    const json = JSON.stringify(props, null, 2);
    assertNoLogins(json, ctx);
    for (const s of props.sessions) {
      console.log(
        `  ${s.dateLabel} ${s.slotLabel}: peak ${s.peak}, ${s.uniques} uniques ` +
          `(${s.pulled} pulled / ${s.cameBack} back / ${s.regulars} regular), ` +
          `hold ${s.holdRate}, ${s.quadrant}`,
      );
    }
    write(flag("out") || `out/recap-${slugify(artist.stageName)}.json`, props);
    return;
  }

  if (mode === "week") {
    const props = houseWeeklyPropsSchema.parse(
      await buildHouseWeekly(ctx, endMs - 7 * MS_PER_DAY, endMs),
    );
    assertNoLogins(JSON.stringify(props, null, 2), ctx);
    console.log(
      `  ${props.weekLabel} (${props.rangeLabel}): ${props.shows} shows, ` +
        `${props.uniques} uniques, ${props.pulled} pulled`,
    );
    for (const r of props.rows) {
      console.log(
        `  ${r.artistName}: ${r.pulled} pulled, ${r.uniques} uniques, hold ${r.holdRate}` +
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
