import { describe, expect, it } from "bun:test";
import {
  boil,
  jitter,
  noise,
  onTwos,
  pendulum,
  pendulumApexFrames,
  punch,
  shake,
  tornPolygon,
} from "./fx";

describe("noise", () => {
  it("is deterministic and within [-1, 1]", () => {
    for (let f = 0; f < 200; f++) {
      const v = noise(3, f);
      expect(v).toBe(noise(3, f));
      expect(Math.abs(v)).toBeLessThanOrEqual(1);
    }
  });
  it("differs by seed and by frame", () => {
    expect(noise(1, 5)).not.toBe(noise(2, 5));
    expect(noise(1, 5)).not.toBe(noise(1, 6));
  });
  it("is roughly centred", () => {
    let sum = 0;
    for (let f = 0; f < 2000; f++) sum += noise(9, f);
    expect(Math.abs(sum / 2000)).toBeLessThan(0.08);
  });
});

describe("stop motion", () => {
  it("holds frames on twos", () => {
    expect([0, 1, 2, 3, 4, 5].map(onTwos)).toEqual([0, 0, 2, 2, 4, 4]);
  });
  it("jitters by whole pixels and only every second frame", () => {
    const a = jitter(4, 10, 1);
    expect(jitter(4, 11, 1)).toEqual(a);
    expect(Math.abs(a.x)).toBeLessThanOrEqual(1);
    expect(Number.isInteger(a.y)).toBe(true);
  });
  it("boils within the amplitude and steps on twos", () => {
    const a = boil(2, 20, 0.6);
    expect(boil(2, 21, 0.6)).toEqual(a);
    expect(Math.abs(a.x)).toBeLessThanOrEqual(0.6);
    expect(Math.abs(a.y)).toBeLessThanOrEqual(0.6);
  });
});

describe("camera", () => {
  it("shakes only inside the window and decays to nothing", () => {
    expect(shake(9, 10, 10, 1)).toEqual({ x: 0, y: 0 });
    expect(shake(18, 10, 10, 1)).toEqual({ x: 0, y: 0 });
    const first = shake(10, 10, 10, 1);
    const late = shake(16, 10, 10, 1);
    expect(Math.hypot(first.x, first.y)).toBeGreaterThan(0);
    expect(Math.abs(late.x)).toBeLessThanOrEqual(10 * Math.pow(1 - 6 / 8, 2));
  });
  it("punches in and comes straight back", () => {
    expect(punch(5, 10, 0.03)).toBe(1);
    expect(punch(12, 10, 0.03)).toBeCloseTo(1.03, 5);
    expect(punch(14, 10, 0.03)).toBeCloseTo(1, 5);
    expect(punch(20, 10, 0.03)).toBe(1);
  });
});

describe("tornPolygon", () => {
  it("keeps the corners and stays near the box", () => {
    const pts = tornPolygon(200, 80, 5, 14, 5)
      .split(", ")
      .map((p) => p.replace(/px/g, "").split(" ").map(Number));
    expect(pts[0]).toEqual([0, 0]);
    expect(pts.some(([x, y]) => x === 200 && y === 0)).toBe(true);
    expect(pts.some(([x, y]) => x === 200 && y === 80)).toBe(true);
    expect(pts.some(([x, y]) => x === 0 && y === 80)).toBe(true);
    for (const [x, y] of pts) {
      expect(x).toBeGreaterThanOrEqual(-5);
      expect(x).toBeLessThanOrEqual(205);
      expect(y).toBeGreaterThanOrEqual(-5);
      expect(y).toBeLessThanOrEqual(85);
    }
    expect(pts.length).toBeGreaterThan(20);
  });
});

describe("pendulum", () => {
  const k = 2.1;
  const w = 7.85;
  it("starts at the release angle and decays", () => {
    expect(pendulum(0, 55, k, w)).toBe(55);
    expect(Math.abs(pendulum(1.4, 55, k, w))).toBeLessThan(3);
  });
  it("apex frames alternate side and come every half period", () => {
    const apices = pendulumApexFrames(k, w, 30, 42);
    expect(apices.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < apices.length; i++) {
      const gap = apices[i] - apices[i - 1];
      expect(gap).toBeGreaterThanOrEqual(11);
      expect(gap).toBeLessThanOrEqual(13);
      const a = pendulum(apices[i] / 30, 55, k, w);
      const b = pendulum(apices[i - 1] / 30, 55, k, w);
      expect(Math.sign(a)).toBe(-Math.sign(b));
    }
  });
});
