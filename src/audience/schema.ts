/**
 * Props schemas for the "Who Showed Up" recap videos.
 *
 * These are the contract between `scripts/fetch-audience.ts` (which does all
 * the counting, once, against the live APIs) and the `ArtistRecap` /
 * `HouseWeekly` compositions (which only draw). Compositions must never
 * recompute a number that lives here — see `src/audience/metrics.ts` for the
 * definitions behind each field.
 *
 * Privacy: nothing here carries a Twitch login or user id. Viewers are
 * identified by two-character initials only.
 */
import { z } from "zod";

/** One person in the room for one session. */
export const viewerSchema = z.object({
  /** Two characters derived from the login. Never the login itself. */
  initials: z.string().length(2),
  kind: z.enum(["pulled", "cameBack", "regular"]),
  /** Minutes after the session start when they were first seen. */
  arrivedMin: z.number(),
  /** Minutes after the session start when they were last seen. */
  leftMin: z.number(),
  /** Summed length of their visits, gaps under 2 min merged. */
  watchMin: z.number(),
  /** watchMin >= max(30, half the session). */
  stayed: z.boolean(),
});

export const quadrantSchema = z.enum([
  "packed-held",
  "hype-cliff",
  "small-loyal",
  "quiet",
]);

/** One stream, joined to the artist who was booked for it. */
export const sessionAudienceSchema = z.object({
  start: z.string(),
  end: z.string(),
  durationMin: z.number(),
  /** Booked slot in Amsterdam time, e.g. "Wed 7pm". */
  slotLabel: z.string(),
  /** e.g. "Sep 3". */
  dateLabel: z.string(),
  /** Peak concurrent viewers as reported by the event logger (raw). */
  peak: z.number(),
  /** Distinct viewers after exclusions. */
  uniques: z.number(),
  pulled: z.number(),
  cameBack: z.number(),
  regulars: z.number(),
  holdRate: z.number(),
  quadrant: quadrantSchema,
  /** The session was credited to more than one artist. */
  shared: z.boolean(),
  /** Sorted by arrivedMin. */
  viewers: z.array(viewerSchema),
});

export const nextSlotSchema = z.object({
  /** e.g. "Wed". */
  dayLabel: z.string(),
  /** e.g. "7pm". */
  time: z.string(),
  /** e.g. "Sep 10". */
  dateLabel: z.string(),
});

export const artistRecapPropsSchema = z.object({
  artistName: z.string(),
  artistImage: z.string().nullable(),
  /** Oldest to newest. */
  sessions: z.array(sessionAudienceSchema),
  /** Best uniques the artist has ever posted, across all known sessions. */
  bestUniques: z.number(),
  nextSlot: nextSlotSchema.nullable(),
});

export const badgeSchema = z.enum([
  "most-pulled",
  "held-the-room",
  "best-comeback",
  "stickiest",
]);

export const boardRowSchema = z.object({
  artistName: z.string(),
  artistImage: z.string().nullable(),
  pulled: z.number(),
  uniques: z.number(),
  holdRate: z.number(),
  /** uniques minus the artist's previous session, null if it is their first. */
  deltaUniques: z.number().nullable(),
  shared: z.boolean(),
  badges: z.array(badgeSchema),
});

export const houseSeriesPointSchema = z.object({
  /** e.g. "W36". */
  weekLabel: z.string(),
  pulled: z.number(),
});

export const nextWeekSlotSchema = z.object({
  dayLabel: z.string(),
  time: z.string(),
  artistName: z.string(),
  /** The artist's most recent uniques — the number to beat. */
  beat: z.number().nullable(),
});

export const houseWeeklyPropsSchema = z.object({
  /** e.g. "Week 36". */
  weekLabel: z.string(),
  /** e.g. "Aug 28 - Sep 3". */
  rangeLabel: z.string(),
  shows: z.number(),
  uniques: z.number(),
  pulled: z.number(),
  /** Ranked: pulled desc, then holdRate desc, then uniques desc. */
  rows: z.array(boardRowSchema),
  /** Eight points, oldest to newest. */
  houseSeries: z.array(houseSeriesPointSchema),
  nextWeek: z.array(nextWeekSlotSchema),
});

export type Viewer = z.infer<typeof viewerSchema>;
export type Quadrant = z.infer<typeof quadrantSchema>;
export type SessionAudience = z.infer<typeof sessionAudienceSchema>;
export type NextSlot = z.infer<typeof nextSlotSchema>;
export type ArtistRecapProps = z.infer<typeof artistRecapPropsSchema>;
export type Badge = z.infer<typeof badgeSchema>;
export type BoardRow = z.infer<typeof boardRowSchema>;
export type HouseSeriesPoint = z.infer<typeof houseSeriesPointSchema>;
export type NextWeekSlot = z.infer<typeof nextWeekSlotSchema>;
export type HouseWeeklyProps = z.infer<typeof houseWeeklyPropsSchema>;
