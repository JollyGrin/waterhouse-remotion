// FORT RIDDIM promo reel: prep the footage, build the soundtrack, render, mux.
//
//   bun scripts/fort-riddim/make.ts            everything
//   bun scripts/fort-riddim/make.ts --audio    stop after the soundtrack (for Studio)
//   bun scripts/fort-riddim/make.ts --no-prep  skip the transcodes
//
// The edit itself lives in src/fort-riddim/edit.ts. Picture comes out of Remotion
// muted and the soundtrack is muxed on here with ffmpeg, which writes a proper edit
// list for the AAC priming — the 42.7ms offset Remotion's own mux leaves (see
// make-reel.ts) never arises.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  BAR,
  BEAT,
  BOOGIE_T,
  C3_DOWNBEAT,
  END_T,
  FPS,
  PLACED,
  SLAMS,
  TOTAL_FRAMES,
  nextBeat,
} from "../../src/fort-riddim/edit";

const SOURCES = {
  c1: "/Users/manuel/Desktop/IMG_2250.MOV",
  c2: "/Users/manuel/Desktop/IMG_2253.MOV",
  c3: "/Users/manuel/Desktop/IMG_2246.MOV",
} as const;

const PUB = "public/fort-riddim";
const WORK = "work/fort-riddim";
const OUT = "out/reels/FORT RIDDIM - 10.10.10.mp4";
const SR = 48000;
const T = TOTAL_FRAMES / FPS;

const args = new Set(process.argv.slice(2));

const run = (cmd: string, argv: string[], capture = false) =>
  new Promise<string>((resolve, reject) => {
    const p = spawn(cmd, argv, { stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit" });
    let out = "";
    p.stdout?.on("data", (d) => (out += d));
    p.stderr?.on("data", (d) => (out += d));
    p.on("close", (code) =>
      code === 0 ? resolve(out) : reject(new Error(`${cmd} exited ${code}\n${out.slice(-2000)}`)),
    );
  });

/**
 * The walking look: a stereographic reprojection (a real fisheye bulge, unlike
 * lenscorrection which pulls the corners in to black) filled edge to edge, with a
 * vignette and a push on colour. Baked here rather than in the browser because a
 * displacement filter per frame in Chrome is slow and fragile.
 */
const FISHEYE = [
  "v360=input=flat:ih_fov=64:iv_fov=100:output=sg:h_fov=58:v_fov=92:w=1080:h=1920:interp=cubic",
  "scale=1166:2074",
  "crop=1080:1920",
  "vignette=PI/4.5",
  "eq=saturation=1.25:contrast=1.08",
].join(",");

/**
 * The real-time look. The first version barely bulged and drew a pair of bowed lines
 * down the sides of every shot: at 50 degrees out of a declared 54 the projection wants
 * samples from beyond the edge of the frame, and v360 answers by smearing the last
 * column, which leaves a visible seam tracing the curve. Widening the output to 76
 * degrees gives a bulge worth having, and the overscan crop throws the seam away — 1.14
 * is the tightest crop with no smear left anywhere, measured with alpha_mask=1.
 *
 * Then the edges are darkened and softened, which is what sells it as a lens rather than
 * a warp: EDGE_MASK ramps from centre-sharp to fully blurred past the frame edge, and
 * the vignette is three stops of falloff rather than one.
 */
const FISHEYE_MILD = [
  "v360=input=flat:ih_fov=82:iv_fov=114.4:output=sg:h_fov=76:v_fov=108.5:w=1080:h=1920:interp=lanczos",
  "scale=1232:-2",
  "crop=1080:1920",
].join(",");

/**
 * Radial falloff for the mild look's edge blur, black in the middle and white past the
 * frame edge. One still frame, built once; maskedmerge then costs nothing per frame,
 * where a per-pixel blend expression would cost minutes. In gbrp so that all three
 * planes carry the gradient — through yuv the chroma planes would flatten to 128 and
 * half-blend the colour across the whole picture.
 */
const EDGE_MASK = join(WORK, "edge-mask.png");
const EDGE_MASK_EXPR = "255*clip((hypot((X-540)/540,(Y-960)/960)-0.55)/0.60,0,1)";
const MILD_GRAPH =
  `[0:v]${FISHEYE_MILD},format=gbrp,split[sharp][soft];` +
  "[soft]gblur=sigma=16[blurred];" +
  "[1:v]format=gbrp[mask];" +
  "[sharp][blurred][mask]maskedmerge,format=yuv420p,vignette=PI/4[v]";

async function prep() {
  mkdirSync(PUB, { recursive: true });
  mkdirSync(WORK, { recursive: true });
  if (!existsSync(EDGE_MASK)) {
    await run("ffmpeg", [
      "-y", "-v", "error", "-f", "lavfi", "-i", "color=black:s=1080x1920",
      "-vf", `format=gray,geq=lum='${EDGE_MASK_EXPR}'`, "-frames:v", "1", EDGE_MASK,
    ]);
  }
  const jobs: Promise<string>[] = [];
  for (const [id, src] of Object.entries(SOURCES)) {
    const clean = join(PUB, `${id}.mp4`);
    const fx = join(PUB, `${id}fx.mp4`);
    const mild = join(PUB, `${id}m.mp4`);
    const wav = join(PUB, `${id}-raw.wav`);
    // -g 15: short GOPs, because the speed ramps seek all over the file.
    const x264 = ["-c:v", "libx264", "-preset", "fast", "-crf", "17", "-g", "15", "-pix_fmt", "yuv420p", "-r", String(FPS), "-an"];
    if (!existsSync(clean)) jobs.push(run("ffmpeg", ["-y", "-v", "error", "-i", src, ...x264, clean]));
    if (!existsSync(fx)) jobs.push(run("ffmpeg", ["-y", "-v", "error", "-i", src, "-vf", FISHEYE, ...x264, fx]));
    // The mask is a single frame; maskedmerge's framesync repeats it, so the video
    // drives the length.
    if (!existsSync(mild))
      jobs.push(
        run("ffmpeg", [
          "-y", "-v", "error", "-i", src, "-i", EDGE_MASK,
          "-filter_complex", MILD_GRAPH, "-map", "[v]", ...x264, mild,
        ]),
      );
    if (!existsSync(wav)) jobs.push(run("ffmpeg", ["-y", "-v", "error", "-i", src, "-map", "0:a:0", "-ar", String(SR), wav]));
  }
  if (jobs.length) console.log(`Preparing ${jobs.length} source files...`);
  await Promise.all(jobs);
}

/* ---------- soundtrack ---------- */

/** Piecewise-linear gain as an ffmpeg expression in t. Holds the end values outside. */
const envelope = (pts: [number, number][]) => {
  let expr = String(pts[pts.length - 1][1]);
  for (let i = pts.length - 2; i >= 0; i--) {
    const [t0, v0] = pts[i];
    const [t1, v1] = pts[i + 1];
    const seg = t1 > t0 ? `${v0}+(${v1 - v0})*(t-${t0.toFixed(3)})/${(t1 - t0).toFixed(3)}` : String(v1);
    expr = `if(lt(t,${t1.toFixed(3)}),${seg},${expr})`;
  }
  return `if(lt(t,${pts[0][0].toFixed(3)}),${pts[0][1]},${expr})`;
};

const seg = (id: string) => PLACED.find((s) => s.id === id)!;
const tStart = (id: string) => seg(id).start / FPS;
const tEnd = (id: string) => (seg(id).start + seg(id).frames) / FPS;

/**
 * Voice clean-up for phone audio in a quiet corridor: rumble out, adaptive broadband
 * denoise, a little mud out and presence in, then a compressor to even out the
 * distance to the phone. Gentle on purpose — heavier denoise turns voices watery.
 */
const VOICE =
  "highpass=f=90,afftdn=nr=14:nf=-44:tn=1," +
  "equalizer=f=250:t=q:w=1:g=-3,equalizer=f=3200:t=q:w=1.2:g=3.5,equalizer=f=11000:t=q:w=1:g=-2," +
  "acompressor=threshold=-26dB:ratio=3:attack=8:release=140:makeup=6dB";
/** Near the booth the music is in the recording too; no denoise, it would eat the set. */
const ROOM =
  "highpass=f=70,equalizer=f=3200:t=q:w=1.2:g=3," +
  "acompressor=threshold=-22dB:ratio=2.5:attack=10:release=160:makeup=3dB";

async function soundtrack() {
  mkdirSync(WORK, { recursive: true });
  const inputs: string[] = [];
  const input = (...a: string[]) => {
    inputs.push(...a);
    return inputs.filter((x) => x === "-i").length - 1;
  };
  const c1 = input("-i", join(PUB, "c1-raw.wav"));
  const c3 = input("-i", join(PUB, "c3-raw.wav"));
  const src = { c1, c3 } as Record<string, number>;

  const graph: string[] = [];
  const mix: string[] = [];
  const delay = (t: number) => `adelay=${Math.round(t * 1000)}:all=1`;

  // Real-time dialogue, each on its own clock.
  for (const s of PLACED.filter((p) => p.speed === 1 && p.sound && p.sound !== "music")) {
    const dur = s.frames / FPS;
    // Level each piece on its own: the tattoo room was recorded ~8dB quieter than the door.
    const chain = `${s.sound === "voice" ? VOICE : ROOM},loudnorm=I=-16:TP=-2:LRA=7,aresample=48000`;
    graph.push(
      `[${src[s.clip]}:a]atrim=${s.from}:${(s.from + dur).toFixed(4)},asetpts=N/SR/TB,${chain},` +
        `afade=t=in:d=0.02,afade=t=out:st=${(dur - 0.03).toFixed(3)}:d=0.03,${delay(s.start / FPS)}[v_${s.id}]`,
    );
    mix.push(`[v_${s.id}]`);
  }

  // Boogie's room, and on through the end card: the real set, in sync with picture.
  const b = seg("boogie");
  const realDur = T - BOOGIE_T;
  graph.push(
    `[${c3}:a]atrim=${b.from}:${(b.from + realDur).toFixed(4)},asetpts=N/SR/TB,highpass=f=30,` +
      `afade=t=in:d=0.12,afade=t=out:st=${(realDur - 1.2).toFixed(3)}:d=1.2,${delay(BOOGIE_T)}[real]`,
  );
  mix.push("[real]");

  /**
   * The bed: four bars of the set looped from the start of the reel, phase-locked so
   * that where it hands over to the real audio at the door, the two are the same beat.
   * Three filterings of it crossfade by position — through the walls at the entrance,
   * clearer upstairs, open just before the door — so walking into the party is heard
   * as well as seen.
   */
  const loopStart = C3_DOWNBEAT + 4 * BAR;
  const L = 4 * BAR;
  const srcAt0 = b.from - BOOGIE_T;
  const offset = (((srcAt0 - loopStart) % L) + L) % L;
  const bedDur = BOOGIE_T + 0.5;
  const loops = Math.ceil((bedDur + offset) / L) + 1;
  graph.push(
    `[${c3}:a]atrim=${loopStart.toFixed(4)}:${(loopStart + L).toFixed(4)},asetpts=N/SR/TB,` +
      `aloop=loop=${loops}:size=${Math.round(L * SR)},atrim=${offset.toFixed(4)}:${(offset + bedDur).toFixed(4)},` +
      `asetpts=N/SR/TB,asplit=3[bedA][bedB][bedC]`,
  );
  const muffled = envelope([
    [0, 0], [0.6, 0.45], [tStart("gallery") - 0.2, 0.45], [tStart("gallery") + 0.3, 0.75],
    [tStart("stairsUp") + 1, 0.75], [tEnd("stairsUp") - 0.6, 0],
  ]);
  const mid = envelope([
    [tStart("stairsUp"), 0], [tEnd("stairsUp") - 0.6, 0.9], [tStart("tattoo") + 0.8, 0.28],
    [tEnd("tattoo") - 0.2, 0.28], [tStart("stairsDown") + 0.2, 0.75], [tEnd("stairsDown") - 0.1, 0.75],
    [tStart("dennis") + 0.3, 0.22], [tEnd("dennis") - 0.2, 0.22], [tStart("followDennis") + 0.3, 0.55],
    [BOOGIE_T - 1.5, 0],
  ]);
  const full = envelope([
    [BOOGIE_T - 2.5, 0], [BOOGIE_T - 0.05, 0.75], [BOOGIE_T + 0.25, 0],
  ]);
  graph.push(`[bedA]lowpass=f=320,lowpass=f=320,volume='${muffled}':eval=frame[bed1]`);
  graph.push(`[bedB]lowpass=f=1300,volume='${mid}':eval=frame[bed2]`);
  graph.push(`[bedC]volume='${full}':eval=frame[bed3]`);
  mix.push("[bed1]", "[bed2]", "[bed3]");

  // Whooshes into each moving cut, peaking on the cut.
  const cuts = PLACED.filter((s) => s.enter === "whip" || s.enter === "door" || s.enter === "punch");
  cuts.forEach((s, i) => {
    const peak = 0.3;
    const t = s.start / FPS - peak;
    graph.push(
      `anoisesrc=color=pink:r=${SR}:d=0.6:a=0.9:seed=${i + 1},bandpass=f=${s.enter === "door" ? 900 : 1800}:w=1.6,` +
        `volume='if(lt(t,${peak}),pow(t/${peak},2),exp(-(t-${peak})*18))':eval=frame,` +
        `volume=${s.enter === "punch" ? 0.35 : 0.55},aformat=channel_layouts=stereo,${delay(t)}[wh${i}]`,
    );
    mix.push(`[wh${i}]`);
  });

  // Sub hits under each title slam and the end card's first and third beats.
  const endBeat0 = nextBeat(END_T);
  const hits = [...SLAMS.map((s) => s.t), endBeat0, endBeat0 + 2 * BEAT];
  hits.forEach((t, i) => {
    graph.push(
      `aevalsrc='0.8*sin(2*PI*(42+110*exp(-t*22))*t)*exp(-t*3.5)':s=${SR}:d=1.2,` +
        `aformat=channel_layouts=stereo,${delay(t)}[hit${i}]`,
    );
    mix.push(`[hit${i}]`);
  });

  graph.push(
    `${mix.join("")}amix=inputs=${mix.length}:normalize=0:dropout_transition=0,` +
      `apad,atrim=0:${T.toFixed(4)},alimiter=limit=0.9:attack=3:release=60[mix]`,
  );

  const premaster = join(WORK, "premaster.wav");
  await run("ffmpeg", [
    "-y", "-v", "error", ...inputs,
    "-filter_complex", graph.join(";\n"),
    "-map", "[mix]", "-ar", String(SR), "-c:a", "pcm_s24le", premaster,
  ]);

  // Two-pass loudness to Instagram's -14 LUFS.
  const probe = await run("ffmpeg", [
    "-hide_banner", "-i", premaster, "-af", "loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json", "-f", "null", "-",
  ], true);
  const m = JSON.parse(probe.slice(probe.lastIndexOf("{"), probe.lastIndexOf("}") + 1));
  const soundtrackWav = join(PUB, "soundtrack.wav");
  await run("ffmpeg", [
    "-y", "-v", "error", "-i", premaster,
    "-af",
    `loudnorm=I=-14:TP=-1.5:LRA=11:measured_I=${m.input_i}:measured_TP=${m.input_tp}:` +
      `measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`,
    "-ar", String(SR), "-c:a", "pcm_s16le", soundtrackWav,
  ]);
  console.log(`Soundtrack: ${soundtrackWav} (input ${m.input_i} LUFS -> -14)`);
  return soundtrackWav;
}

async function main() {
  if (!args.has("--no-prep")) await prep();
  const wav = await soundtrack();
  if (args.has("--audio")) return;

  mkdirSync("out/reels", { recursive: true });
  const picture = join(WORK, "picture.mp4");
  console.log(`Rendering picture (${(T).toFixed(1)}s)...`);
  await run("npx", [
    "remotion", "render", "FortRiddim", picture,
    "--codec", "h264", "--crf", "18", "--concurrency", "4", "--muted",
  ]);
  await run("ffmpeg", [
    "-y", "-v", "error", "-i", picture, "-i", wav,
    "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "320k",
    "-movflags", "+faststart", OUT,
  ]);
  console.log(`Done: ${OUT}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
