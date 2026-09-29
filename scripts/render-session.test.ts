import { describe, expect, it } from "bun:test";
import { failedPhotosIn } from "./render-session";
import { SESSION_PHOTO_FAILED_MARKER } from "../src/WaterhouseSession";
import { PHOTO_FAILED_MARKER } from "../src/PullUp";

describe("failedPhotosIn (session)", () => {
  it("picks the src out of Remotion's browser-console prefix, once", () => {
    const output = `
[Tab 3, node_modules/remotion/dist/esm/index.mjs:5932] ${SESSION_PHOTO_FAILED_MARKER} https://cdn.example/denzo.jpg
[Tab 5, node_modules/remotion/dist/esm/index.mjs:5932] ${SESSION_PHOTO_FAILED_MARKER} https://cdn.example/denzo.jpg
Rendered 300/300
`;
    expect(failedPhotosIn(output)).toEqual(["https://cdn.example/denzo.jpg"]);
  });

  it("does not pick up PullUp's marker", () => {
    expect(
      failedPhotosIn(`${PHOTO_FAILED_MARKER} https://cdn.example/x.jpg`),
    ).toEqual([]);
  });

  it("is empty for a clean render", () => {
    expect(failedPhotosIn("Rendered 300/300\nEncoded 300/300\n")).toEqual([]);
  });
});
