import { describe, expect, it } from "bun:test";
import { BEAT_GRID, DOOR_BEATS, DOOR_DURATION, DOOR_IDLE_FRAME, doorAngleAt } from "./Door";
import { LAMP_BEATS, LAMP_DURATION, LAMP_IDLE_FRAME } from "./Lamp";
import { PAPER_BEATS, PAPER_DURATION, PAPER_IDLE_FRAME } from "./Paper";
import { BUMPER_IDEAS, bumperDuration, bumperOutName } from "./SessionBumper";
import { stripFrames } from "./Strip";

describe("door beats", () => {
  it("has four hits at 120 bpm, 15 frames apart", () => {
    expect(BEAT_GRID).toHaveLength(4);
    for (let i = 1; i < BEAT_GRID.length; i++) {
      expect(BEAT_GRID[i] - BEAT_GRID[i - 1]).toBe(15);
    }
  });
  it("lands the knock, swing, slam and name on the grid and the push a beat later", () => {
    expect(DOOR_BEATS.knocks[0]).toBe(BEAT_GRID[0]);
    expect(DOOR_BEATS.swing).toBe(BEAT_GRID[1]);
    expect(DOOR_BEATS.slam).toBe(BEAT_GRID[2]);
    expect(DOOR_BEATS.name).toBe(BEAT_GRID[3]);
    expect(DOOR_BEATS.push).toBe(BEAT_GRID[3] + 15);
  });
  it("swings open, slams shut, holds, then opens fully", () => {
    expect(doorAngleAt(DOOR_BEATS.swing - 1)).toBe(0);
    expect(doorAngleAt(DOOR_BEATS.slam - 5)).toBeLessThan(-55);
    expect(doorAngleAt(DOOR_BEATS.slam)).toBeCloseTo(0, 5);
    expect(doorAngleAt(DOOR_BEATS.open - 1)).toBe(0);
    expect(doorAngleAt(DOOR_IDLE_FRAME)).toBeLessThan(-95);
    expect(DOOR_BEATS.open - DOOR_BEATS.slam).toBe(6);
  });
  it("is transparent before it ends", () => {
    expect(DOOR_BEATS.clear).toBeLessThan(DOOR_DURATION);
  });
});

describe("lamp beats", () => {
  it("creaks at the swing apices, every ~12 frames, before it settles", () => {
    expect(LAMP_BEATS.apices.length).toBeGreaterThanOrEqual(3);
    expect(LAMP_BEATS.apices[0]).toBeGreaterThan(LAMP_BEATS.click);
    expect(LAMP_BEATS.apices[LAMP_BEATS.apices.length - 1]).toBeLessThan(LAMP_BEATS.settle);
  });
  it("turns, thumps, whites out and clears in order", () => {
    expect(LAMP_BEATS.turn).toBeLessThan(LAMP_BEATS.thump);
    expect(LAMP_BEATS.thump).toBeLessThan(LAMP_BEATS.white);
    expect(LAMP_BEATS.white).toBeLessThan(LAMP_BEATS.clear);
    expect(LAMP_BEATS.clear).toBeLessThanOrEqual(LAMP_DURATION);
    expect(LAMP_IDLE_FRAME).toBeGreaterThan(LAMP_BEATS.settle);
    expect(LAMP_IDLE_FRAME).toBeLessThan(LAMP_BEATS.turn);
  });
});

describe("paper beats", () => {
  it("drops the four pieces 8 frames apart from f6", () => {
    expect(PAPER_BEATS.drops).toEqual([6, 14, 22, 30]);
  });
  it("strip, scrap, hand, flick, grab, clear in order", () => {
    const order = [PAPER_BEATS.strip, PAPER_BEATS.scrap, PAPER_BEATS.hand, PAPER_BEATS.flick, PAPER_BEATS.grab, PAPER_BEATS.clear];
    for (let i = 1; i < order.length; i++) expect(order[i]).toBeGreaterThan(order[i - 1]);
    expect(PAPER_BEATS.clear).toBeLessThanOrEqual(PAPER_DURATION);
    expect(PAPER_IDLE_FRAME).toBeGreaterThan(PAPER_BEATS.scrap + 6);
    expect(PAPER_IDLE_FRAME).toBeLessThan(PAPER_BEATS.hand);
  });
});

describe("SessionBumper ideas", () => {
  it("knows all four ideas, their durations and file names", () => {
    expect(BUMPER_IDEAS).toEqual(["door", "corner", "lamp", "paper"]);
    expect(bumperDuration({ idea: "lamp" })).toBe(LAMP_DURATION);
    expect(bumperDuration({ idea: "paper", idle: true })).toBe(60);
    expect(bumperOutName({ idea: "paper", idle: true })).toBe("Bumper-paper-idle.webm");
  });
  it("strips every 10th frame plus the last", () => {
    const frames = stripFrames({ idea: "lamp", guestName: null, step: 10, columns: 4 });
    expect(frames[0]).toBe(0);
    expect(frames[frames.length - 1]).toBe(LAMP_DURATION - 1);
  });
});
