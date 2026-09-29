/**
 * Turning the portal calendar into a WaterhouseSession render.
 *
 * Tuesday night is "Waterhouse Sessions": Denzo hosts, usually interviews
 * the guest for ~20 minutes, then the guest plays a set. One clip per
 * session, forwarded by the guest the same way a PullUp is.
 *
 * Everything here is pure so `bun test` can cover the matching and copy
 * rules without touching the network or Chromium. The generic helpers
 * (initials, slugify, the seeded rng) are PullUp's, imported rather than
 * copied - they are not PullUp behaviour, just arithmetic.
 */

import { slugify } from "../pullup/plan";

export interface SessionArtist {
  id: string;
  stage_name: string;
  profile_image_url: string | null;
}

export interface SessionReservation {
  id: string;
  start_time: string;
  status: string;
  purpose: string | null;
  artists: SessionArtist[];
}

/** Hosts every Waterhouse Session. Looked up on the portal by stage name. */
export const HOST_NAME = "Denzo";

/** Default interview length, in minutes. */
export const DEFAULT_INTERVIEW_MINUTES = 20;

// "Radio: Waterhouse Sessions". Not "Sunday Sessions", which is a different
// (mostly cancelled) night that Denzo also appears on.
const SESSION_PURPOSE = /waterhouse\s+sessions?/i;

export function isSessionBooking(r: SessionReservation): boolean {
  return r.status === "approved" && SESSION_PURPOSE.test(r.purpose ?? "");
}

/**
 * The approved Waterhouse Sessions booking on `day` (`YYYY-MM-DD`), or null.
 * `dayOf` turns a start_time into the local calendar day - the caller owns
 * the timezone, same as render-pullup.ts.
 */
export function findSessionSlot<R extends SessionReservation>(
  reservations: R[],
  day: string,
  dayOf: (iso: string) => string,
): R | null {
  const hits = reservations
    .filter((r) => isSessionBooking(r) && dayOf(r.start_time) === day)
    .sort(
      (a, b) =>
        new Date(a.start_time).getTime() - new Date(b.start_time).getTime(),
    );
  return hits[0] ?? null;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

export type ArtistMatch<A> =
  | { kind: "found"; artist: A }
  | { kind: "none" }
  | { kind: "ambiguous"; candidates: A[] };

/**
 * Finds an artist by what someone typed on the command line. An exact stage
 * name wins; otherwise the query must be the leading word(s) of exactly one
 * stage name, so `--guest "Duncen"` finds "Duncen Haakmat". Earlier lists
 * take priority: pass the session's own artists before the whole roster, so
 * the person actually booked wins over a namesake.
 */
export function matchArtist<A extends { id: string; stage_name: string }>(
  query: string,
  ...pools: A[][]
): ArtistMatch<A> {
  const q = norm(query);
  if (!q) return { kind: "none" };
  for (const pool of pools) {
    const exact = pool.filter((a) => norm(a.stage_name) === q);
    if (exact.length > 0) return { kind: "found", artist: exact[0] };

    const prefix = uniqueById(
      pool.filter((a) => {
        const name = norm(a.stage_name);
        return name.indexOf(`${q} `) === 0;
      }),
    );
    if (prefix.length === 1) return { kind: "found", artist: prefix[0] };
    if (prefix.length > 1) return { kind: "ambiguous", candidates: prefix };
  }
  return { kind: "none" };
}

function uniqueById<A extends { id: string }>(list: A[]): A[] {
  const seen = new Set<string>();
  return list.filter((a) => (seen.has(a.id) ? false : (seen.add(a.id), true)));
}

// No padStart under this tsconfig's lib.
const pad2 = (n: number) => (n < 10 ? `0${n}` : `${n}`);

/** `"19:00"` plus 20 minutes is `"19:20"`, wrapping past midnight. */
export function addMinutes(hhmm: string, minutes: number): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return hhmm;
  const total =
    (((Number(m[1]) * 60 + Number(m[2]) + Math.round(minutes)) % 1440) + 1440) %
    1440;
  return `${pad2(Math.floor(total / 60))}:${pad2(total % 60)}`;
}

export interface RunningOrderInput {
  hostName: string;
  eventTime: string;
  interview: boolean;
  interviewMinutes: number;
}

/**
 * The running-order line under the stream window, upper-cased by the
 * composition:
 *
 *   interview: "19:00 Interview with Denzo, then live set 19:20"
 *   plain:     "19:00 Live set, hosted by Denzo"
 */
export function runningOrder({
  hostName,
  eventTime,
  interview,
  interviewMinutes,
}: RunningOrderInput): string {
  if (!interview) return `${eventTime} Live set, hosted by ${hostName}`;
  return `${eventTime} Interview with ${hostName}, then live set ${addMinutes(eventTime, interviewMinutes)}`;
}

/** `Session-duncen-2026-09-29` - named after the guest as typed. */
export function sessionStem(guest: string, day: string): string {
  return `Session-${slugify(guest)}-${day}`;
}
