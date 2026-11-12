import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";
import { IDENT_COMP_IDS, IDENT_IDEAS, SESSIONS_INTRO } from "../src/ident/ids";
import { OUTPUTS, parseArgs, renderCommand, resolveId } from "./render-ident";

describe("ident catalogue", () => {
  it("lists Fuse first: it is the Sessions intro", () => {
    expect(IDENT_IDEAS[0].idea).toBe("Fuse");
    expect(SESSIONS_INTRO.map((i) => i.idea)).toEqual([
      "Fuse",
      "FuseLines-Ink",
      "FuseLines-Wave",
      "FuseLines-Draft",
    ]);
  });

  it("has unique, Ident-prefixed composition ids", () => {
    expect(new Set(IDENT_COMP_IDS).size).toBe(IDENT_COMP_IDS.length);
    for (const id of IDENT_COMP_IDS) expect(id).toMatch(/^Ident[A-Za-z]+(-[A-Za-z0-9]+)*$/);
    expect(IDENT_COMP_IDS).toContain("IdentFuse-16x9");
  });
});

describe("parseArgs (ident)", () => {
  it("takes ids with or without the prefix, all outputs by default", () => {
    expect(parseArgs(["Fuse-16x9", "IdentFuse"])).toEqual({
      ids: ["IdentFuse-16x9", "IdentFuse"],
      only: OUTPUTS,
    });
  });

  it("expands --intro to both cuts of every Sessions-intro ident", () => {
    const { ids } = parseArgs(["--intro"]);
    expect(ids).toHaveLength(8);
    expect(ids[0]).toBe("IdentFuse");
    expect(ids).toContain("IdentFuseLines-Draft-16x9");
  });

  it("dedupes and filters outputs with --only", () => {
    expect(parseArgs(["Fuse", "--intro", "--only", "prores,webm"])).toEqual({
      ids: parseArgs(["--intro"]).ids,
      only: ["prores", "webm"],
    });
  });

  it("rejects unknown ids", () => {
    expect(resolveId("Nope")).toBeNull();
    expect(resolveId("FuseLines-Ink-16x9")).toBe("IdentFuseLines-Ink-16x9");
  });
});

describe("renderCommand", () => {
  it("renders the preview comp to H.264", () => {
    const { cmd, file } = renderCommand("IdentFuse", "preview");
    expect(file).toBe(join("out", "ident", "IdentFuse-preview.mp4"));
    expect(cmd).toContain("IdentFuse-preview");
    expect(cmd).toContain("--codec=h264");
  });

  it("renders alpha ProRes 4444 and VP9 with PNG frames", () => {
    const prores = renderCommand("IdentFuse-16x9", "prores");
    expect(prores.file).toBe(join("out", "ident", "IdentFuse-16x9.mov"));
    expect(prores.cmd).toEqual(
      expect.arrayContaining(["IdentFuse-16x9", "--codec=prores", "--prores-profile=4444", "--pixel-format=yuva444p10le", "--image-format=png"]),
    );
    const webm = renderCommand("IdentFuse-16x9", "webm");
    expect(webm.file).toBe(join("out", "ident", "IdentFuse-16x9.webm"));
    expect(webm.cmd).toEqual(expect.arrayContaining(["--codec=vp9", "--pixel-format=yuva420p", "--image-format=png"]));
  });
});

// The repo is public: public/ident/ must hold exactly what the ident code uses.
describe("public/ident assets", () => {
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const p = join(dir, n);
      return statSync(p).isDirectory() ? files(p) : [p];
    });
  const code = files(join("src", "ident"))
    .filter((f) => /\.tsx?$/.test(f))
    .map((f) => readFileSync(f, "utf8"))
    .join("\n");
  const referenced = new Set(code.match(/ident\/[A-Za-z0-9_./-]+\.(wav|png|jpg)/g) ?? []);
  // Paths built at runtime: Idents.tsx's FuseLines pressings (mix-${semitones}.wav)
  // and Louvre's three fin cascades (cascade${j + 1}.wav).
  for (const s of [4, 7, 12]) referenced.add(`ident/audio/fuselines/mix-${s}.wav`);
  for (const j of [1, 2, 3]) referenced.add(`ident/audio/louvre/cascade${j}.wav`);

  it("has every file the idents reference", () => {
    for (const r of referenced) expect(statSync(join("public", r)).isFile()).toBe(true);
  });

  it("has nothing the idents don't reference", () => {
    const onDisk = files(join("public", "ident")).map((f) => relative("public", f).split("\\").join("/"));
    expect(onDisk.filter((f) => !referenced.has(f))).toEqual([]);
  });
});
