import { describe, expect, it } from "bun:test";
import { hasAlpha, parseArgs } from "./render-bumper";

describe("parseArgs (bumper)", () => {
  it("reads the idea and the flags", () => {
    expect(parseArgs(["--idea", "corner", "--idle", "--strip"])).toEqual({
      idea: "corner",
      guest: null,
      idle: true,
      strip: true,
      matte: false,
    });
  });

  it("trims the guest and drops an empty one", () => {
    expect(parseArgs(["--idea", "door", "--guest", " Duncen "]).guest).toBe(
      "Duncen",
    );
    expect(parseArgs(["--idea", "door", "--guest", "  "]).guest).toBeNull();
  });
});

describe("hasAlpha", () => {
  it("accepts yuva420p from a libvpx probe", () => {
    expect(
      hasAlpha({ codec: "vp9", pixFmt: "yuva420p", alphaMode: false }),
    ).toBe(true);
  });

  it("accepts the alpha_mode tag when the probe cannot see the plane", () => {
    expect(
      hasAlpha({ codec: "vp9", pixFmt: "yuv420p", alphaMode: true }),
    ).toBe(true);
  });

  it("rejects a plain vp9", () => {
    expect(
      hasAlpha({ codec: "vp9", pixFmt: "yuv420p", alphaMode: false }),
    ).toBe(false);
  });
});
