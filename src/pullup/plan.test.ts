import { describe, expect, it } from "bun:test";
import {
  eventTitle,
  hashSeed,
  initials,
  jobFeaturedIds,
  jobName,
  jobSeedSource,
  jobSlug,
  planJobs,
  slugify,
  syntheticArtist,
  type PullUpArtist,
  type PullUpEvent,
} from "./plan";

const artist = (id: string, stage_name: string): PullUpArtist => ({
  id,
  stage_name,
  bio: null,
  genre: null,
  profile_image_url: null,
});

const event = (
  id: string,
  purpose: string | null,
  artists: PullUpArtist[],
): PullUpEvent => ({
  id,
  start_time: "2026-09-11T17:00:00.000Z",
  purpose,
  artists,
});

// The real shared booking this behaviour was written for.
const l4c4 = artist("019ad5fc-fe6c", "L4C4");
const elemzene = artist("019ad5fc-c445", "Elemzene");
const beatshopping = event(
  "164d6564-4c9f-45a9-8767-eadb2d94a2a5",
  "Radio: Beatshopping",
  [elemzene, l4c4],
);

describe("eventTitle", () => {
  it("strips the calendar prefixes", () => {
    expect(eventTitle("Radio: Beatshopping")).toBe("Beatshopping");
    expect(eventTitle("Reserved: Studio A")).toBe("Studio A");
    expect(eventTitle("private: Birthday")).toBe("Birthday");
  });

  it("leaves an unprefixed purpose alone", () => {
    expect(eventTitle("Beatshopping")).toBe("Beatshopping");
  });

  it("falls back when there is no purpose", () => {
    expect(eventTitle(null)).toBe("Event");
    expect(eventTitle("   ")).toBe("Event");
  });
});

describe("slugify / initials", () => {
  it("slugs a title into a filename stem", () => {
    expect(slugify("Beatshopping")).toBe("beatshopping");
    expect(slugify("L4C4")).toBe("l4c4");
    expect(slugify("Sudden Rave!")).toBe("sudden-rave");
  });

  it("ignores punctuation in initials", () => {
    expect(initials("(N)ARZ")).toBe("NA");
    expect(initials("The Silintist")).toBe("TS");
    expect(initials("!!!")).toBe("??");
  });
});

describe("planJobs", () => {
  it("collapses a shared booking into one clip", () => {
    const jobs = planJobs([beatshopping]);
    expect(jobs).toHaveLength(1);
    const [job] = jobs;
    expect(job.kind).toBe("shared");
    expect(jobName(job)).toBe("Beatshopping");
    expect(jobSlug(job)).toBe("beatshopping");
    if (job.kind !== "shared") throw new Error("expected a shared job");
    expect(job.artists.map((a) => a.stage_name)).toEqual(["Elemzene", "L4C4"]);
  });

  it("keeps one clip per artist for solo bookings", () => {
    const jobs = planJobs([
      event("e1", "Radio: Denzo", [artist("a1", "Denzo")]),
    ]);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].kind).toBe("solo");
    expect(jobSlug(jobs[0])).toBe("denzo");
  });

  it("still renders a reservation with no linked artists", () => {
    const jobs = planJobs([event("e2", "Reserved: Open Decks", [])]);
    expect(jobs).toHaveLength(1);
    expect(jobName(jobs[0])).toBe("Open Decks");
    expect(jobSlug(jobs[0])).toBe("open-decks");
  });

  it("handles a mixed batch", () => {
    const jobs = planJobs([
      beatshopping,
      event("e1", "Radio: Denzo", [artist("a1", "Denzo")]),
    ]);
    expect(jobs.map((j) => j.kind)).toEqual(["shared", "solo"]);
  });
});

describe("seeding", () => {
  it("seeds a shared clip on the event alone, so re-renders are stable", () => {
    const [job] = planJobs([beatshopping]);
    expect(jobSeedSource(job)).toBe(beatshopping.id);

    // Reordering the bill must not reshuffle a clip already sent out.
    const [reordered] = planJobs([
      { ...beatshopping, artists: [l4c4, elemzene] },
    ]);
    expect(hashSeed(jobSeedSource(reordered))).toBe(
      hashSeed(jobSeedSource(job)),
    );
  });

  it("keeps the per-artist seed for solo clips", () => {
    const solo = event("e1", "Radio: Denzo", [artist("a1", "Denzo")]);
    const [job] = planJobs([solo]);
    expect(jobSeedSource(job)).toBe("e1:a1");
  });
});

describe("jobFeaturedIds", () => {
  it("excludes everybody on the bill from the room", () => {
    const [job] = planJobs([beatshopping]);
    expect(jobFeaturedIds(job).sort()).toEqual([elemzene.id, l4c4.id].sort());
  });

  it("excludes the one artist for a solo clip", () => {
    const [job] = planJobs([event("e1", null, [artist("a1", "Denzo")])]);
    expect(jobFeaturedIds(job)).toEqual(["a1"]);
  });
});

describe("syntheticArtist", () => {
  it("names itself after the event", () => {
    const a = syntheticArtist(event("e3", "Radio: Sudden Rave", []));
    expect(a.stage_name).toBe("Sudden Rave");
    expect(a.id).toBe("synthetic-e3");
    expect(a.profile_image_url).toBeNull();
  });
});
