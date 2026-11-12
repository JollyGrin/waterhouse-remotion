import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";

// Rendered output (videos, stills, frame strips, PR evidence) can always be
// rebuilt, so it never goes in git (#38). This guard keeps it from creeping
// back into the folders where it used to live.

const WATCHED = ["docs/", "out/", "longform/docs/"];
const MEDIA = /\.(mp4|mov|webm|png|jpe?g|gif)$/i;

function trackedRenders(files: string[]): string[] {
  return files.filter((f) => WATCHED.some((dir) => f.startsWith(dir)) && MEDIA.test(f));
}

describe("no rendered output in git", () => {
  it("flags media under the watched folders only", () => {
    expect(
      trackedRenders([
        "docs/bumper-door-frames.png",
        "out/Recap.MP4",
        "longform/docs/evidence/a.jpg",
        "longform/docs/quality-and-upscaling.md",
        "public/audio/bumper/hit.wav",
        "src/docs/logo.png",
      ]),
    ).toEqual(["docs/bumper-door-frames.png", "out/Recap.MP4", "longform/docs/evidence/a.jpg"]);
  });

  it("finds none tracked in this repo", () => {
    // `:/` pathspecs are relative to the repo root, wherever the test runs from.
    const pathspecs = WATCHED.map((dir) => `:/${dir}`);
    const git = spawnSync("git", ["ls-files", "-z", "--full-name", "--", ...pathspecs], {
      encoding: "utf8",
    });
    if (git.status !== 0) return; // not a git checkout (e.g. a tarball): nothing to guard
    const found = trackedRenders(git.stdout.split("\0").filter(Boolean));
    // If this fails: `git rm --cached <file>` and give the command that renders it instead.
    expect(found).toEqual([]);
  });
});
