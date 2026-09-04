import { describe, expect, it } from "bun:test";
import { orientedSize } from "./face-detect";
import {
  PLAYER_ASPECT,
  boxContains,
  frameFace,
  visibleSourceBox,
} from "../src/pullup/framing";
import faces from "../src/pullup/fixtures/faces.json";

const upright = faces.denzo;
const sideways = faces.denzoExif6;

describe("orientedSize", () => {
  it("prefers the size sharp already worked out", () => {
    expect(
      orientedSize({
        width: 1696,
        height: 1272,
        orientation: 6,
        autoOrient: { width: 1272, height: 1696 },
      }),
    ).toEqual({ width: 1272, height: 1696 });
  });

  it("swaps the axes for the quarter-turn orientations", () => {
    for (const orientation of [5, 6, 7, 8]) {
      expect(orientedSize({ width: 4000, height: 3000, orientation })).toEqual({
        width: 3000,
        height: 4000,
      });
    }
  });

  it("leaves the upright orientations alone", () => {
    for (const orientation of [undefined, 1, 2, 3, 4]) {
      expect(orientedSize({ width: 4000, height: 3000, orientation })).toEqual({
        width: 4000,
        height: 3000,
      });
    }
  });

  it("survives metadata with nothing in it", () => {
    expect(orientedSize({})).toEqual({ width: 0, height: 0 });
  });
});

describe("an EXIF-rotated photo", () => {
  it("presents at the auto-oriented size", () => {
    expect(
      orientedSize({
        width: sideways.storedWidth,
        height: sideways.storedHeight,
        orientation: sideways.orientation,
      }),
    ).toEqual({ width: sideways.imageWidth, height: sideways.imageHeight });
  });

  it("detects the same face as the upright copy", () => {
    // Same photo, same answer: the detector works in the presented frame.
    expect(sideways.face).toEqual(upright.face);
    expect(sideways.imageWidth).toBe(upright.imageWidth);
    expect(sideways.imageHeight).toBe(upright.imageHeight);
  });

  it("frames it the same way as the upright copy", () => {
    const framing = frameFace({
      imageWidth: sideways.imageWidth,
      imageHeight: sideways.imageHeight,
      face: sideways.face,
      targetAspect: PLAYER_ASPECT,
    });
    expect(framing).toEqual(
      frameFace({
        imageWidth: upright.imageWidth,
        imageHeight: upright.imageHeight,
        face: upright.face,
        targetAspect: PLAYER_ASPECT,
      }),
    );
    const visible = visibleSourceBox(
      framing,
      sideways.imageWidth,
      sideways.imageHeight,
      PLAYER_ASPECT,
    );
    expect(boxContains(visible, sideways.eyes)).toBe(true);
    expect(boxContains(visible, sideways.mouth)).toBe(true);
  });

  it("would have framed the stored size against the wrong box", () => {
    // The bug: reading width/height straight off metadata() describes a
    // 1696x1272 landscape image, and the portrait face box no longer fits
    // inside it at all - the crop lands nowhere near the face.
    const wrong = visibleSourceBox(
      frameFace({
        imageWidth: sideways.storedWidth,
        imageHeight: sideways.storedHeight,
        face: sideways.face,
        targetAspect: PLAYER_ASPECT,
      }),
      sideways.storedWidth,
      sideways.storedHeight,
      PLAYER_ASPECT,
    );
    expect(boxContains(wrong, sideways.face)).toBe(false);
  });
});
