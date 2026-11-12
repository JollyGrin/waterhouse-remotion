import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { IDENT_COMP_IDS } from "../src/ident/ids";
import { INTRO_COMP, INTRO_DIR, encodeCommands, sidecar } from "./render-intro";

describe("render:intro", () => {
  it("renders the 16:9 Fuse comp into the sesh-edit asset folder", () => {
    expect(IDENT_COMP_IDS).toContain(INTRO_COMP);
    expect(INTRO_DIR).toBe(join("longform", "src", "sesh_edit", "assets", "intro"));
    // intro.py reads this exact name by default
    const py = readFileSync(join("longform", "src", "sesh_edit", "intro.py"), "utf8");
    expect(py).toContain('DEFAULT_FILE = "fuse-16x9.webm"');
  });

  it("keeps open_s on frame 118, not the auto-detected 120", () => {
    expect(sidecar().open_s).toBe(3.933333);
  });

  it("encodes VP9 alpha with no colour flags, and a 16-bit 48 kHz flac", () => {
    const { webm, flac } = encodeCommands("ffmpeg", "in.mov", "dir");
    expect(webm).toEqual(expect.arrayContaining(["-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-an"]));
    expect(webm.some((a) => /^-(colorspace|color_primaries|color_trc|color_range)$/.test(a))).toBe(false);
    expect(webm[webm.length - 1]).toBe(join("dir", "fuse-16x9.webm"));
    expect(flac).toEqual(expect.arrayContaining(["-vn", "-c:a", "flac", "-sample_fmt", "s16", "-ar", "48000"]));
    expect(flac[flac.length - 1]).toBe(join("dir", "fuse-16x9.flac"));
  });
});
