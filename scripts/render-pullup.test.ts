import { describe, expect, it } from "bun:test";
import { failedPhotosIn } from "./render-pullup";
import { PHOTO_FAILED_MARKER } from "../src/PullUp";

// Copied verbatim from a real render of a clip using David Bucka's ra.co
// photo, which Cloudflare serves to Bun and refuses to Chromium.
const REAL_OUTPUT = `
Rendered 228/300, time remaining: 0s
[Tab 3, node_modules/remotion/dist/esm/index.mjs:5932] ${PHOTO_FAILED_MARKER} https://imgproxy.ra.co/_/quality:66/h:180/w:180/rt:fill/gravity:sm/aHR0cHM6
[Tab 5, node_modules/remotion/dist/esm/index.mjs:5932] ${PHOTO_FAILED_MARKER} https://imgproxy.ra.co/_/quality:66/h:180/w:180/rt:fill/gravity:sm/aHR0cHM6
Rendered 300/300
+                    out/PullUp-l4c4-2026-09-11.mp4 1.4 MB
`;

describe("failedPhotosIn", () => {
  it("picks the src out of Remotion's browser-console prefix", () => {
    expect(failedPhotosIn(REAL_OUTPUT)).toEqual([
      "https://imgproxy.ra.co/_/quality:66/h:180/w:180/rt:fill/gravity:sm/aHR0cHM6",
    ]);
  });

  it("reports each failing photo once, however many tabs hit it", () => {
    expect(failedPhotosIn(REAL_OUTPUT)).toHaveLength(1);
  });

  it("lists several distinct photos", () => {
    const output = [
      `${PHOTO_FAILED_MARKER} https://a.example/one.jpg`,
      `${PHOTO_FAILED_MARKER} https://b.example/two.png`,
    ].join("\n");
    expect(failedPhotosIn(output)).toEqual([
      "https://a.example/one.jpg",
      "https://b.example/two.png",
    ]);
  });

  it("is empty for a clean render", () => {
    expect(failedPhotosIn("Rendered 300/300\nEncoded 300/300\n")).toEqual([]);
  });
});
