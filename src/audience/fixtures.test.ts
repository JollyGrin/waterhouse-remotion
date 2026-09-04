import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";

import { artistRecapPropsSchema, houseWeeklyPropsSchema } from "./schema";

const read = (name: string): unknown =>
  JSON.parse(readFileSync(`src/audience/fixtures/${name}`, "utf8"));

describe("checked-in fixtures", () => {
  test("recap.json matches ArtistRecapProps", () => {
    const recap = artistRecapPropsSchema.parse(read("recap.json"));
    expect(recap.sessions.length).toBeGreaterThan(0);
    for (const s of recap.sessions) {
      expect(s.pulled + s.cameBack + s.regulars).toBe(s.uniques);
      expect(s.viewers.length).toBe(s.uniques);
      for (let i = 1; i < s.viewers.length; i++) {
        expect(s.viewers[i].arrivedMin).toBeGreaterThanOrEqual(
          s.viewers[i - 1].arrivedMin,
        );
      }
      // Initials only: never a login.
      for (const v of s.viewers) {
        expect(v.initials).toBe(v.initials.toUpperCase());
        expect(v.initials.length).toBe(2);
      }
    }
    // Sessions run oldest to newest.
    for (let i = 1; i < recap.sessions.length; i++) {
      expect(Date.parse(recap.sessions[i].start)).toBeGreaterThan(
        Date.parse(recap.sessions[i - 1].start),
      );
    }
  });

  test("weekly.json matches HouseWeeklyProps", () => {
    const weekly = houseWeeklyPropsSchema.parse(read("weekly.json"));
    expect(weekly.houseSeries.length).toBe(8);
    expect(weekly.rows.length).toBeGreaterThan(0);
    for (let i = 1; i < weekly.rows.length; i++) {
      expect(weekly.rows[i - 1].pulled).toBeGreaterThanOrEqual(
        weekly.rows[i].pulled,
      );
    }
    // Peak is display-only, but every artist on the board streamed at
    // least once, so it must be a positive count.
    for (const row of weekly.rows) {
      expect(row.peak).toBeGreaterThan(0);
    }
    // Every badge is held by at most one artist.
    const seen = new Set<string>();
    for (const row of weekly.rows) {
      for (const badge of row.badges) {
        expect(seen.has(badge)).toBe(false);
        seen.add(badge);
      }
    }
  });
});
