/**
 * The Waterhouse logo reveal that bookends a finished session episode.
 *
 * The source video is already a finished edit — captions, watermark, lower-third and
 * ticker are burned in. Nothing about the picture is touched: no crop, no scale, no
 * grade, no cutting. The logo is not laid over the video; it is the window the video
 * arrives through. Black screen, the mark appears and catches a shine, then rushes at
 * the camera and the picture opens up inside its shape until it fills the frame. The
 * close is that in reverse.
 */

/**
 * Matches the usual source: 1920x1080 at 60fps.
 *
 * Also the design rate of the bookends: every frame number in OPEN and CLOSE is a
 * frame at 60fps. An episode cut from a capture at another rate (Boogie's is 25fps)
 * keeps its native rate, and the reveal converts with designToFrames rather than the
 * timings being duplicated per rate.
 */
export const FPS = 60;

/** A duration in OPEN/CLOSE design frames, as frames at `fps`. */
export const designToFrames = (designFrames: number, fps: number) =>
  Math.round((designFrames * fps) / FPS);
export const WIDTH = 1920;
export const HEIGHT = 1080;

/** The mark's height on screen at scale 1, before the rush. */
export const MARK_HEIGHT = HEIGHT * 0.3;

/**
 * How far the mark grows. The house — the tall solid piece on the left — has to
 * cover the full frame on its own by the end, since the bars have gaps between them.
 * At this height the house is ~169px wide at scale 1, so it needs about 11.4x to
 * span 1920. Overshooting well past that keeps the last moment clean.
 */
export const RUSH_SCALE = 20;

export const OPEN = {
  durationInFrames: 5 * FPS,
  /** Black holds before anything appears. */
  holdBlack: 30,
  /** The mark fades up. */
  appearFrom: 30,
  appearTo: 84,
  /** A highlight sweeps diagonally across it. */
  shineFrom: 84,
  shineTo: 156,
  /** It rushes at the camera; the picture opens inside its shape. */
  rushFrom: 150,
  /** The white fill dissolves so the video shows through the mark. */
  fillFadeFrom: 150,
  fillFadeTo: 190,
};

export const CLOSE = {
  durationInFrames: 5 * FPS,
  /** The picture closes back into the mark. */
  rushTo: 150,
  /**
   * The white fill returns *during* the last of the collapse, so the mark is already
   * solid by the time it lands. Letting it fill in afterwards leaves the picture
   * sitting visible inside a logo that has stopped moving, which reads as a mistake.
   */
  fillFadeFrom: 130,
  fillFadeTo: 155,
  shineFrom: 190,
  shineTo: 258,
  /** The mark fades out to black. */
  vanishFrom: 258,
  vanishTo: 300,
};

/** Black held after the picture ends, so the close has somewhere to land. */
export const TAIL_SECONDS = 1.5;
/** Audio eases in under the open and out under the close. */
export const AUDIO_FADE_SECONDS = 2;

/**
 * Karaoke captions, matching the look burned into the finished episodes: bold white
 * on one line, the live word in a solid blue box, upcoming words dimmed.
 *
 * Only needed for raw sources that arrive without captions — a finished export
 * already has them and must not get a second set.
 */
export const CAPTIONS = {
  fontSize: 52,
  fontWeight: 700,
  /** Vertical centre of the line, clear of the burned-in lower-third at ~y972. */
  centreY: 880,
  /** Widest a line may run before it breaks onto a new page. */
  maxWidth: 1560,
  activeBackground: "#2b9bf4",
  upcomingOpacity: 0.55,
  wordGap: 13,
  boxPaddingX: 11,
  boxPaddingY: 4,
  boxRadius: 6,
};
