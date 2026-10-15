/**
 * FORT RIDDIM promo reel — the whole edit, as data.
 *
 * Three phone clips shot on 15 Sep 2026, already vertical (the iPhone stores them
 * 1920x1080 with a -90 rotation; the prep transcode bakes that in):
 *
 *   c1  IMG_2250  the door + password gag, then the gallery walk
 *   c2  IMG_2253  up the purple stairs, into the pink room
 *   c3  IMG_2246  the same pink room, tattoo artist, back down, Dennis, Boogie
 *
 * Both halves of the pipeline read this file: Remotion builds the picture from it and
 * scripts/fort-riddim/make.ts builds the soundtrack from it, so the two can never
 * disagree about where a segment sits on the timeline.
 */

export const FPS = 30;
export const WIDTH = 1080;
export const HEIGHT = 1920;

export type ClipId = "c1" | "c2" | "c3";

export type Segment = {
  id: string;
  clip: ClipId;
  /** Source range, seconds. */
  from: number;
  to: number;
  /**
   * Average playback speed. 1 = real time with its own sound. Anything faster is eased
   * so it ramps up out of the cut and back down into the next one instead of lurching.
   */
  speed: number;
  /** How the segment's own sound is treated. Fast segments are always silent. */
  sound?: "voice" | "room" | "music";
  /**
   * The look. "rush" is the strong fisheye with sway and a kick on every beat, "live"
   * the mild one with a slow push. Defaults to rush for anything faster than real time;
   * walkIn overrides it so its ramp down into the tattoo room stays one unbroken shot.
   */
  style?: "live" | "rush";
  /** How this segment enters. */
  enter: "cut" | "whip" | "punch" | "door";
};

export const styleOf = (s: Segment) => s.style ?? (s.speed > 1 ? "rush" : "live");

/** Music: Boogie's set, measured off c3. */
export const BPM = 136;
export const BEAT = 60 / BPM;
export const BAR = BEAT * 4;
/** A downbeat in c3's source time, found by onset autocorrelation. */
export const C3_DOWNBEAT = 38.2;

export const SEGMENTS: Segment[] = [
  // c1 opens on the pavement and lifts to reveal the building and the doorman. The
  // gag starts at 3.3, but the walk up to him is the setup — Manuel asked for it back,
  // so this starts where the camera lifts rather than where the talking starts.
  { id: "door", clip: "c1", from: 1.0, to: 18.7, speed: 1, sound: "voice", enter: "cut" },
  { id: "gallery", clip: "c1", from: 18.7, to: 48.0, speed: 6, enter: "punch" },
  // Both c2 and c3 walk into the pink room, so for three cuts running the room was on
  // screen twice and no join between them could be made to read: a dissolve ghosted one
  // set of desks over the other, a cut read as stepping back out and walking in again.
  // Matching pan speed across the join helped and still did not fix it, because the
  // problem was never the join — it was the repeat.
  //
  // So c2 now stops in the warm corridor at 22.5, one beat before the pink doorway comes
  // into shot, and c3 does the whole arrival on its own. There is no cut at the tattoo
  // room any more: walkIn and tattoo are the same shot, cut from the same file, running
  // continuously across 3.95 — walkIn simply decelerates out of the walk (5x down to
  // 1.4x) and tattoo carries on at 1x. The only cut left is corridor -> pink room, two
  // pictures with nothing in common, and a whip covers it.
  //
  // walkIn is forced to the "live" look for the same reason: switching to the strong
  // fisheye would pop at 3.95, where there is no cut to hide it.
  //
  // 3.95 also clears the "Oh" he lets out at 3.62-3.84.
  { id: "stairsUp", clip: "c2", from: 2.0, to: 22.5, speed: 5, enter: "whip" },
  { id: "walkIn", clip: "c3", from: 1.0, to: 3.95, speed: 2.6, style: "live", enter: "whip" },
  { id: "tattoo", clip: "c3", from: 3.95, to: 12.5, speed: 1, sound: "voice", enter: "cut" },
  { id: "stairsDown", clip: "c3", from: 12.5, to: 25.5, speed: 5, enter: "whip" },
  { id: "dennis", clip: "c3", from: 25.5, to: 33.5, speed: 1, sound: "room", enter: "punch" },
  { id: "followDennis", clip: "c3", from: 33.5, to: 39.6, speed: 1.8, enter: "cut" },
  // Ends on a bar line so the end card lands on a downbeat.
  { id: "boogie", clip: "c3", from: 39.6, to: C3_DOWNBEAT + 5 * BAR, speed: 1, sound: "music", enter: "door" },
];

export const END_CARD_SECONDS = 5;

export type PlacedSegment = Segment & { start: number; frames: number };

export const segmentFrames = (s: Segment) => Math.round(((s.to - s.from) * FPS) / s.speed);

export const placeSegments = (): PlacedSegment[] => {
  let start = 0;
  return SEGMENTS.map((s) => {
    const frames = segmentFrames(s);
    const placed = { ...s, start, frames };
    start += frames;
    return placed;
  });
};

export const PLACED = placeSegments();
export const PICTURE_FRAMES = PLACED.reduce((n, s) => n + s.frames, 0);
export const TOTAL_FRAMES = PICTURE_FRAMES + Math.round(END_CARD_SECONDS * FPS);

/** Edge speed for the eased walking segments — slow enough that the cut reads. */
const EDGE_SPEED = 1.4;

/**
 * Source time for a frame inside a segment. Real-time segments map linearly. Fast ones
 * follow p(u) = u - a*sin(2πu)/2π, whose slope is 1 - a at the ends and 1 + a in the
 * middle: they leave the cut at about EDGE_SPEED and peak well above the average.
 */
export const sourceTime = (s: PlacedSegment, localFrame: number) => {
  if (s.speed <= 1) return s.from + localFrame / FPS;
  const u = Math.max(0, localFrame / s.frames);
  const a = Math.max(0, 1 - EDGE_SPEED / s.speed);
  const p = u - (a * Math.sin(2 * Math.PI * u)) / (2 * Math.PI);
  return s.from + (s.to - s.from) * p;
};

const byId = (id: string) => PLACED.find((s) => s.id === id)!;
/** Reel time of a source second inside a real-time segment. */
export const at = (id: string, src: number) => {
  const s = byId(id);
  return s.start / FPS + (src - s.from);
};

const boogie = byId("boogie");
/** Timeline second where Boogie's real audio begins. */
export const BOOGIE_T = boogie.start / FPS;
/** Timeline second where the end card begins. */
export const END_T = PICTURE_FRAMES / FPS;

/**
 * The beat grid on the reel timeline. The music bed is phase-locked to Boogie's real
 * audio, so beats are where c3's beats would fall if the set had played straight
 * through to the cut into his room.
 */
const srcBeats = (t: number) => (boogie.from + (t - BOOGIE_T) - C3_DOWNBEAT) / BEAT;

/**
 * Next beat at or after t. Within half a frame counts as "on" the beat, because
 * segment lengths are rounded to whole frames and the end card, which is meant to
 * start on a downbeat, lands a few ms after it.
 */
export const nextBeat = (t: number) => {
  const b = srcBeats(t);
  return t + (Math.ceil(b - 0.5 / FPS / BEAT) - b) * BEAT;
};

/** Seconds since the most recent beat. */
export const beatPhase = (t: number) => {
  const b = srcBeats(t);
  return (b - Math.floor(b)) * BEAT;
};

/* ---------- captions ---------- */

/**
 * Whole phrases, not karaoke words — a phrase timed to the voice reads as in sync even
 * where a single word's timing is off by a frame or two.
 *
 * Timings come from whisper's DTW token alignment (`--dtw large.v3.turbo -nfa`), checked
 * against a voice-activity map of each clip. The first pass used whisper's segment
 * offsets, which put the whole door exchange up to 3.5s early. Each phrase opens ~0.2s
 * before its first word, because a caption a touch early reads as sync and one late
 * reads as lag.
 *
 * Whisper hears "rhythm"; the joke is FORT RIDDIM, so it is spelled that way. Three of
 * its mishearings were corrected by Manuel, who was there: the doorman asks "when is the
 * event", confirms "that's the password" (not "portal"), and Dennis is asked "where is
 * it". Each answer already implied the correction.
 */
type Phrase = [start: number, end: number, text: string];

const PHRASES: Record<string, Phrase[]> = {
  door: [
    [3.3, 5.15, "Hey man, I'm looking for the riddim"],
    [5.15, 6.4, "What's the password?"],
    [6.4, 7.1, "The password?"],
    [7.1, 8.3, "You have a password?"],
    [9.0, 10.8, "What was the password?"],
    [11.1, 12.8, "It's something with the tens"],
    [13.1, 13.95, "When is the event?"],
    [13.95, 15.7, "Event is on 10 October and 10 o'clock"],
    // 15.7-16.5 "triple 10" is carried by the 10·10·10 slam.
    [16.45, 17.9, "Yep, that's the password. Come through"],
    [17.9, 18.65, "Thanks man"],
  ],
  tattoo: [
    [4.4, 6.75, "Hey man, I'm looking for the riddim"],
    [6.8, 7.5, "Riddim?"],
    [7.5, 8.3, "Yeah, riddim"],
    [8.3, 9.55, "Um…"],
    [9.65, 11.65, "There's some nice noise happening downstairs"],
    [11.65, 12.45, "Thanks man"],
  ],
  dennis: [
    [26.0, 28.35, "Guys, I'm looking for the riddim"],
    [28.35, 29.35, "Riddim?"],
    [29.35, 30.8, "You mean FORT RIDDIM?"],
    [30.8, 31.6, "Yes. FORT RIDDIM"],
    [31.6, 32.6, "Where is it?"],
    [32.6, 33.5, "Come with me"],
  ],
};

export type Caption = { t: number; end: number; text: string };

/** Captions on the reel timeline, clipped to their segment. */
export const CAPTIONS: Caption[] = PLACED.flatMap((s) =>
  (PHRASES[s.id] ?? []).map(([a, b, text]) => ({
    t: at(s.id, Math.max(a, s.from)),
    end: at(s.id, Math.min(b, s.to)),
    text,
  })),
);

/* ---------- overlays ---------- */

export type Slam = { t: number; d: number; kind: "tripleTen" };

/**
 * The RIDDIM disc used to slam over Dennis saying the name. It covered his face and
 * repeated what the end card already does with the same artwork, so it is gone.
 */
export const SLAMS: Slam[] = [
  { t: at("door", 15.7), d: at("door", 18.7) - at("door", 15.7), kind: "tripleTen" },
];
/** Name tag when the door opens on the booth. */
export const BOOGIE_TAG = { t: BOOGIE_T + 0.9, d: 3.4 };
