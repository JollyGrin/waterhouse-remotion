import { describe, expect, it } from "bun:test";
import {
  area,
  buildCracks,
  buildPanes,
  driftAt,
  fallOrder,
  solveDrift,
  standingPolygon,
} from "./corner-plan";

const spec = {
  width: 1920,
  height: 1080,
  boxW: 360,
  boxH: 288,
  rightBounce: 14,
  bottomBounce: 20,
  cornerFrame: 46,
};

describe("solveDrift", () => {
  it("lands exactly in the top-left corner on the corner frame", () => {
    const d = solveDrift(spec);
    expect(driftAt(spec, d, 46)).toEqual({ x: 0, y: 0 });
    // One frame earlier it is still off the corner on both axes.
    const before = driftAt(spec, d, 45);
    expect(before.x).toBeCloseTo(d.vx, 6);
    expect(before.y).toBeCloseTo(d.vy, 6);
  });

  it("touches the right edge and the bottom edge on the bounce frames", () => {
    const d = solveDrift(spec);
    expect(driftAt(spec, d, 14).x).toBeCloseTo(1920 - 360, 6);
    expect(driftAt(spec, d, 20).y).toBeCloseTo(1080 - 288, 6);
  });

  it("starts inside the frame and never leaves it", () => {
    const d = solveDrift(spec);
    for (let f = 0; f <= 46; f++) {
      const p = driftAt(spec, d, f);
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(1920 - 360 + 1e-6);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(1080 - 288 + 1e-6);
    }
  });

  it("refuses a bottom bounce too late to climb back in time", () => {
    expect(() => solveDrift({ ...spec, bottomBounce: 30 })).toThrow();
  });
});

describe("cracks and panes", () => {
  const crackSpec = {
    width: 1920,
    height: 1080,
    boxW: 384,
    boxH: 312,
    count: 4,
    seed: 7,
    jitterPx: 18,
    jitterDeg: 6,
    segments: 6,
  };
  const cracks = buildCracks(crackSpec);
  const panes = buildPanes(crackSpec, cracks);

  it("every crack starts at the corner and ends on the frame edge", () => {
    for (const c of cracks) {
      expect(c.points[0]).toEqual({ x: 0, y: 0 });
      const e = c.end;
      expect(Math.abs(e.x - 1920) < 1e-6 || Math.abs(e.y - 1080) < 1e-6).toBe(
        true,
      );
    }
  });

  it("the panes tile the whole frame", () => {
    const total = panes.reduce((sum, p) => sum + area(p.polygon), 0);
    expect(total).toBeCloseTo(1920 * 1080, 3);
    expect(panes).toHaveLength(crackSpec.count + 2);
  });

  it("the logo pane falls last", () => {
    const order = fallOrder(panes);
    expect(order).toHaveLength(panes.length);
    expect(panes[order[order.length - 1]].isLogo).toBe(true);
    expect(new Set(order).size).toBe(panes.length);
  });

  it("the standing glass is exactly the panes that have not fallen", () => {
    const order = fallOrder(panes);
    for (let fallen = 0; fallen <= panes.length; fallen++) {
      const standing = standingPolygon(crackSpec, cracks, fallen);
      const expected = order
        .slice(fallen)
        .reduce((sum, i) => sum + area(panes[i].polygon), 0);
      if (fallen === panes.length) {
        expect(standing).toBeNull();
      } else {
        expect(area(standing!)).toBeCloseTo(expected, 3);
      }
    }
  });
});
