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

export function eventTitle(purpose: string | null | undefined): string {
  return purpose?.replace(PURPOSE_PREFIX, "").trim() || "Event";
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
      jobs.push({
        kind: "shared",
        event,
        title: eventTitle(event.purpose),
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
 * Shared clips seed on the event alone, so adding or reordering the bill
 * later does not reshuffle a clip that has already been sent out.
 */
export function jobSeedSource(job: PullUpJob): string {
  return job.kind === "shared"
    ? job.event.id
    : `${job.event.id}:${job.artist.id}`;
}

/** Roster ids already on screen, so the "room" never doubles them up. */
export function jobFeaturedIds(job: PullUpJob): string[] {
  return job.kind === "shared" ? job.artists.map((a) => a.id) : [job.artist.id];
}
