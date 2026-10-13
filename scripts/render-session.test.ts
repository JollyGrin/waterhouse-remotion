import { describe, expect, it } from "bun:test";
import { buildChatLines, failedPhotosIn, parseArgs } from "./render-session";
import { makeRng } from "../src/pullup/plan";
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

describe("parseArgs --guest", () => {
  it("no --guest leaves the guests to the booking", () => {
    expect(parseArgs(["--date", "2026-10-13"]).guests).toEqual([]);
  });

  it("one --guest is the one-guest clip, as before", () => {
    expect(parseArgs(["--guest", "Duncen"]).guests).toEqual(["Duncen"]);
  });

  it("repeated --guest keeps both, in order", () => {
    expect(
      parseArgs([
        "--guest",
        "Simon",
        "--date",
        "2026-10-13",
        "--guest",
        "Willem",
      ]).guests,
    ).toEqual(["Simon", "Willem"]);
  });
});

describe("buildChatLines", () => {
  it("your line cheers the joined guests", () => {
    const lines = buildChatLines("Simon & Willem", true, makeRng(1));
    expect(lines[0]).toEqual({ name: "you", text: "let's go Simon & Willem!" });
  });

  it("one guest reads as before", () => {
    const lines = buildChatLines("Duncen Haakmat", true, makeRng(1));
    expect(lines[0]).toEqual({ name: "you", text: "let's go Duncen Haakmat!" });
  });
});
