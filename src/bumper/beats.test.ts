import { describe, expect, it } from "bun:test";
import { BEAT_GRID, DOOR_BEATS, DOOR_DURATION, DOOR_IDLE_FRAME, doorAngleAt } from "./Door";
import { LAMP_BEATS, LAMP_DURATION, LAMP_IDLE_FRAME } from "./Lamp";
import { NEON_BEATS, NEON_DURATION, NEON_IDLE_FRAME, idleDropout } from "./Neon";
import { PAPER_BEATS, PAPER_DURATION, PAPER_IDLE_FRAME } from "./Paper";
import { VHS_BEATS, VHS_DURATION, VHS_IDLE_FRAME, vhsDateStamp } from "./Vhs";
import { BUMPER_IDEAS, bumperDuration, bumperOutName } from "./SessionBumper";
import { stripFrames } from "./Strip";
import { FADER_BEATS, FADER_CLEAR_FRAME, FADER_DURATION, FADER_IDLE_FRAME, LED_FRAMES, cameraScale, dotGrow, dotRing, faderLevel, tickerCol } from "./Fader";
import { FLAP_BEATS, FLAP_DURATION, FLAP_IDLE_FRAME, boardFront } from "./Flap";

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

describe("neon beats", () => {
  it("strikes the tubes in order, house to pillar, then the two lines of type", () => {
    const order = [...NEON_BEATS.tubes, NEON_BEATS.title, NEON_BEATS.name, NEON_BEATS.hold, NEON_BEATS.tilt, NEON_BEATS.tiltEnd, NEON_BEATS.clear];
    for (let i = 1; i < order.length; i++) expect(order[i]).toBeGreaterThan(order[i - 1]);
    expect(NEON_BEATS.tubes).toEqual([8, 18, 26, 34]);
    expect(NEON_BEATS.clear).toBeLessThanOrEqual(NEON_DURATION);
    expect(NEON_IDLE_FRAME).toBeGreaterThanOrEqual(NEON_BEATS.hold);
    expect(NEON_IDLE_FRAME).toBeLessThan(NEON_BEATS.tilt);
  });
  it("buzzes beam B for two frames every ~20 frames in the hold, never before", () => {
    for (let f = 0; f < 60; f++) expect(idleDropout(f)).toBe(false);
    const drops: number[] = [];
    for (let f = 60; f < 200; f++) if (idleDropout(f)) drops.push(f);
    expect(drops.length).toBeGreaterThanOrEqual(10);
    for (let i = 0; i < drops.length; i += 2) expect(drops[i + 1]).toBe(drops[i] + 1);
  });
});

describe("vhs beats", () => {
  it("cassette, insert, blue, picture, hold, roll, snow, lock, clear in order", () => {
    const order = [VHS_BEATS.cassette, VHS_BEATS.insert, VHS_BEATS.blue, VHS_BEATS.picture, VHS_BEATS.hold, VHS_BEATS.roll, VHS_BEATS.snow, VHS_BEATS.lock, VHS_BEATS.clear];
    for (let i = 1; i < order.length; i++) expect(order[i]).toBeGreaterThan(order[i - 1]);
    expect(VHS_BEATS.lock).toBe(100);
    expect(VHS_BEATS.clear).toBe(118);
    expect(VHS_BEATS.clear).toBeLessThanOrEqual(VHS_DURATION);
    expect(VHS_IDLE_FRAME).toBeGreaterThanOrEqual(VHS_BEATS.hold);
    expect(VHS_IDLE_FRAME).toBeLessThan(VHS_BEATS.roll);
  });
  it("drops out every ~15 frames while the picture is up", () => {
    for (const f of VHS_BEATS.dropouts) {
      expect(f).toBeGreaterThanOrEqual(VHS_BEATS.picture);
      expect(f).toBeLessThan(VHS_BEATS.lock);
    }
    expect(VHS_BEATS.dropouts.length).toBeGreaterThanOrEqual(3);
  });
  it("stamps the date like a VCR", () => {
    expect(vhsDateStamp(new Date(2026, 10, 3))).toBe("NOV 03 2026");
    expect(vhsDateStamp(new Date(2027, 0, 15))).toBe("JAN 15 2027");
  });
});

describe("fader beats", () => {
  it("clicks the four LEDs on the quarter marks of the throw, pillar at the end stop", () => {
    expect(FADER_BEATS.leds).toEqual([LED_FRAMES.house, LED_FRAMES.beamA, LED_FRAMES.beamB, LED_FRAMES.pillar]);
    expect(LED_FRAMES.pillar).toBe(FADER_BEATS.pushEnd);
    for (let i = 1; i < 4; i++) {
      const gap = FADER_BEATS.leds[i] - FADER_BEATS.leds[i - 1];
      expect(gap).toBeGreaterThanOrEqual(7);
      expect(gap).toBeLessThanOrEqual(9);
    }
    expect(faderLevel(FADER_BEATS.push)).toBe(0);
    expect(faderLevel(LED_FRAMES.house)).toBeGreaterThanOrEqual(0.25);
    expect(faderLevel(LED_FRAMES.house - 1)).toBeLessThan(0.25);
    expect(faderLevel(FADER_BEATS.pushEnd)).toBe(1);
  });
  it("hand, push, ticker, on air, name, hold, play, zoom, holes, grow, clear in order", () => {
    const b = FADER_BEATS;
    const order = [b.hand, b.push, b.pushEnd, b.ticker, b.onAir, b.name, b.hold, b.play, b.zoom, b.holes, b.grow, b.clear];
    for (let i = 1; i < order.length; i++) expect(order[i]).toBeGreaterThanOrEqual(order[i - 1]);
    expect(b.holes).toBe(84);
    expect(FADER_CLEAR_FRAME).toBeLessThanOrEqual(FADER_DURATION);
    expect(FADER_IDLE_FRAME).toBeGreaterThanOrEqual(b.hold);
    expect(FADER_IDLE_FRAME).toBeLessThan(b.play);
  });
  it("scrolls the ticker in from the right edge and parks it centred by f56", () => {
    expect(tickerCol(FADER_BEATS.ticker - 1)).toBe(96);
    expect(tickerCol(FADER_BEATS.ticker + 1)).toBeLessThan(96);
    expect(tickerCol(56)).toBe(10);
    expect(tickerCol(70)).toBe(10);
  });
  it("pushes to a zoom where a dot is 60-120 px wide, and the holes have merged before the clear", () => {
    expect(cameraScale(FADER_BEATS.play - 1)).toBeCloseTo(1, 5);
    const dotPx = 2 * FADER_BEATS.dotR * cameraScale(FADER_CLEAR_FRAME - 1);
    expect(dotPx).toBeGreaterThanOrEqual(60);
    expect(dotPx).toBeLessThanOrEqual(120);
    // Every ring that can be on screen at that zoom has grown past the
    // half-diagonal of the dot pitch, so no panel is left between dots.
    const merge = FADER_BEATS.dotPitch / Math.SQRT2;
    for (let ring = 0; ring <= 12; ring++) {
      expect(FADER_BEATS.dotR * dotGrow(ring, FADER_CLEAR_FRAME - 1)).toBeGreaterThan(merge);
    }
    expect(dotGrow(0, FADER_BEATS.grow - 1)).toBe(1);
    expect(dotRing(47, 20)).toBe(1);
    expect(dotRing(0, 0)).toBeGreaterThan(50);
  });
});

describe("flap beats", () => {
  it("mosaic, row 1, fix, hold, exit, clear in order", () => {
    const b = FLAP_BEATS;
    const order = [b.mosaic, b.row1, b.fix, b.hold, b.exit, b.clear];
    for (let i = 1; i < order.length; i++) expect(order[i]).toBeGreaterThanOrEqual(order[i - 1]);
    expect(b.exit).toBe(84);
    expect(b.clear).toBe(110);
    expect(b.clear).toBeLessThanOrEqual(FLAP_DURATION);
    expect(FLAP_IDLE_FRAME).toBeGreaterThanOrEqual(b.hold);
    expect(FLAP_IDLE_FRAME).toBeLessThan(b.exit);
  });
  it("sweeps the board's far corner before the clear", () => {
    expect(boardFront(FLAP_BEATS.exit - 1)).toBe(-Infinity);
    expect(boardFront(FLAP_BEATS.clear - 1)).toBeGreaterThan(1920 + 1080);
  });
});

describe("SessionBumper ideas", () => {
  it("knows all eight ideas, their durations and file names", () => {
    expect(BUMPER_IDEAS).toEqual(["door", "corner", "lamp", "paper", "neon", "vhs", "fader", "flap"]);
    expect(bumperDuration({ idea: "fader" })).toBe(FADER_DURATION);
    expect(bumperDuration({ idea: "flap" })).toBe(FLAP_DURATION);
    expect(bumperOutName({ idea: "flap", idle: true })).toBe("Bumper-flap-idle.webm");
    expect(bumperDuration({ idea: "neon" })).toBe(NEON_DURATION);
    expect(bumperDuration({ idea: "vhs" })).toBe(VHS_DURATION);
    expect(bumperOutName({ idea: "vhs", idle: true })).toBe("Bumper-vhs-idle.webm");
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
