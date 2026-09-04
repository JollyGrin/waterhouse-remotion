import { describe, expect, test } from "bun:test";
import {
  analyseSession,
  assignBadges,
  buildAttendance,
  buildExclusions,
  buildPresence,
  chatStatsFor,
  chatStatsOrNull,
  classifyViewer,
  isHouseRegular,
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
  type AttendanceWindow,
  type ChatMessage,
  type ChatterSnapshot,
  type ViewerAttendance,
  type ReservationRef,
  type StreamSession,
} from "./metrics";

const MIN = 60 * 1000;
const BASE = Date.parse("2026-09-03T17:00:00Z");

const at = (min: number) => BASE + min * MIN;
const iso = (min: number) => new Date(at(min)).toISOString();

function session(durationMin: number, follows = 0): StreamSession {
  return {
    start: iso(0),
    end: iso(durationMin),
    durationMin,
    peakViewers: 9,
    uniqueViewers: 10,
    follows,
  };
}

/** A session at an arbitrary offset, for the attendance-window tests. */
function sessionAt(startMin: number, durationMin: number): StreamSession {
  return {
    start: iso(startMin),
    end: iso(startMin + durationMin),
    durationMin,
    peakViewers: 1,
    uniqueViewers: 1,
    follows: 0,
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

describe("isHouseRegular / classifyViewer", () => {
  const prior = new Set(["fan", "everywhere", "stranger"]);

  /** A 90-day window with `houseSessions` shows in it. */
  const window = (
    houseSessions: number,
    viewers: Record<string, ViewerAttendance>,
  ): AttendanceWindow => ({
    houseSessions,
    viewers: new Map(Object.keys(viewers).map((k) => [k, viewers[k]])),
  });

  test("nobody has seen them before -> pulled", () => {
    expect(classifyViewer("fresh", prior, window(65, {}))).toBe("pulled");
  });

  test("a fan of this artist who is not always around -> returning", () => {
    // 3 of this artist's shows, 7 other nights, out of 65 house sessions.
    const w = window(65, {
      fan: { artistSessions: 3, attendedSessions: 10 },
    });
    expect(isHouseRegular(w.viewers.get("fan"), w.houseSessions)).toBe(false);
    expect(classifyViewer("fan", prior, w)).toBe("returning");
  });

  test("a house regular is regular even having seen this artist", () => {
    // 30 of 65 nights: they would have been here whoever was playing.
    const w = window(65, {
      everywhere: { artistSessions: 4, attendedSessions: 30 },
    });
    expect(isHouseRegular(w.viewers.get("everywhere"), w.houseSessions)).toBe(
      true,
    );
    expect(classifyViewer("everywhere", prior, w)).toBe("regular");
  });

  test("a third of the house is exactly the line", () => {
    const w = window(66, {
      onTheLine: { artistSessions: 1, attendedSessions: 22 },
      justUnder: { artistSessions: 1, attendedSessions: 21 },
    });
    expect(isHouseRegular(w.viewers.get("onTheLine"), 66)).toBe(true);
    expect(isHouseRegular(w.viewers.get("justUnder"), 66)).toBe(false);
  });

  test("never having seen this artist -> regular", () => {
    const w = window(65, {
      stranger: { artistSessions: 0, attendedSessions: 4 },
    });
    expect(classifyViewer("stranger", prior, w)).toBe("regular");
  });

  test("pulled wins over returning however strong the record", () => {
    const w = window(65, { fan: { artistSessions: 3, attendedSessions: 10 } });
    expect(classifyViewer("fan", prior, w)).toBe("returning");
    // Same record, but unseen in the 30-day window:
    expect(classifyViewer("fan", new Set(), w)).toBe("pulled");
  });

  test("an empty window makes nobody a house regular", () => {
    expect(isHouseRegular({ artistSessions: 0, attendedSessions: 0 }, 0)).toBe(
      false,
    );
    expect(isHouseRegular(undefined, 65)).toBe(false);
  });
});

describe("buildAttendance", () => {
  // Three sessions: two are ana's, one is bo's.
  const attended = [
    { session: sessionAt(0, 60), artistIds: ["ana"] },
    { session: sessionAt(200, 60), artistIds: ["bo"] },
    { session: sessionAt(400, 60), artistIds: ["ana"] },
  ];
  const snapshots: ChatterSnapshot[] = [
    snap(10, [["regular", "reg"]]),
    snap(20, [["regular", "reg"]]), // same session, counted once
    snap(210, [["regular", "reg"]]),
    snap(410, [["regular", "reg"]]),
    snap(410, [["anafan", "fan"]]),
  ];

  test("counts distinct sessions, not snapshots", () => {
    const w = buildAttendance(snapshots, attended, "ana", at(0), at(1000));
    expect(w.houseSessions).toBe(3);
    expect(w.viewers.get("regular")).toEqual({
      artistSessions: 2,
      attendedSessions: 3,
    });
    expect(w.viewers.get("anafan")).toEqual({
      artistSessions: 1,
      attendedSessions: 1,
    });
  });

  test("honours the window bounds", () => {
    const w = buildAttendance(snapshots, attended, "ana", at(300), at(1000));
    expect(w.houseSessions).toBe(1);
    expect(w.viewers.get("regular")).toEqual({
      artistSessions: 1,
      attendedSessions: 1,
    });
  });

  test("a viewer who never saw this artist has a zero numerator", () => {
    const w = buildAttendance(snapshots, attended, "bo", at(0), at(1000));
    expect(w.viewers.get("anafan")).toEqual({
      artistSessions: 0,
      attendedSessions: 1,
    });
  });

  test("blips under 5 minutes are not shows", () => {
    const withBlip = attended.concat([
      { session: sessionAt(600, 2), artistIds: ["ana"] },
    ]);
    const blipSnaps = snapshots.concat([snap(601, [["regular", "reg"]])]);
    const w = buildAttendance(blipSnaps, withBlip, "ana", at(0), at(1000));
    expect(w.houseSessions).toBe(3);
    expect(w.viewers.get("regular")!.attendedSessions).toBe(3);
  });
});

// --- stayed / bounced -----------------------------------------------------

describe("stayed and bounced", () => {
  test("half an hour caps the threshold on a long set", () => {
    expect(stayThresholdMin(153)).toBe(30);
    expect(isStayed(29.9, 153)).toBe(false);
    expect(isStayed(30, 153)).toBe(true);
  });

  test("a short set only asks for half of itself", () => {
    expect(stayThresholdMin(40)).toBe(20);
    expect(isStayed(19.9, 40)).toBe(false);
    expect(isStayed(20, 40)).toBe(true);
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
    expect(quadrantFor(3, 0.5)).toBe("packed-held");
    expect(quadrantFor(5, 0.49)).toBe("hype-cliff");
    expect(quadrantFor(2, 0.9)).toBe("small-loyal");
    expect(quadrantFor(2, 0.2)).toBe("quiet");
  });

  test("the x axis is crowd, and 3 is the line", () => {
    expect(quadrantFor(2, 0.5)).toBe("small-loyal");
    expect(quadrantFor(3, 0.5)).toBe("packed-held");
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
    crowd: 0,
    pulled: 0,
    returning: 0,
    uniques: 0,
    holdRate: 0,
    peak: 0,
    follows: 0,
    chat: null,
    deltaCrowd: null,
    shared: false,
    badges: [],
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
        follows: 7,
        chat: { messages: 30, chatters: 2 },
        deltaCrowd: 2,
        firstSessionMs: 1,
      }),
      candidate({
        artistId: "bo",
        pulled: 1,
        uniques: 6,
        holdRate: 0.8,
        follows: 1,
        chat: { messages: 12, chatters: 5 },
        deltaCrowd: 5,
        firstSessionMs: 2,
      }),
    ];
    assignBadges(rows);
    expect(rows[0].badges).toEqual(["most-pulled", "most-follows"]);
    expect(rows[1].badges).toEqual([
      "held-the-room",
      "loudest-room",
      "best-comeback",
    ]);
  });

  test("held-the-room and loudest-room need at least 3 uniques", () => {
    const rows = [
      candidate({
        artistId: "tiny",
        pulled: 1,
        uniques: 2,
        holdRate: 1,
        chat: { messages: 9, chatters: 2 },
        firstSessionMs: 1,
      }),
      candidate({
        artistId: "real",
        pulled: 0,
        uniques: 3,
        holdRate: 0.34,
        chat: { messages: 4, chatters: 1 },
        firstSessionMs: 2,
      }),
    ];
    assignBadges(rows);
    expect(rows[0].badges).toEqual(["most-pulled"]);
    expect(rows[1].badges).toEqual(["held-the-room", "loudest-room"]);
  });

  test("loudest-room ignores rows with no chat data", () => {
    const rows = [
      candidate({ artistId: "unknown", uniques: 10, chat: null }),
      candidate({
        artistId: "known",
        uniques: 4,
        chat: { messages: 2, chatters: 1 },
      }),
    ];
    assignBadges(rows);
    expect(rows[0].badges.indexOf("loudest-room")).toBe(-1);
    expect(rows[1].badges).toEqual(["loudest-room"]);
  });

  test("a week with no chat at all awards no loudest-room", () => {
    const rows = [
      candidate({ artistId: "ana", uniques: 9, chat: null }),
      candidate({ artistId: "bo", uniques: 5, chat: null }),
    ];
    assignBadges(rows);
    for (const row of rows) {
      expect(row.badges.indexOf("loudest-room")).toBe(-1);
    }
  });

  test("most-pulled and most-follows need a positive count", () => {
    const rows = [
      candidate({ artistId: "ana", pulled: 0, follows: 0, uniques: 5 }),
      candidate({ artistId: "bo", pulled: 0, follows: 0, uniques: 5 }),
    ];
    assignBadges(rows);
    for (const row of rows) {
      expect(row.badges.indexOf("most-pulled")).toBe(-1);
      expect(row.badges.indexOf("most-follows")).toBe(-1);
    }
  });

  test("best-comeback needs a positive delta and goes unawarded otherwise", () => {
    const rows = [
      candidate({ artistId: "ana", uniques: 5, deltaCrowd: 0 }),
      candidate({ artistId: "bo", uniques: 5, deltaCrowd: -3 }),
      candidate({ artistId: "cy", uniques: 5, deltaCrowd: null }),
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
  test("crowd desc, then holdRate desc, then peak desc", () => {
    const rows = [
      candidate({ artistId: "c", crowd: 1, holdRate: 0.9, peak: 4 }),
      candidate({ artistId: "a", crowd: 3, holdRate: 0.1, peak: 4 }),
      candidate({ artistId: "b", crowd: 1, holdRate: 0.9, peak: 9 }),
    ];
    expect(rankBoardRows(rows).map((r) => r.artistId)).toEqual(["a", "b", "c"]);
  });

  test("a big raw audience does not outrank a bigger crowd", () => {
    const rows = [
      candidate({ artistId: "house-regulars", crowd: 1, uniques: 20 }),
      candidate({ artistId: "brought-people", crowd: 4, uniques: 5 }),
    ];
    expect(rankBoardRows(rows)[0].artistId).toBe("brought-people");
  });
});

// --- chat ----------------------------------------------------------------

describe("chatStatsFor", () => {
  const messages: ChatMessage[] = [
    { timestamp: iso(5), userId: "a", username: "ana" },
    { timestamp: iso(6), userId: "a", username: "ana" },
    { timestamp: iso(7), userId: "b", username: "bo" },
    { timestamp: iso(8), userId: "h", username: "waterhousestudios" },
    { timestamp: iso(500), userId: "c", username: "cy" },
    { timestamp: iso(205), userId: "a", username: "ana" },
  ];

  test("counts messages and distinct chatters inside the session", () => {
    const stats = chatStatsFor(messages, [session(100)], buildExclusions([]));
    expect(stats).toEqual({ messages: 3, chatters: 2 });
  });

  test("drops the house account and the artist", () => {
    const stats = chatStatsFor(
      messages,
      [session(100)],
      buildExclusions(["ana"]),
    );
    expect(stats).toEqual({ messages: 1, chatters: 1 });
  });

  test("chatters stay distinct across several sessions", () => {
    const stats = chatStatsFor(
      messages,
      [session(100), sessionAt(200, 60)],
      buildExclusions([]),
    );
    expect(stats).toEqual({ messages: 4, chatters: 2 });
  });

  test("a window with nothing in it is a real zero, not null", () => {
    expect(chatStatsFor([], [session(100)], buildExclusions([]))).toEqual({
      messages: 0,
      chatters: 0,
    });
  });
});

describe("chatStatsOrNull", () => {
  const houseOnly: ChatMessage[] = [
    { timestamp: iso(5), userId: "h", username: "waterhousestudios" },
  ];

  test("no rows captured in the window -> null, never a zero", () => {
    expect(chatStatsOrNull([], [session(100)], buildExclusions([]))).toBeNull();
  });

  test("rows outside every session window still count as no data", () => {
    const elsewhere: ChatMessage[] = [
      { timestamp: iso(500), userId: "a", username: "ana" },
    ];
    expect(
      chatStatsOrNull(elsewhere, [session(100)], buildExclusions([])),
    ).toBeNull();
  });

  test("captured but silent after exclusions is a real zero", () => {
    expect(
      chatStatsOrNull(houseOnly, [session(100)], buildExclusions([])),
    ).toEqual({ messages: 0, chatters: 0 });
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
      session: session(100, 3),
      snapshots,
      exclusions: buildExclusions([null]),
      priorUserIds: new Set(["stayer"]),
      attendance: {
        houseSessions: 20,
        viewers: new Map([
          ["stayer", { artistSessions: 3, attendedSessions: 5 }],
        ]),
      },
      chat: { messages: 8, chatters: 1 },
      slotIso: iso(0),
      shared: false,
    });

    const a = result.audience;
    expect(a.uniques).toBe(2);
    expect(a.returning).toBe(1);
    expect(a.pulled).toBe(1);
    expect(a.regulars).toBe(0);
    expect(a.crowd).toBe(2);
    expect(a.holdRate).toBe(0.5);
    expect(a.follows).toBe(3);
    expect(a.chat).toEqual({ messages: 8, chatters: 1 });
    // crowd 2 is under the "many" line of 3, holdRate is on the line.
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

  test("chat null survives to the props untouched", () => {
    const result = analyseSession({
      session: session(60),
      snapshots: [snap(1, [["a", "ana"]])],
      exclusions: buildExclusions([]),
      priorUserIds: new Set(),
      attendance: { houseSessions: 0, viewers: new Map() },
      chat: null,
      shared: false,
    });
    expect(result.audience.chat).toBeNull();
    expect(result.audience.follows).toBe(0);
  });
});
