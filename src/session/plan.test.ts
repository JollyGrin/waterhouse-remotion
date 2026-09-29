import { describe, expect, test } from "bun:test";
import {
  addMinutes,
  askDay,
  findSessionSlot,
  matchArtist,
  runningOrder,
  sessionStem,
  type SessionReservation,
} from "./plan";

const denzo = { id: "d", stage_name: "Denzo", profile_image_url: "d.jpg" };
const duncen = {
  id: "g",
  stage_name: "Duncen Haakmat",
  profile_image_url: "g.png",
};

// UTC day is enough for the tests; the script passes a local-time one.
const utcDay = (iso: string) => iso.slice(0, 10);

function booking(
  over: Partial<SessionReservation> & { start_time: string },
): SessionReservation {
  return {
    id: over.start_time,
    status: "approved",
    purpose: "Radio: Waterhouse Sessions",
    artists: [denzo],
    ...over,
  };
}

describe("findSessionSlot", () => {
  test("finds the approved Waterhouse Sessions booking on the day", () => {
    const today = booking({
      start_time: "2026-09-29T17:00:00.000Z",
      artists: [denzo, duncen],
    });
    const slot = findSessionSlot(
      [booking({ start_time: "2026-09-22T17:00:00.000Z" }), today],
      "2026-09-29",
      utcDay,
    );
    expect(slot).toBe(today);
  });

  test("ignores Sunday Sessions, cancelled bookings and other purposes", () => {
    const day = "2026-09-29";
    const slot = findSessionSlot(
      [
        booking({
          start_time: "2026-09-29T15:00:00Z",
          purpose: "Sunday Sessions",
        }),
        booking({ start_time: "2026-09-29T17:00:00Z", status: "cancelled" }),
        booking({ start_time: "2026-09-29T19:00:00Z", purpose: "Radio: X" }),
      ],
      day,
      utcDay,
    );
    expect(slot).toBeNull();
  });
});

describe("matchArtist", () => {
  test("a first name finds the full stage name", () => {
    expect(matchArtist("Duncen", [denzo, duncen])).toEqual({
      kind: "found",
      artist: duncen,
    });
  });

  test("exact, case-insensitive match", () => {
    expect(matchArtist("denzo", [denzo, duncen])).toEqual({
      kind: "found",
      artist: denzo,
    });
  });

  test("does not match mid-word", () => {
    expect(matchArtist("Dun", [duncen]).kind).toBe("none");
  });

  test("the session's own artists win over the roster", () => {
    const namesake = { ...duncen, id: "other", stage_name: "Duncen Other" };
    expect(matchArtist("Duncen", [duncen], [namesake, duncen])).toEqual({
      kind: "found",
      artist: duncen,
    });
  });

  test("two prefix matches in one pool are ambiguous", () => {
    const namesake = { ...duncen, id: "other", stage_name: "Duncen Other" };
    const m = matchArtist("Duncen", [], [duncen, namesake]);
    expect(m.kind).toBe("ambiguous");
  });
});

describe("running order", () => {
  test("interview then set, with the set start computed", () => {
    expect(
      runningOrder({
        hostName: "Denzo",
        eventTime: "19:00",
        interview: true,
        interviewMinutes: 20,
      }),
    ).toBe("19:00 Interview with Denzo, then live set 19:20");
  });

  test("interview: false is a plain guest set, Denzo hosting", () => {
    expect(
      runningOrder({
        hostName: "Denzo",
        eventTime: "19:00",
        interview: false,
        interviewMinutes: 20,
      }),
    ).toBe("19:00 Live set, hosted by Denzo");
  });

  test("addMinutes wraps past the hour and midnight", () => {
    expect(addMinutes("19:50", 20)).toBe("20:10");
    expect(addMinutes("23:50", 30)).toBe("00:20");
  });
});

describe("askDay", () => {
  test("TODAY when rendered on the session's date", () => {
    expect(askDay("Tuesday", true)).toBe("TODAY");
  });

  test("the weekday otherwise", () => {
    expect(askDay("Tuesday", false)).toBe("TUESDAY");
  });
});

test("filename stem is named after the guest as typed", () => {
  expect(sessionStem("Duncen", "2026-09-29")).toBe("Session-duncen-2026-09-29");
});
