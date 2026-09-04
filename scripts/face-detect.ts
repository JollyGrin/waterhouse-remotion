#!/usr/bin/env bun
/**
 * Face detection for the PullUp preflight.
 *
 * The stream window is landscape and artist photos are mostly portrait, so
 * something has to decide where to hang the photo. That decision is pure
 * maths in src/pullup/framing.ts; this file supplies the one input it needs,
 * the face box, using BlazeFace + FaceMesh through @vladmandic/human.
 *
 * The three packages that takes (human, tfjs-node, sharp) are OPTIONAL
 * dependencies: tfjs-node ships prebuilt binaries only for some platforms,
 * and a render that cannot detect a face is still a good render - it just
 * falls back to the historic `center top` crop. So they are imported through
 * a computed specifier, which keeps `tsc` from demanding them, and every
 * failure here returns null rather than throwing.
 *
 * Regenerate the checked-in fixture with:
 *   bun scripts/face-detect.ts <image-url-or-path>
 */

import type { Box } from "../src/pullup/framing";

export interface Detection {
  imageWidth: number;
  imageHeight: number;
  /** null when there is nobody in the photo. */
  face: Box | null;
  score: number;
}

// Detect on a downscaled copy: BlazeFace works on a small square anyway, and
// a 4000px phone photo otherwise costs seconds per image.
const DETECT_MAX_EDGE = 768;

/** As much of `sharp().metadata()` as the orientation question needs. */
export interface ImageMeta {
  width?: number;
  height?: number;
  /** EXIF orientation, 1-8. 5-8 are the quarter turns. */
  orientation?: number;
  /** sharp >= 0.34 reports the auto-oriented size here. */
  autoOrient?: { width?: number; height?: number };
}

/**
 * The size the image presents once EXIF orientation is applied - what
 * `.rotate()` produces, what a browser shows, and the frame a face box has
 * to be expressed in.
 *
 * `metadata()` reports the size as STORED, even on a pipeline already told
 * to rotate. A phone photo shot sideways is stored 4000x3000 with
 * orientation 6 and presents as 3000x4000, so reading width/height straight
 * off the metadata squashes the detect resize and lands the crop nowhere
 * near the face.
 */
export function orientedSize(meta: ImageMeta): {
  width: number;
  height: number;
} {
  const auto = meta.autoOrient;
  if (auto?.width && auto?.height) {
    return { width: auto.width, height: auto.height };
  }
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  // 5-8 are the orientations that turn the image a quarter circle.
  return (meta.orientation ?? 1) >= 5
    ? { width: height, height: width }
    : { width, height };
}

// Hidden from tsc on purpose - see the header.
const optional = (name: string) => name;

type AnyModule = Record<string, unknown> & { default?: unknown };

async function tryImport(name: string): Promise<AnyModule | null> {
  try {
    return (await import(optional(name))) as AnyModule;
  } catch {
    return null;
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
let humanPromise: Promise<any | null> | null = null;
let sharpPromise: Promise<any | null> | null = null;

async function loadSharp(): Promise<any | null> {
  sharpPromise ??= (async () => {
    const mod = await tryImport("sharp");
    return mod ? ((mod.default ?? mod) as any) : null;
  })();
  return sharpPromise;
}

function modelBasePath(): string {
  // Follow the installed package rather than guessing at node_modules
  // layout, which hoisting moves around.
  try {
    const entry = (
      globalThis as unknown as {
        Bun?: { resolveSync: (id: string, from: string) => string };
      }
    ).Bun?.resolveSync("@vladmandic/human", process.cwd());
    if (entry) {
      // .../@vladmandic/human/dist/human.node.js -> .../human/models/
      return `file://${entry.replace(/dist\/[^/]+$/, "models/")}`;
    }
  } catch {
    // fall through
  }
  return `file://${process.cwd()}/node_modules/@vladmandic/human/models/`;
}

async function loadHuman(): Promise<any | null> {
  humanPromise ??= (async () => {
    const mod = await tryImport("@vladmandic/human");
    if (!mod) {
      console.log(
        "  (face detection unavailable - falling back to center-top crops)",
      );
      return null;
    }
    try {
      const HumanCtor = (mod.Human ?? (mod.default as any)?.Human) as any;
      const human = new HumanCtor({
        backend: "tensorflow",
        modelBasePath: modelBasePath(),
        // Only the face detector and the mesh that refines its box. Nothing
        // here needs age, emotion, gaze, gestures or body pose.
        face: {
          enabled: true,
          detector: { enabled: true, maxDetected: 5, rotation: false },
          mesh: { enabled: true },
          iris: { enabled: false },
          description: { enabled: false },
          emotion: { enabled: false },
          antispoof: { enabled: false },
          liveness: { enabled: false },
        },
        body: { enabled: false },
        hand: { enabled: false },
        object: { enabled: false },
        gesture: { enabled: false },
        segmentation: { enabled: false },
        filter: { enabled: false },
      });
      await human.load();
      return human;
    } catch (err) {
      console.log(`  (face detection failed to start: ${err})`);
      return null;
    }
  })();
  return humanPromise;
}

/**
 * The primary face in an image, in full-resolution source pixels.
 * Returns null when detection is unavailable or the image cannot be decoded;
 * a decoded image with nobody in it returns a Detection with `face: null`.
 */
export async function detectFace(bytes: Uint8Array): Promise<Detection | null> {
  const sharp = await loadSharp();
  const human = await loadHuman();
  if (!sharp || !human) return null;

  try {
    // .rotate() applies the EXIF orientation, which is what a browser shows.
    const source = sharp(bytes).rotate();
    const { width: imageWidth, height: imageHeight } = orientedSize(
      await source.metadata(),
    );
    if (!imageWidth || !imageHeight) return null;

    const scale = Math.min(
      1,
      DETECT_MAX_EDGE / Math.max(imageWidth, imageHeight),
    );
    const { data, info } = await source
      .resize({
        width: Math.max(1, Math.round(imageWidth * scale)),
        height: Math.max(1, Math.round(imageHeight * scale)),
        fit: "fill",
      })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const tensor = human.tf.tensor(
      new Int32Array(data),
      [1, info.height, info.width, info.channels],
      "int32",
    );
    let faces: any[];
    try {
      faces = (await human.detect(tensor)).face ?? [];
    } finally {
      tensor.dispose();
    }

    if (faces.length === 0) {
      return { imageWidth, imageHeight, face: null, score: 0 };
    }

    // The primary face is the biggest one - the artist, not the crowd.
    const best = faces.reduce((a, b) =>
      b.box[2] * b.box[3] > a.box[2] * a.box[3] ? b : a,
    );
    const back = 1 / (info.width / imageWidth);
    const [x, y, width, height] = best.box as number[];
    return {
      imageWidth,
      imageHeight,
      face: {
        x: Math.round(x * back),
        y: Math.round(y * back),
        width: Math.round(width * back),
        height: Math.round(height * back),
      },
      score: Math.round((best.score ?? best.faceScore ?? 0) * 100) / 100,
    };
  } catch (err) {
    console.log(`  (face detection failed: ${err})`);
    return null;
  }
}

/** Landmark boxes, for the checked-in fixture only. */
async function annotate(bytes: Uint8Array) {
  const sharp = await loadSharp();
  const human = await loadHuman();
  if (!sharp || !human) return null;
  const source = sharp(bytes).rotate();
  const meta = orientedSize(await source.metadata());
  const scale = Math.min(
    1,
    DETECT_MAX_EDGE / Math.max(meta.width, meta.height),
  );
  const { data, info } = await source
    .resize({
      width: Math.round(meta.width * scale),
      height: Math.round(meta.height * scale),
      fit: "fill",
    })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const tensor = human.tf.tensor(
    new Int32Array(data),
    [1, info.height, info.width, info.channels],
    "int32",
  );
  const faces = (await human.detect(tensor)).face ?? [];
  tensor.dispose();
  if (faces.length === 0) return null;
  const best = faces.reduce((a: any, b: any) =>
    b.box[2] * b.box[3] > a.box[2] * a.box[3] ? b : a,
  );
  const back = 1 / (info.width / meta.width);
  const bounds = (pts: number[][]): Box | null => {
    if (!pts.length) return null;
    const xs = pts.map((p) => p[0] * back);
    const ys = pts.map((p) => p[1] * back);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return {
      x: Math.round(x),
      y: Math.round(y),
      width: Math.round(Math.max(...xs) - x),
      height: Math.round(Math.max(...ys) - y),
    };
  };
  const ann = best.annotations ?? {};
  return {
    eyes: bounds([
      ...(ann.leftEyeUpper0 ?? []),
      ...(ann.leftEyeLower0 ?? []),
      ...(ann.rightEyeUpper0 ?? []),
      ...(ann.rightEyeLower0 ?? []),
    ]),
    mouth: bounds([
      ...(ann.lipsUpperOuter ?? []),
      ...(ann.lipsLowerOuter ?? []),
    ]),
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// CLI: print what the fixture records, for one image. `import.meta` is off
// limits under this tsconfig, so entry detection goes through argv.
async function main() {
  const target = process.argv[2];
  if (!target) {
    console.error("usage: bun scripts/face-detect.ts <image-url-or-path>");
    process.exit(1);
  }
  const bytes = /^https?:/.test(target)
    ? new Uint8Array(await (await fetch(target)).arrayBuffer())
    : new Uint8Array(await Bun.file(target).arrayBuffer());
  const detection = await detectFace(bytes);
  if (!detection) {
    console.error("no detection (is the optional detector installed?)");
    process.exit(1);
  }
  console.log(
    JSON.stringify(
      { url: target, ...detection, ...(await annotate(bytes)) },
      null,
      2,
    ),
  );
}

if (/face-detect\.ts$/.test(process.argv[1] ?? "")) {
  main().catch((err) => {
    console.error("Error:", err);
    process.exit(1);
  });
}
