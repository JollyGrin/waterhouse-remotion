/**
 * Audience metrics for the "Who Showed Up" recaps.
 *
 * Every number the compositions draw is defined here, once. The fetch script
 * (`scripts/fetch-audience.ts`) supplies raw rows from the event logger and
 * the Waterhouse reservations API; this module turns them into the props
 * described by `src/audience/schema.ts`. Compositions never recompute.
 *
 * The vocabulary, in one place:
 *
 * - **Session -> artist**: a stream belongs to every artist on an *approved*
 *   reservation that covers at least 20% of the session's duration (the same
 *   rule the portal uses). A multi-artist reservation credits each artist in
 *   full and the session is marked `shared`.
 * - **Exclusions**: the house account, the artist's own Twitch login when we
 *   know it, and a bot list. Applied before anything is counted.
 * - **Presence**: per user id, `arrived` is the first snapshot and `left` the
 *   last; runs separated by less than 2 minutes merge into one visit;
 *   `watchMin` is the summed length of those visits.
 * - **Pulled**: no snapshot in *any* session during the 30 days before this
 *   session started.
 * - **Came back**: present in this artist's previous session, and not pulled.
 * - **Regular**: everyone else.
 * - **Stayed**: `watchMin >= max(30, half the session)`. **Bounced**:
 *   `watchMin < 10`. **holdRate**: stayed / uniques, 0 when there are none.
 * - **Quadrant**: `pulled >= 2` is "many", `holdRate >= 0.5` is "held".
 */

import type {
  Badge,
  BoardRow,
  Quadrant,
  SessionAudience,
  Viewer,
} from "./schema";

// --- Tunables -------------------------------------------------------------

/** Runs of snapshots separated by less than this merge into one visit. */
export const VISIT_GAP_MIN = 2;

/** Window used to decide whether a viewer is new to the channel. */
export const PULLED_LOOKBACK_DAYS = 30;

/** Share of a session a reservation must cover to own it. */
export const SESSION_OVERLAP_RATIO = 0.2;

/** Under this many watched minutes a viewer bounced. */
export const BOUNCE_MAX_MIN = 10;

/** Floor for the "stayed" threshold, in minutes. */
export const STAY_FLOOR_MIN = 30;

/** Fraction of the session a viewer must watch to have stayed. */
export const STAY_RATIO = 0.5;

/** `pulled >= this` counts as "many" for the quadrant. */
export const QUADRANT_PULLED_MIN = 2;

/** `holdRate >= this` counts as "held" for the quadrant. */
export const QUADRANT_HOLD_MIN = 0.5;

/** Badges that reward a rate need at least this many uniques behind them. */
export const BADGE_MIN_UNIQUES = 3;

/** The studio's own Twitch account — always in the room, never an audience. */
export const HOUSE_ACCOUNT = "waterhousestudios";

/** Chat bots that show up in the chatter list. */
export const DEFAULT_BOTS = [
  "nightbot",
  "streamelements",
  "streamlabs",
  "moobot",
];

/** Everything is labelled in the studio's wall-clock time. */
export const STUDIO_TZ = "Europe/Amsterdam";

const MS_PER_MIN = 60 * 1000;
const MS_PER_DAY = 24 * 60 * MS_PER_MIN;

// --- Raw input rows -------------------------------------------------------

/** One 30-second chatter poll from the event logger. */
export interface ChatterSnapshot {
  timestamp: string;
  userIds: string[];
  usernames: string[];
}

/** One stream, as summarised by the event logger. */
export interface StreamSession {
  start: string;
  end: string;
  durationMin: number;
  peakViewers: number;
  uniqueViewers: number;
}

/** An artist as the reservations API describes them. */
export interface ArtistRef {
  id: string;
  stageName: string;
  image: string | null;
  /** Their own Twitch login, when the roster records one. */
  twitchLogin: string | null;
}

/** An approved (or otherwise) booking of the studio. */
export interface ReservationRef {
  id: string;
  start: string;
  end: string;
  status: string;
  /** The booking's title, e.g. "Radio: Sudden Rave". */
  purpose: string | null;
  artists: ArtistRef[];
}

// --- Small helpers --------------------------------------------------------

export function toMs(iso: string): number {
  return new Date(iso).getTime();
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Two characters standing in for a Twitch login. Splits on separators first,
 * so `l4c4_music` reads as "LM" rather than "L4". Never returns the login.
 */
export function initialsFromLogin(login: string): string {
  const parts = login
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .split(/\s+/);
  const words: string[] = [];
  for (const p of parts) {
    if (p.length > 0) words.push(p);
  }
  if (words.length === 0) return "??";
  const raw =
    words.length > 1 ? words[0][0] + words[1][0] : `${words[0]}?`.slice(0, 2);
  return raw.toUpperCase();
}

/** Lower-cased set of logins that never count as audience. */
export function buildExclusions(
  artistLogins: Array<string | null>,
  bots: string[] = DEFAULT_BOTS,
): Set<string> {
  const out = new Set<string>();
  out.add(HOUSE_ACCOUNT);
  for (const b of bots) out.add(b.toLowerCase());
  for (const a of artistLogins) {
    if (a) out.add(a.toLowerCase());
  }
  return out;
}

// --- Session <-> reservation join ----------------------------------------

/** Minutes shared by two intervals, zero when they miss each other. */
export function overlapMinutes(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): number {
  const start = Math.max(aStart, bStart);
  const end = Math.min(aEnd, bEnd);
  return end <= start ? 0 : (end - start) / MS_PER_MIN;
}

export interface SessionMatch {
  artists: ArtistRef[];
  /** The reservation that best covers the session, if any. */
  reservation: ReservationRef | null;
  shared: boolean;
}

/**
 * Which artists a session belongs to: everyone on an approved reservation
 * overlapping at least `SESSION_OVERLAP_RATIO` of the session.
 */
export function matchSessionToArtists(
  session: StreamSession,
  reservations: ReservationRef[],
): SessionMatch {
  const sStart = toMs(session.start);
  const sEnd = toMs(session.end);
  const span = Math.max(sEnd - sStart, 1) / MS_PER_MIN;

  const artists: ArtistRef[] = [];
  const seen = new Set<string>();
  let best: ReservationRef | null = null;
  let bestOverlap = 0;

  for (const r of reservations) {
    if (r.status !== "approved") continue;
    const ov = overlapMinutes(sStart, sEnd, toMs(r.start), toMs(r.end));
    if (ov / span < SESSION_OVERLAP_RATIO) continue;
    if (ov > bestOverlap) {
      bestOverlap = ov;
      best = r;
    }
    for (const a of r.artists) {
      if (seen.has(a.id)) continue;
      seen.add(a.id);
      artists.push(a);
    }
  }

  return { artists, reservation: best, shared: artists.length > 1 };
}

// --- Presence -------------------------------------------------------------

export interface Visit {
  startMs: number;
  endMs: number;
}

/**
 * Collapse snapshot timestamps into visits, merging any gap shorter than
 * `gapMin`. Input need not be sorted.
 */
export function mergeVisits(
  timestampsMs: number[],
  gapMin: number = VISIT_GAP_MIN,
): Visit[] {
  if (timestampsMs.length === 0) return [];
  const sorted = timestampsMs.slice().sort((a, b) => a - b);
  const gapMs = gapMin * MS_PER_MIN;
  const visits: Visit[] = [{ startMs: sorted[0], endMs: sorted[0] }];
  for (let i = 1; i < sorted.length; i++) {
    const last = visits[visits.length - 1];
    if (sorted[i] - last.endMs < gapMs) {
      last.endMs = sorted[i];
    } else {
      visits.push({ startMs: sorted[i], endMs: sorted[i] });
    }
  }
  return visits;
}

export interface Presence {
  userId: string;
  login: string;
  arrivedMs: number;
  leftMs: number;
  /** Summed visit length. A viewer seen in a single snapshot watched 0. */
  watchMin: number;
}

/**
 * Per-viewer presence inside one session. Snapshots outside the session are
 * ignored; excluded logins are dropped before anything is counted.
 */
export function buildPresence(
  snapshots: ChatterSnapshot[],
  session: StreamSession,
  exclusions: Set<string>,
): Presence[] {
  const sStart = toMs(session.start);
  const sEnd = toMs(session.end);
  const seen = new Map<string, { login: string; times: number[] }>();

  for (const snap of snapshots) {
    const t = toMs(snap.timestamp);
    if (t < sStart || t > sEnd) continue;
    for (let i = 0; i < snap.userIds.length; i++) {
      const login = (snap.usernames[i] || "").toLowerCase();
      if (exclusions.has(login)) continue;
      const id = snap.userIds[i];
      const entry = seen.get(id);
      if (entry) {
        entry.times.push(t);
      } else {
        seen.set(id, { login, times: [t] });
      }
    }
  }

  const out: Presence[] = [];
  for (const [userId, entry] of seen) {
    const visits = mergeVisits(entry.times);
    let watchMs = 0;
    for (const v of visits) watchMs += v.endMs - v.startMs;
    out.push({
      userId,
      login: entry.login,
      arrivedMs: visits[0].startMs,
      leftMs: visits[visits.length - 1].endMs,
      watchMin: round1(watchMs / MS_PER_MIN),
    });
  }
  return out;
}

/** Distinct user ids seen inside any of `sessions` within [from, to). */
export function userIdsInSessions(
  snapshots: ChatterSnapshot[],
  sessions: StreamSession[],
  fromMs: number,
  toMsExclusive: number,
): Set<string> {
  const windows = sessions
    .map((s) => ({ start: toMs(s.start), end: toMs(s.end) }))
    .filter((w) => w.end >= fromMs && w.start < toMsExclusive);

  const out = new Set<string>();
  for (const snap of snapshots) {
    const t = toMs(snap.timestamp);
    if (t < fromMs || t >= toMsExclusive) continue;
    let inside = false;
    for (const w of windows) {
      if (t >= w.start && t <= w.end) {
        inside = true;
        break;
      }
    }
    if (!inside) continue;
    for (const id of snap.userIds) out.add(id);
  }
  return out;
}

/** Start of the pulled-lookback window for a session. */
export function pulledWindowStart(sessionStartMs: number): number {
  return sessionStartMs - PULLED_LOOKBACK_DAYS * MS_PER_DAY;
}

// --- Classification -------------------------------------------------------

export type ViewerKind = Viewer["kind"];

/**
 * `priorUserIds` are everyone seen in any session in the 30 days before this
 * one; `previousSessionUserIds` are everyone in this artist's last session.
 */
export function classifyViewer(
  userId: string,
  priorUserIds: Set<string>,
  previousSessionUserIds: Set<string>,
): ViewerKind {
  if (!priorUserIds.has(userId)) return "pulled";
  if (previousSessionUserIds.has(userId)) return "cameBack";
  return "regular";
}

export function stayThresholdMin(durationMin: number): number {
  return Math.max(STAY_FLOOR_MIN, STAY_RATIO * durationMin);
}

export function isStayed(watchMin: number, durationMin: number): boolean {
  return watchMin >= stayThresholdMin(durationMin);
}

export function isBounced(watchMin: number): boolean {
  return watchMin < BOUNCE_MAX_MIN;
}

export function computeHoldRate(stayed: number, uniques: number): number {
  return uniques === 0 ? 0 : round2(stayed / uniques);
}

export function quadrantFor(pulled: number, holdRate: number): Quadrant {
  const many = pulled >= QUADRANT_PULLED_MIN;
  const held = holdRate >= QUADRANT_HOLD_MIN;
  if (many && held) return "packed-held";
  if (many) return "hype-cliff";
  if (held) return "small-loyal";
  return "quiet";
}

// --- Labels ---------------------------------------------------------------

function tzPart(iso: string, options: Intl.DateTimeFormatOptions): string {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: STUDIO_TZ,
    ...options,
  });
}

/** "Wed" */
export function dayLabel(iso: string): string {
  return tzPart(iso, { weekday: "short" });
}

/** "Sep 3" */
export function dateLabel(iso: string): string {
  return tzPart(iso, { month: "short", day: "numeric" });
}

/** "7pm" / "7:30pm" */
export function timeLabel(iso: string): string {
  const raw = tzPart(iso, { hour: "numeric", minute: "2-digit", hour12: true });
  return raw.replace(":00", "").replace(/\s+/g, "").toLowerCase();
}

/** "Wed 7pm" */
export function slotLabel(iso: string): string {
  return `${dayLabel(iso)} ${timeLabel(iso)}`;
}

/** ISO week number and the year it belongs to. */
export function isoWeek(date: Date): { year: number; week: number } {
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  // Thursday of the current week decides the year.
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(
    ((d.getTime() - yearStart.getTime()) / MS_PER_DAY + 1) / 7,
  );
  return { year: d.getUTCFullYear(), week };
}

/** "Week 36" */
export function weekLabel(date: Date): string {
  return `Week ${isoWeek(date).week}`;
}

/** "W36" */
export function shortWeekLabel(date: Date): string {
  return `W${isoWeek(date).week}`;
}

/**
 * Offset between studio wall-clock time and UTC at a given instant, in ms.
 * Uses the locale round-trip because `Intl.formatToParts` is outside the
 * `lib` this project compiles against.
 */
function studioOffsetMs(instantMs: number): number {
  const d = new Date(instantMs);
  const utc = new Date(
    d.toLocaleString("en-US", { timeZone: "UTC" }),
  ).getTime();
  const local = new Date(
    d.toLocaleString("en-US", { timeZone: STUDIO_TZ }),
  ).getTime();
  return local - utc;
}

/** Today's date in studio time, as YYYY-MM-DD. */
export function studioToday(nowMs: number = Date.now()): string {
  return new Date(nowMs).toLocaleDateString("en-CA", { timeZone: STUDIO_TZ });
}

/**
 * The instant a YYYY-MM-DD studio day ends — i.e. midnight at the start of
 * the next day, in Amsterdam. Windows are cut here so that "7 days ending
 * Sep 3" labels as Aug 28 - Sep 3 rather than sliding an hour into Sep 4.
 */
export function studioEndOfDayMs(day: string): number {
  const midnightUtc = Date.parse(`${day}T00:00:00Z`);
  if (Number.isNaN(midnightUtc)) {
    throw new Error(`Expected a YYYY-MM-DD date, got "${day}"`);
  }
  const naive = midnightUtc + MS_PER_DAY;
  // Amsterdam never changes offset at midnight, so one correction suffices.
  return naive - studioOffsetMs(naive);
}

/** "Aug 28 - Sep 3" */
export function rangeLabel(startIso: string, endIso: string): string {
  return `${dateLabel(startIso)} - ${dateLabel(endIso)}`;
}

// --- Building one session's audience -------------------------------------

export interface SessionAudienceInput {
  session: StreamSession;
  /** Snapshots covering at least the session; extras are ignored. */
  snapshots: ChatterSnapshot[];
  exclusions: Set<string>;
  /** Everyone seen in any session in the 30 days before this one. */
  priorUserIds: Set<string>;
  /** Everyone in this artist's previous session. */
  previousSessionUserIds: Set<string>;
  /** Reservation start to label the slot with; falls back to session start. */
  slotIso?: string | null;
  shared: boolean;
}

/** One viewer's outcome in one session, with the id the props must not carry. */
export interface SessionEntry {
  userId: string;
  kind: ViewerKind;
  stayed: boolean;
  watchMin: number;
}

export interface SessionAnalysis {
  audience: SessionAudience;
  /** Same people as `audience.viewers`, keyed by id for cross-session maths. */
  entries: SessionEntry[];
}

/**
 * The whole per-session pipeline: presence -> classification -> counts.
 * Returns the drawable props plus the id-carrying detail the weekly board
 * needs to aggregate an artist's sessions without double-counting anyone.
 */
export function analyseSession(input: SessionAudienceInput): SessionAnalysis {
  const { session, exclusions, priorUserIds, previousSessionUserIds } = input;
  const sStart = toMs(session.start);
  const presence = buildPresence(input.snapshots, session, exclusions);

  let pulled = 0;
  let cameBack = 0;
  let regulars = 0;
  let stayedCount = 0;

  const viewers: Viewer[] = [];
  const entries: SessionEntry[] = [];

  for (const p of presence) {
    const kind = classifyViewer(p.userId, priorUserIds, previousSessionUserIds);
    if (kind === "pulled") pulled++;
    else if (kind === "cameBack") cameBack++;
    else regulars++;

    const stayed = isStayed(p.watchMin, session.durationMin);
    if (stayed) stayedCount++;

    viewers.push({
      initials: initialsFromLogin(p.login),
      kind,
      arrivedMin: round1((p.arrivedMs - sStart) / MS_PER_MIN),
      leftMin: round1((p.leftMs - sStart) / MS_PER_MIN),
      watchMin: p.watchMin,
      stayed,
    });
    entries.push({
      userId: p.userId,
      kind,
      stayed,
      watchMin: p.watchMin,
    });
  }

  viewers.sort((a, b) => a.arrivedMin - b.arrivedMin);

  const uniques = presence.length;
  const holdRate = computeHoldRate(stayedCount, uniques);

  const audience: SessionAudience = {
    start: session.start,
    end: session.end,
    durationMin: session.durationMin,
    slotLabel: slotLabel(input.slotIso || session.start),
    dateLabel: dateLabel(session.start),
    peak: session.peakViewers,
    uniques,
    pulled,
    cameBack,
    regulars,
    holdRate,
    quadrant: quadrantFor(pulled, holdRate),
    shared: input.shared,
    viewers,
  };

  return { audience, entries };
}

export function buildSessionAudience(
  input: SessionAudienceInput,
): SessionAudience {
  return analyseSession(input).audience;
}

// --- Weekly board ---------------------------------------------------------

/** A board row plus the bits only badge assignment needs. */
export interface BoardCandidate extends BoardRow {
  artistId: string;
  cameBack: number;
  /** Start of this artist's earliest session in the window; breaks ties. */
  firstSessionMs: number;
}

/**
 * The artist's best single moment across a set of sessions. Peaks are
 * concurrent-viewer highs, so they max rather than sum: two 6-peak shows in
 * one week is a 6, not a 12. Zero for an empty list.
 */
export function peakAcross(sessions: SessionAudience[]): number {
  let peak = 0;
  for (const s of sessions) peak = Math.max(peak, s.peak);
  return peak;
}

/** pulled desc, then holdRate desc, then uniques desc. */
export function rankBoardRows<T extends BoardRow>(rows: T[]): T[] {
  return rows.slice().sort((a, b) => {
    if (b.pulled !== a.pulled) return b.pulled - a.pulled;
    if (b.holdRate !== a.holdRate) return b.holdRate - a.holdRate;
    return b.uniques - a.uniques;
  });
}

function pickBest(
  rows: BoardCandidate[],
  score: (r: BoardCandidate) => number | null,
): BoardCandidate | null {
  let best: BoardCandidate | null = null;
  let bestScore = 0;
  for (const r of rows) {
    const s = score(r);
    if (s === null) continue;
    if (
      best === null ||
      s > bestScore ||
      (s === bestScore && r.firstSessionMs < best.firstSessionMs)
    ) {
      best = r;
      bestScore = s;
    }
  }
  return best;
}

/**
 * Hands out the four weekly badges. Each goes to at most one artist; ties are
 * broken by the earliest session. An artist may hold several.
 *
 * Mutates and returns `rows` (their `badges` arrays).
 */
export function assignBadges(rows: BoardCandidate[]): BoardCandidate[] {
  for (const r of rows) r.badges = [];

  const give = (row: BoardCandidate | null, badge: Badge) => {
    if (row) row.badges.push(badge);
  };

  give(
    pickBest(rows, (r) => r.pulled),
    "most-pulled",
  );
  give(
    pickBest(rows, (r) => (r.uniques >= BADGE_MIN_UNIQUES ? r.holdRate : null)),
    "held-the-room",
  );
  give(
    pickBest(rows, (r) =>
      r.deltaUniques !== null && r.deltaUniques > 0 ? r.deltaUniques : null,
    ),
    "best-comeback",
  );
  give(
    pickBest(rows, (r) =>
      r.uniques >= BADGE_MIN_UNIQUES ? r.cameBack / r.uniques : null,
    ),
    "stickiest",
  );

  return rows;
}

/** Drops the fields the composition does not need. */
export function toBoardRow(c: BoardCandidate): BoardRow {
  return {
    artistName: c.artistName,
    artistImage: c.artistImage,
    pulled: c.pulled,
    uniques: c.uniques,
    peak: c.peak,
    holdRate: c.holdRate,
    deltaUniques: c.deltaUniques,
    shared: c.shared,
    badges: c.badges,
  };
}
