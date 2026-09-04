import { describe, expect, test } from "bun:test";
import {
  analyseSession,
  assignBadges,
  buildExclusions,
  buildPresence,
  classifyViewer,
  computeHoldRate,
  initialsFromLogin,
  isBounced,
  isStayed,
  matchSessionToArtists,
  mergeVisits,
  peakAcross,
  quadrantFor,
  rankBoardRows,
  stayThresholdMin,
  type ArtistRef,
  type BoardCandidate,
  type ChatterSnapshot,
  type ReservationRef,
  type StreamSession,
} from "./metrics";

const MIN = 60 * 1000;
const BASE = Date.parse("2026-09-03T17:00:00Z");

const at = (min: number) => BASE + min * MIN;
const iso = (min: number) => new Date(at(min)).toISOString();

function session(durationMin: number): StreamSession {
  return {
    start: iso(0),
    end: iso(durationMin),
    durationMin,
    peakViewers: 9,
    uniqueViewers: 10,
  };
}

// --- gap merging ----------------------------------------------------------

describe("mergeVisits", () => {
  test("merges runs separated by less than 2 minutes", () => {
    const visits = mergeVisits([at(0), at(0.5), at(1), at(2.5)]);
    expect(visits.length).toBe(1);
    expect(visits[0].endMs - visits[0].startMs).toBe(2.5 * MIN);
  });

  test("splits on a gap of 2 minutes or more", () => {
    const visits = mergeVisits([at(0), at(0.5), at(2.5), at(3)]);
    expect(visits.length).toBe(2);
    expect(visits[0].endMs - visits[0].startMs).toBe(0.5 * MIN);
    expect(visits[1].endMs - visits[1].startMs).toBe(0.5 * MIN);
  });

  test("sorts its input and handles the empty case", () => {
    expect(mergeVisits([])).toEqual([]);
    const visits = mergeVisits([at(1), at(0), at(0.5)]);
    expect(visits.length).toBe(1);
    expect(visits[0].startMs).toBe(at(0));
  });

  test("a single snapshot is a zero-length visit", () => {
    const visits = mergeVisits([at(4)]);
    expect(visits.length).toBe(1);
    expect(visits[0].startMs).toBe(visits[0].endMs);
  });
});

// --- presence -------------------------------------------------------------

function snap(min: number, pairs: Array<[string, string]>): ChatterSnapshot {
  return {
    timestamp: iso(min),
    userIds: pairs.map((p) => p[0]),
    usernames: pairs.map((p) => p[1]),
  };
}

describe("buildPresence", () => {
  const snapshots: ChatterSnapshot[] = [
    snap(0, [
      ["1", "ana"],
      ["9", "waterhousestudios"],
    ]),
    snap(0.5, [
      ["1", "ana"],
      ["2", "bo_beat"],
    ]),
    snap(30, [["1", "ana"]]), // 29.5 min gap -> second visit
    snap(200, [["3", "late"]]), // outside the session
  ];

  test("drops excluded logins and out-of-session snapshots", () => {
    const presence = buildPresence(
      snapshots,
      session(120),
      buildExclusions([null]),
    );
    const ids = presence.map((p) => p.userId).sort();
    expect(ids).toEqual(["1", "2"]);
  });

  test("sums visit lengths across a merged gap", () => {
    const presence = buildPresence(
      snapshots,
      session(120),
      buildExclusions([null]),
    );
    const ana = presence.find((p) => p.userId === "1")!;
    // 0 -> 0.5 is one visit (0.5 min); 30 alone is a second (0 min).
    expect(ana.watchMin).toBe(0.5);
    expect(ana.arrivedMs).toBe(at(0));
    expect(ana.leftMs).toBe(at(30));
  });

  test("excludes the artist's own login when known", () => {
    const presence = buildPresence(
      snapshots,
      session(120),
      buildExclusions(["ana"]),
    );
    expect(presence.map((p) => p.userId)).toEqual(["2"]);
  });
});

// --- classification -------------------------------------------------------

describe("classifyViewer", () => {
  const prior = new Set(["regular", "backagain"]);
  const previous = new Set(["backagain"]);

  test("nobody-has-seen-them is pulled", () => {
    expect(classifyViewer("fresh", prior, previous)).toBe("pulled");
  });

  test("in the artist's previous session is cameBack", () => {
    expect(classifyViewer("backagain", prior, previous)).toBe("cameBack");
  });

  test("seen in the last 30 days but not last time is regular", () => {
    expect(classifyViewer("regular", prior, previous)).toBe("regular");
  });

  test("pulled wins over cameBack when the 30-day window is empty", () => {
    expect(classifyViewer("backagain", new Set(), previous)).toBe("pulled");
  });
});

// --- stayed / bounced -----------------------------------------------------

describe("stayed and bounced", () => {
  test("threshold is the floor for short streams", () => {
    expect(stayThresholdMin(40)).toBe(30);
    expect(isStayed(29.9, 40)).toBe(false);
    expect(isStayed(30, 40)).toBe(true);
  });

  test("threshold is half the stream for long ones", () => {
    expect(stayThresholdMin(153)).toBe(76.5);
    expect(isStayed(76.4, 153)).toBe(false);
    expect(isStayed(76.5, 153)).toBe(true);
  });

  test("bounced is strictly under 10 minutes", () => {
    expect(isBounced(9.9)).toBe(true);
    expect(isBounced(10)).toBe(false);
  });

  test("holdRate is 0 with no uniques", () => {
    expect(computeHoldRate(0, 0)).toBe(0);
    expect(computeHoldRate(3, 6)).toBe(0.5);
  });
});

// --- quadrant -------------------------------------------------------------

describe("quadrantFor", () => {
  test("covers all four corners", () => {
    expect(quadrantFor(2, 0.5)).toBe("packed-held");
    expect(quadrantFor(5, 0.49)).toBe("hype-cliff");
    expect(quadrantFor(1, 0.9)).toBe("small-loyal");
    expect(quadrantFor(1, 0.2)).toBe("quiet");
  });

  test("boundaries are inclusive", () => {
    expect(quadrantFor(2, 0.5)).toBe("packed-held");
    expect(quadrantFor(1, 0.5)).toBe("small-loyal");
  });
});

// --- session -> artist ----------------------------------------------------

function artist(id: string, name: string): ArtistRef {
  return { id, stageName: name, image: null, twitchLogin: null };
}

function reservation(
  id: string,
  startMin: number,
  endMin: number,
  artists: ArtistRef[],
  status = "approved",
): ReservationRef {
  return {
    id,
    start: iso(startMin),
    end: iso(endMin),
    status,
    purpose: null,
    artists,
  };
}

describe("matchSessionToArtists", () => {
  const s = session(100);

  test("takes reservations covering at least 20% of the session", () => {
    const match = matchSessionToArtists(s, [
      reservation("r1", 0, 20, [artist("a", "Ana")]),
    ]);
    expect(match.artists.map((a) => a.id)).toEqual(["a"]);
    expect(match.shared).toBe(false);
  });

  test("ignores thinner overlaps", () => {
    const match = matchSessionToArtists(s, [
      reservation("r1", 0, 19, [artist("a", "Ana")]),
    ]);
    expect(match.artists).toEqual([]);
  });

  test("ignores reservations that are not approved", () => {
    const match = matchSessionToArtists(s, [
      reservation("r1", 0, 90, [artist("a", "Ana")], "pending"),
    ]);
    expect(match.artists).toEqual([]);
  });

  test("credits every artist on the booking and marks it shared", () => {
    const match = matchSessionToArtists(s, [
      reservation("r1", 0, 90, [artist("a", "Ana"), artist("b", "Bo")]),
    ]);
    expect(match.artists.map((a) => a.id)).toEqual(["a", "b"]);
    expect(match.shared).toBe(true);
    expect(match.reservation!.id).toBe("r1");
  });

  test("picks the fattest overlap as the slot-labelling reservation", () => {
    const match = matchSessionToArtists(s, [
      reservation("thin", 0, 30, [artist("a", "Ana")]),
      reservation("fat", 10, 95, [artist("b", "Bo")]),
    ]);
    expect(match.reservation!.id).toBe("fat");
  });
});

// --- initials -------------------------------------------------------------

describe("initialsFromLogin", () => {
  test("splits on separators", () => {
    expect(initialsFromLogin("l4c4_music")).toBe("LM");
  });

  test("falls back to the first two characters", () => {
    expect(initialsFromLogin("dedochtervanludo")).toBe("DE");
  });

  test("never returns something longer than two characters", () => {
    expect(initialsFromLogin("a")).toBe("A?");
    expect(initialsFromLogin("___").length).toBe(2);
  });
});

// --- badges ---------------------------------------------------------------

function candidate(
  over: Partial<BoardCandidate> & { artistId: string },
): BoardCandidate {
  return {
    artistName: over.artistId,
    artistImage: null,
    pulled: 0,
    uniques: 0,
    peak: 0,
    holdRate: 0,
    deltaUniques: null,
    shared: false,
    badges: [],
    cameBack: 0,
    firstSessionMs: 0,
    ...over,
  };
}

describe("assignBadges", () => {
  test("gives each badge to exactly one artist", () => {
    const rows = [
      candidate({
        artistId: "ana",
        pulled: 5,
        uniques: 10,
        holdRate: 0.4,
        cameBack: 1,
        deltaUniques: 2,
        firstSessionMs: 1,
      }),
      candidate({
        artistId: "bo",
        pulled: 1,
        uniques: 6,
        holdRate: 0.8,
        cameBack: 4,
        deltaUniques: 5,
        firstSessionMs: 2,
      }),
    ];
    assignBadges(rows);
    expect(rows[0].badges).toEqual(["most-pulled"]);
    expect(rows[1].badges).toEqual([
      "held-the-room",
      "best-comeback",
      "stickiest",
    ]);
  });

  test("held-the-room and stickiest need at least 3 uniques", () => {
    const rows = [
      candidate({
        artistId: "tiny",
        pulled: 1,
        uniques: 2,
        holdRate: 1,
        cameBack: 2,
        firstSessionMs: 1,
      }),
      candidate({
        artistId: "real",
        pulled: 0,
        uniques: 3,
        holdRate: 0.34,
        cameBack: 1,
        firstSessionMs: 2,
      }),
    ];
    assignBadges(rows);
    expect(rows[0].badges).toEqual(["most-pulled"]);
    expect(rows[1].badges).toEqual(["held-the-room", "stickiest"]);
  });

  test("best-comeback needs a positive delta and goes unawarded otherwise", () => {
    const rows = [
      candidate({ artistId: "ana", uniques: 5, deltaUniques: 0 }),
      candidate({ artistId: "bo", uniques: 5, deltaUniques: -3 }),
      candidate({ artistId: "cy", uniques: 5, deltaUniques: null }),
    ];
    assignBadges(rows);
    for (const row of rows) {
      expect(row.badges.indexOf("best-comeback")).toBe(-1);
    }
  });

  test("ties go to the earliest session", () => {
    const rows = [
      candidate({ artistId: "later", pulled: 4, firstSessionMs: 200 }),
      candidate({ artistId: "earlier", pulled: 4, firstSessionMs: 100 }),
    ];
    assignBadges(rows);
    expect(rows[0].badges).toEqual([]);
    expect(rows[1].badges).toEqual(["most-pulled"]);
  });

  test("re-running clears the previous award", () => {
    const rows = [candidate({ artistId: "ana", pulled: 3 })];
    assignBadges(rows);
    assignBadges(rows);
    expect(rows[0].badges).toEqual(["most-pulled"]);
  });
});

describe("peakAcross", () => {
  const withPeak = (peak: number) =>
    ({ peak }) as unknown as Parameters<typeof peakAcross>[0][number];

  test("takes the highest peak, never the sum", () => {
    expect(peakAcross([withPeak(6), withPeak(9), withPeak(4)])).toBe(9);
  });

  test("two equal shows do not add up", () => {
    expect(peakAcross([withPeak(6), withPeak(6)])).toBe(6);
  });

  test("an artist with no sessions peaks at zero", () => {
    expect(peakAcross([])).toBe(0);
  });
});

describe("rankBoardRows", () => {
  test("pulled desc, then holdRate desc, then uniques desc", () => {
    const rows = [
      candidate({ artistId: "c", pulled: 1, holdRate: 0.9, uniques: 4 }),
      candidate({ artistId: "a", pulled: 3, holdRate: 0.1, uniques: 4 }),
      candidate({ artistId: "b", pulled: 1, holdRate: 0.9, uniques: 9 }),
    ];
    expect(rankBoardRows(rows).map((r) => r.artistId)).toEqual(["a", "b", "c"]);
  });
});

// --- end to end -----------------------------------------------------------

describe("analyseSession", () => {
  test("counts, classifies, sorts and never leaks a login", () => {
    const snapshots: ChatterSnapshot[] = [];
    for (let m = 0; m <= 100; m += 0.5) {
      const pairs: Array<[string, string]> = [
        ["house", "waterhousestudios"],
        ["stayer", "ana_b"],
      ];
      if (m < 5) pairs.push(["bouncer", "quickvisit"]);
      snapshots.push(snap(m, pairs));
    }

    const result = analyseSession({
      session: session(100),
      snapshots,
      exclusions: buildExclusions([null]),
      priorUserIds: new Set(["stayer"]),
      previousSessionUserIds: new Set(["stayer"]),
      slotIso: iso(0),
      shared: false,
    });

    const a = result.audience;
    expect(a.uniques).toBe(2);
    expect(a.cameBack).toBe(1);
    expect(a.pulled).toBe(1);
    expect(a.regulars).toBe(0);
    expect(a.holdRate).toBe(0.5);
    expect(a.quadrant).toBe("small-loyal");
    expect(a.viewers.map((v) => v.initials)).toEqual(["AB", "QU"]);
    expect(a.viewers[0].stayed).toBe(true);
    expect(a.viewers[1].stayed).toBe(false);
    expect(JSON.stringify(a).indexOf("waterhousestudios")).toBe(-1);
    expect(JSON.stringify(a).indexOf("ana_b")).toBe(-1);
    expect(result.entries.map((e) => e.userId).sort()).toEqual([
      "bouncer",
      "stayer",
    ]);
  });
});
