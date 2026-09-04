import { describe, expect, it } from "bun:test";
import {
  DEFAULT_FRAMING,
  PANEL_ASPECT,
  PLAYER_ASPECT,
  boxContains,
  frameFace,
  safeBox,
  visibleSourceBox,
  type Box,
} from "./framing";
import faces from "./fixtures/faces.json";

const denzo = faces.denzo;
const l4c4 = faces.l4c4;

// What the composition ends up showing, for a photo framed by frameFace.
const shown = (
  fixture: { imageWidth: number; imageHeight: number; face: Box },
  targetAspect: number,
) => {
  const framing = frameFace({
    imageWidth: fixture.imageWidth,
    imageHeight: fixture.imageHeight,
    face: fixture.face,
    targetAspect,
  });
  return {
    framing,
    visible: visibleSourceBox(
      framing,
      fixture.imageWidth,
      fixture.imageHeight,
      targetAspect,
    ),
  };
};

describe("frameFace", () => {
  it("keeps today's center-top crop when no face was detected", () => {
    expect(
      frameFace({
        imageWidth: 1200,
        imageHeight: 1600,
        face: null,
        targetAspect: PLAYER_ASPECT,
      }),
    ).toEqual(DEFAULT_FRAMING);
  });

  it("keeps center-top when the detector was not available", () => {
    // A zero-size image stands in for "we know nothing about this photo".
    expect(
      frameFace({
        imageWidth: 0,
        imageHeight: 0,
        face: null,
        targetAspect: PLAYER_ASPECT,
      }),
    ).toEqual(DEFAULT_FRAMING);
  });

  it("slides a cover crop onto a small face", () => {
    const { framing, visible } = shown(l4c4, PLAYER_ASPECT);
    expect(framing.fit).toBe("cover");
    // Center top would have shown 0..820 of a 1600px-tall photo, cutting
    // nothing here - but the crop should still sit on the face, lower down.
    expect(parseFloat(framing.position.split(" ")[1])).toBeGreaterThan(5);
    expect(boxContains(visible, l4c4.face)).toBe(true);
    expect(boxContains(visible, l4c4.eyes)).toBe(true);
    expect(boxContains(visible, l4c4.mouth)).toBe(true);
  });

  it("keeps the requested headroom above the face", () => {
    const { visible } = shown(l4c4, PLAYER_ASPECT);
    const headroom = l4c4.face.y - visible.y;
    expect(headroom).toBeGreaterThanOrEqual(l4c4.face.height * 0.15);
  });

  it("falls back to contain for a headshot that cannot fit", () => {
    const { framing, visible } = shown(denzo, PLAYER_ASPECT);
    expect(framing.fit).toBe("contain");
    // Nothing is cut, so the whole face - eyes and mouth included - shows.
    expect(boxContains(visible, denzo.face)).toBe(true);
    expect(boxContains(visible, denzo.eyes)).toBe(true);
    expect(boxContains(visible, denzo.mouth)).toBe(true);
  });

  it("cut Denzo's mouth off under the old center-top crop", () => {
    // The bug this exists to prevent: 16:9 cover anchored at the top left
    // the mouth outside the window entirely, and the eyes on its very edge
    // (the breathing zoom then pushed those out too).
    const old = visibleSourceBox(
      DEFAULT_FRAMING,
      denzo.imageWidth,
      denzo.imageHeight,
      PLAYER_ASPECT,
    );
    expect(boxContains(old, denzo.face)).toBe(false);
    expect(boxContains(old, denzo.mouth)).toBe(false);
    const eyeSlack = old.y + old.height - (denzo.eyes.y + denzo.eyes.height);
    expect(eyeSlack).toBeLessThan(denzo.face.height * 0.03);
  });

  it("frames the same headshot with cover in the narrower shared panel", () => {
    // Half the window is nearly as tall as it is wide, so the face fits.
    const { framing, visible } = shown(denzo, PANEL_ASPECT);
    expect(framing.fit).toBe("cover");
    expect(boxContains(visible, denzo.face)).toBe(true);
    expect(boxContains(visible, denzo.eyes)).toBe(true);
    expect(boxContains(visible, denzo.mouth)).toBe(true);
  });
});

describe("safeBox", () => {
  it("adds headroom, chin room and side margins", () => {
    const box = safeBox({ x: 100, y: 100, width: 100, height: 100 }, 500, 500);
    expect(box).toEqual({ x: 94, y: 85, width: 112, height: 125 });
  });

  it("never runs outside the image", () => {
    const box = safeBox({ x: 0, y: 0, width: 100, height: 100 }, 100, 100);
    expect(box).toEqual({ x: 0, y: 0, width: 100, height: 100 });
  });
});

describe("visibleSourceBox", () => {
  it("shows the whole image when contained", () => {
    expect(
      visibleSourceBox({ fit: "contain", position: "50% 50%" }, 400, 300, 2),
    ).toEqual({ x: 0, y: 0, width: 400, height: 300 });
  });

  it("crops to the target aspect when covered", () => {
    const box = visibleSourceBox(
      { fit: "cover", position: "50% 0%" },
      400,
      400,
      2,
    );
    expect(box).toEqual({ x: 0, y: 0, width: 400, height: 200 });
  });
});
