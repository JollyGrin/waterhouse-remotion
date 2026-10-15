// Pure edit-decision logic: what to cut, and where the survivors land afterwards.
//
// No media or filesystem access, so it is cheap to iterate on and easy to test.
// build-edl.ts wraps this with the I/O.
//
// Everything here was learned the hard way on the TaylorTaylor session; the comments
// on each rule say what goes wrong without it.

export type Word = { start: number; end: number; text: string };
export type Range = { start: number; end: number };

export type CaptionWord = {
  /** Output time in seconds, on the cut timeline. */
  t: number;
  d: number;
  w: string;
  /** A caption page breaks before this word. */
  br: boolean;
};

export type Edl = {
  keepRanges: Range[];
  sourceDuration: number;
  outputDuration: number;
  removedSeconds: number;
  cutCount: number;
  /** Frame rate of the master, and of the episode rendered from it. */
  fps: number;
};

/**
 * The master is encoded at the source's rate; the frame model below assumes it.
 * Most captures are 60fps; set SESSION_FPS for one that isn't (Boogie's is 25). It has
 * to divide 48000 so each video frame owns a whole number of audio samples.
 */
export const FPS = Number(process.env.SESSION_FPS ?? 60);
if (!Number.isInteger(48000 / FPS)) throw new Error(`SESSION_FPS ${FPS} does not divide 48000`);

/**
 * Keep ranges per ffmpeg invocation in make-master.ts. Shared because the encoder
 * seeks to the first range of each batch, which rebases ffmpeg's filter clock — the
 * frame model has to rebase identically to stay exact. One expression covering every
 * range overflows ffmpeg's parser ("Cannot allocate memory" initialising filters),
 * which is why the batching exists at all.
 */
export const CHUNK_SIZE = 25;

export const DEFAULTS = {
  /** Gaps longer than this are trimmed... */
  maxGap: 0.6,
  /** ...down to this, so speech still breathes. */
  keptGap: 0.35,
  /** Room left around a removed filler. Clamped to the neighbours — see findRemovals. */
  fillerPad: 0.04,
  /** Keep islands shorter than this holding no speech are dropped as debris. */
  minIsland: 0.08,
  /** A caption page breaks when speech pauses at least this long. */
  pageBreakGap: 0.45,
};

/**
 * Standalone hesitation sounds. Deliberately narrow: `like`, `you know`, `I mean`
 * and `so` all carry meaning in conversation, and cutting them is the classic
 * over-edit that leaves people sounding clipped.
 */
const FILLERS = new Set([
  "um", "umm", "uhm", "uh", "uhh", "erm", "er", "err",
  "ah", "ahh", "eh", "hmm", "hm", "mmm", "mm", "uhhuh",
]);

/** Whisper's annotations for non-speech. */
const NON_SPEECH = /^[[(].*[\])]$/;

export const normalise = (text: string): string =>
  text.toLowerCase().replace(/[^a-z']/g, "").replace(/'/g, "");

export const isFiller = (text: string): boolean => FILLERS.has(normalise(text));

/**
 * Tested against the raw text, not the normalised form — normalise() strips digits,
 * so testing that would classify "2024" and "30" as non-speech and cut them out.
 */
export const isNonSpeech = (text: string): boolean =>
  NON_SPEECH.test(text.trim()) || !/[a-z0-9]/i.test(text);

export const mergeRanges = (ranges: Range[]): Range[] => {
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const out: Range[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else out.push({ ...r });
  }
  return out;
};

/** Everything the removals leave behind. Every island survives, however short. */
export const invertRanges = (removals: Range[], from: number, to: number): Range[] => {
  const keeps: Range[] = [];
  let cursor = from;
  for (const r of mergeRanges(removals)) {
    if (r.end <= from || r.start >= to) continue;
    const start = Math.max(r.start, from);
    if (start > cursor) keeps.push({ start: cursor, end: start });
    cursor = Math.max(cursor, Math.min(r.end, to));
  }
  if (to > cursor) keeps.push({ start: cursor, end: to });
  return keeps;
};

/**
 * Drop slivers left between two removals that nearly touch — but only where no word
 * starts. Dropping short islands blindly deletes real speech that happens to sit
 * between a filler and a trimmed pause.
 */
export const pruneIslands = (
  keeps: Range[],
  words: Word[],
  minIsland = DEFAULTS.minIsland,
): Range[] =>
  keeps.filter(
    (k) =>
      k.end - k.start >= minIsland ||
      words.some((w) => w.start >= k.start && w.start < k.end),
  );

export const findRemovals = (
  words: Word[],
  contentStart: number,
  opts = DEFAULTS,
): Range[] => {
  const removals: Range[] = [];
  const speech = words.filter((w) => w.start >= contentStart);

  for (let i = 0; i < speech.length; i++) {
    const w = speech[i];
    if (!isNonSpeech(w.text) && !isFiller(w.text)) continue;
    // Pad outwards for a clean cut, but never past the neighbouring words. Whisper
    // routinely ends a filler exactly where the next word starts, so an unclamped
    // pad clips 40ms off the head of the word after every "um" — and drops that word
    // from the captions, which is how the bug shows up.
    const prev = speech[i - 1];
    const next = speech[i + 1];
    removals.push({
      start: Math.max(w.start - opts.fillerPad, prev ? prev.end : -Infinity),
      end: Math.min(w.end + opts.fillerPad, next ? next.start : Infinity),
    });
  }

  // No stammer rule. Whisper times a repeated word contiguously whether it is an
  // aborted false start or an emphatic "yeah, yeah, yeah" — every repeat measured a
  // 0.00s gap — so the two cannot be separated from the transcript. Cutting them
  // wholesale removed 120 natural backchannels and left the speaker sounding clipped.

  // Dead air, measured between surviving words, so a filler sitting inside a long
  // pause collapses together with it rather than leaving two half-gaps behind.
  const kept = speech.filter((w) => !isNonSpeech(w.text) && !isFiller(w.text));
  for (let i = 0; i < kept.length - 1; i++) {
    const gap = kept[i + 1].start - kept[i].end;
    if (gap <= opts.maxGap) continue;
    const trim = gap - opts.keptGap;
    const mid = (kept[i].end + kept[i + 1].start) / 2;
    removals.push({ start: mid - trim / 2, end: mid + trim / 2 });
  }

  return mergeRanges(removals.filter((r) => r.end > r.start));
};

/**
 * Zero, always — every chunk now seeks to the *window start*, not to its own first
 * range, so all chunks share one clock and frame times sit on a single grid.
 *
 * They used to be rebased per chunk. That put each chunk's picture on its own grid,
 * offset from the model's by a frame or three, and since the sound is cut to the
 * model it landed in a different place in every chunk — measured on the Fro session
 * as lip-sync stepping 90ms between chunks while sitting dead flat inside each one.
 * Kept as a function, and still passed through, so the rebase is named rather than
 * implicit if chunking ever needs to seek independently again.
 */
export const rebaseFor = (_keeps: Range[], _i: number, _chunkSize: number) => 0;

/**
 * Frames a keep range actually contributes.
 *
 * ffmpeg's select filter keeps every frame satisfying between(t, start, end), which
 * is inclusive at both ends — so a range yields one more frame than its duration
 * suggests. Ignoring this made the encoded master run 0.6s longer than predicted and
 * captions drift steadily late across half an hour.
 */
export const rangeFrames = (r: Range, fps = FPS, rebase = 0): number =>
  Math.floor((r.end - rebase) * fps + 1e-9) -
  Math.ceil((r.start - rebase) * fps - 1e-9) + 1;

export const rangeFirstFrameTime = (r: Range, fps = FPS, rebase = 0): number =>
  rebase + Math.ceil((r.start - rebase) * fps - 1e-9) / fps;

/** Cumulative output start for each keep range, quantised to real frames. */
export const outputStarts = (
  keeps: Range[],
  fps = FPS,
  chunkSize = CHUNK_SIZE,
): number[] => {
  const starts: number[] = [];
  let frames = 0;
  for (let i = 0; i < keeps.length; i++) {
    starts.push(frames / fps);
    frames += rangeFrames(keeps[i], fps, rebaseFor(keeps, i, chunkSize));
  }
  return starts;
};

export const totalFrames = (
  keeps: Range[],
  fps = FPS,
  chunkSize = CHUNK_SIZE,
): number =>
  keeps.reduce((a, k, i) => a + rangeFrames(k, fps, rebaseFor(keeps, i, chunkSize)), 0);

export const toOutputTime = (
  sourceTime: number,
  keeps: Range[],
  starts: number[],
): number | null => {
  for (let i = 0; i < keeps.length; i++) {
    if (sourceTime < keeps[i].start || sourceTime > keeps[i].end) continue;
    // Offset from the range's first surviving frame, not its nominal start, so the
    // mapping lands on the instant the encoder actually kept.
    const first = rangeFirstFrameTime(keeps[i], FPS, rebaseFor(keeps, i, CHUNK_SIZE));
    return starts[i] + (sourceTime - first);
  }
  return null;
};

/**
 * Like toOutputTime but for a word. If the word's head landed inside a removal, show
 * it from where it resumes rather than dropping it; only a word buried entirely in a
 * removal returns null.
 */
export const toOutputTimeSnapped = (
  start: number,
  end: number,
  keeps: Range[],
  starts: number[],
): number | null => {
  const exact = toOutputTime(start, keeps, starts);
  if (exact !== null) return exact;
  for (let i = 0; i < keeps.length; i++) {
    if (keeps[i].start >= start && keeps[i].start < end) return starts[i];
  }
  return null;
};

export const buildCaptions = (
  words: Word[],
  keeps: Range[],
  opts = DEFAULTS,
): CaptionWord[] => {
  const starts = outputStarts(keeps);
  const out: CaptionWord[] = [];

  for (const w of words) {
    if (isNonSpeech(w.text) || isFiller(w.text)) continue;
    const t = toOutputTimeSnapped(w.start, w.end, keeps, starts);
    if (t === null) continue;
    const endT = toOutputTime(Math.min(w.end, w.start + 2), keeps, starts);
    const text = w.text.trim();
    if (!text) continue;

    const prev = out[out.length - 1];
    // Whisper attaches punctuation to the word, so a break after a sentence falls
    // out of the text rather than needing separate detection.
    const sentenceEnded = prev ? /[.!?]$/.test(prev.w) : false;
    const paused = prev ? t - (prev.t + prev.d) >= opts.pageBreakGap : false;

    out.push({
      t,
      d: Math.max(0.08, (endT ?? t + 0.2) - t),
      w: text,
      br: Boolean(prev) && (sentenceEnded || paused),
    });
  }
  return out;
};

export const buildEdl = (
  words: Word[],
  sourceDuration: number,
  contentStart = 0,
  opts = DEFAULTS,
): { edl: Edl; captions: CaptionWord[] } => {
  const removals = findRemovals(words, contentStart, opts);
  const keepRanges = pruneIslands(
    invertRanges(removals, contentStart, sourceDuration),
    words,
    opts.minIsland,
  );
  const outputDuration = totalFrames(keepRanges) / FPS;

  return {
    edl: {
      keepRanges,
      sourceDuration,
      outputDuration,
      removedSeconds: sourceDuration - contentStart - outputDuration,
      cutCount: Math.max(0, keepRanges.length - 1),
      fps: FPS,
    },
    captions: buildCaptions(words, keepRanges, opts),
  };
};
