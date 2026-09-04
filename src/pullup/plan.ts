/**
 * Turning reservations into PullUp render jobs.
 *
 * One reservation used to mean one clip per linked artist, which gave a
 * shared booking two near-identical videos that each named half the bill and
 * never named the night. Shared bookings now collapse into a single clip led
 * by the event title; solo bookings are untouched.
 *
 * Everything here is pure so `bun test` can cover the naming and seeding
 * rules without touching the network or Chromium.
 */

export interface PullUpArtist {
  id: string;
  stage_name: string;
  bio: string | null;
  genre: string | null;
  profile_image_url: string | null;
}

export interface PullUpEvent {
  id: string;
  start_time: string;
  purpose: string | null;
  artists: PullUpArtist[];
}

// "Radio: Beatshopping" -> "Beatshopping". Shared with syntheticArtist(), so
// an event's title reads the same however it reaches the clip.
const PURPOSE_PREFIX = /^(Radio|Reserved|Private):\s*/i;

/** What eventTitle falls back to when the purpose says nothing. */
export const UNTITLED_EVENT = "Event";

export function eventTitle(purpose: string | null | undefined): string {
  return purpose?.replace(PURPOSE_PREFIX, "").trim() || UNTITLED_EVENT;
}

/** The bill as one line: `Elemzene × L4C4`. */
export function joinNames(names: string[]): string {
  return names.join(" \u00d7 ");
}

/**
 * The bill, shortened until it fits: every name, then the first few plus a
 * count, then just a count. `fits` is whatever the caller can measure - the
 * caption knows its own column width, this does not.
 */
export function billLine(
  names: string[],
  fits: (text: string) => boolean,
): string {
  if (names.length === 0) return "";
  const full = joinNames(names);
  if (fits(full)) return full;
  for (let keep = names.length - 1; keep >= 1; keep--) {
    const line = `${joinNames(names.slice(0, keep))} + ${names.length - keep} more`;
    if (fits(line)) return line;
  }
  return `${names.length} artists`;
}

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "artist"
  );
}

export function initials(name: string): string {
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

// --- Deterministic seeded RNG (mulberry32) ---
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pickDistinct<T>(
  pool: T[],
  count: number,
  rng: () => number,
): T[] {
  const remaining = pool.slice();
  const out: T[] = [];
  while (out.length < count && remaining.length > 0) {
    const i = Math.floor(rng() * remaining.length);
    out.push(remaining.splice(i, 1)[0]);
  }
  return out;
}

export function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// A reservation with no linked artists still gets a clip, using the purpose
// line as the name - same fallback WeeklyLineup uses.
export function syntheticArtist(event: PullUpEvent): PullUpArtist {
  return {
    id: `synthetic-${event.id}`,
    stage_name: eventTitle(event.purpose),
    bio: null,
    genre: null,
    profile_image_url: null,
  };
}

/**
 * One render. `solo` keeps the historic per-artist clip; `shared` is the new
 * one-clip-per-event form for a booking with two or more linked artists.
 */
export type PullUpJob =
  | { kind: "solo"; event: PullUpEvent; artist: PullUpArtist }
  | {
      kind: "shared";
      event: PullUpEvent;
      title: string;
      artists: PullUpArtist[];
    };

export function planJobs(events: PullUpEvent[]): PullUpJob[] {
  const jobs: PullUpJob[] = [];
  for (const event of events) {
    if (event.artists.length >= 2) {
      // A booking with no usable purpose has no night to lead with, and
      // "COME WATCH EVENT LIVE" helps nobody - name the artists instead.
      const title = eventTitle(event.purpose);
      jobs.push({
        kind: "shared",
        event,
        title:
          title === UNTITLED_EVENT
            ? joinNames(event.artists.map((a) => a.stage_name))
            : title,
        artists: event.artists,
      });
      continue;
    }
    const artists =
      event.artists.length > 0 ? event.artists : [syntheticArtist(event)];
    for (const artist of artists) {
      jobs.push({ kind: "solo", event, artist });
    }
  }
  return jobs;
}

/** The name the clip leads with: the artist, or the night they share. */
export function jobName(job: PullUpJob): string {
  return job.kind === "shared" ? job.title : job.artist.stage_name;
}

/** Filename stem, before the date: `beatshopping`, `l4c4`. */
export function jobSlug(job: PullUpJob): string {
  return slugify(jobName(job));
}

/**
 * Shared clips seed on the event alone rather than on any one artist, so the
 * seed does not depend on which name happens to sort first.
 *
 * What that fixes for a re-render: the accent colour, the audio variant, the
 * chat lines and which of the roster's photos get picked for a given roster.
 * What it does NOT fix: the room avatars are drawn from the roster minus the
 * bill, so changing the bill - or the roster growing - still shifts who
 * turns up in the circles.
 */
export function jobSeedSource(job: PullUpJob): string {
  return job.kind === "shared"
    ? job.event.id
    : `${job.event.id}:${job.artist.id}`;
}

export interface StemInput {
  /** jobSlug: the artist or the night. */
  slug: string;
  /** The event's date, `YYYY-MM-DD`. */
  day: string;
  /** The event's start time, `HHMM`, only used to break a tie. */
  time: string;
}

/**
 * Filename stems for a batch of jobs, one per input, guaranteed distinct.
 *
 * Two same-titled bookings on one day - "Radio: Open Decks" twice, an
 * afternoon and an evening set - would otherwise write the same file, and
 * Remotion overwrites without asking. The later one takes the start time,
 * and a third identical slot falls back to a counter.
 */
export function uniqueStems(inputs: StemInput[]): string[] {
  const seen = new Map<string, number>();
  for (const { slug, day } of inputs) {
    const base = `${slug}-${day}`;
    seen.set(base, (seen.get(base) ?? 0) + 1);
  }

  const used = new Set<string>();
  return inputs.map(({ slug, day, time }) => {
    const base = `${slug}-${day}`;
    let stem = (seen.get(base) ?? 0) > 1 ? `${base}-${time}` : base;
    let n = 2;
    while (used.has(stem)) {
      stem = `${base}-${time}-${n}`;
      n++;
    }
    used.add(stem);
    return stem;
  });
}

/** Roster ids already on screen, so the "room" never doubles them up. */
export function jobFeaturedIds(job: PullUpJob): string[] {
  return job.kind === "shared" ? job.artists.map((a) => a.id) : [job.artist.id];
}
