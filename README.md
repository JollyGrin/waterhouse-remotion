# sesh-edit

Auto-edits longform **Waterhouse Sessions** interview videos. It replaces the manual
Descript pass: cut fillers, cut pre-take chatter, tighten silences, fix A/V lag, and burn
karaoke captions in the house style. Runs locally on Apple Silicon.

```
uv run sesh-edit <input.mov> [-o out.mp4] [--review]
```

Outputs, next to `-o` (default: next to the input):

| file | what |
|---|---|
| `<name>.edited.mp4` | the edit: h264 + aac, captions burned in, one encode pass |
| `<name>.edited.srt` | the same captions, timed to the edited timeline |
| `<name>.decisions.json` | every decision: cuts (with kind + context), keep segments, A/V offset (both checks), pre-take cut, review list, stats |
| `<name>.work/` | cache: transcript, silences, A/V analysis, contact sheet, LLM replies, intermediate wavs |

Re-runs reuse the cache, so planning plus render takes about 40s. `--review` stops before
rendering and prints the plan.

## Install

```
brew install ffmpeg          # any build works: captions are drawn with Pillow, no libass/drawtext needed
curl -LsSf https://astral.sh/uv/install.sh | sh
uv sync                      # pins Python 3.12 (see .python-version)
```

The `claude` CLI must be installed and logged in. The LLM steps call `claude -p` headless,
so no API key is needed. Model weights are downloaded on first run: CrisperWhisper (~3 GB),
wav2vec2-base (~360 MB), and the MediaPipe face landmarker (4 MB, into `~/.cache/sesh-edit`).

## Usage

```
uv run sesh-edit "~/Movies/session.mov" -o ~/Movies/out/session.edited.mp4
uv run sesh-edit "~/Movies/session.mov" -o ~/Movies/out/session.edited.mp4 --review   # plan only
uv run sesh-edit x --from-decisions ~/Movies/out/session.decisions.json -o ~/Movies/out/session.v2.mp4
```

`--from-decisions` renders straight from a (possibly hand-edited) decisions file:
delete a cut, nudge `keep_segments`, change `av_offset.applied_s`, and so on. Nothing is
recomputed.

| flag | default | |
|---|---|---|
| `--av-offset S` | detected | force the A/V offset (+ = audio lags video) |
| `--fillers a,b,c` | see below | filler word list |
| `--silence-max S` | 0.6 | gaps longer than this get tightened… |
| `--silence-target S` | 0.2 | …down to this |
| `--silence-db DB` | auto | silencedetect threshold (auto = noise floor + 10 dB) |
| `--font-px PX` | 68 | caption size at 1080p (scaled by frame height) |
| `--llm-model M` | sonnet | model alias passed to `claude -p` |
| `--force` | | ignore cached transcript / silences / A/V |
| `--replace OLD=NEW` | | fix a misheard word in the captions (whole word, repeatable) |
| `--cut START-END` | | also cut this range (input-file time, e.g. `20:03-20:29`; repeatable) |
| `--move-to-front START-END` | | play this range first, e.g. an intro recorded at the end (repeatable) |

`--cut` and `--move-to-front` take times from the input file, like the review list. Each
edge is moved to the quietest point in the nearest gap between words. Example (the <guest>
session: the intro was recorded after the interview, with production chatter before it):

```
uv run sesh-edit session.mov -o out/session.edited.mp4 \
  --replace trends=trance --cut 20:03.0-20:29.0 --move-to-front 20:29.0-20:58.4
```

## Pipeline

1. **Transcribe, keeping fillers.** Standard Whisper drops "um/uh". On a test clip,
   mlx-whisper (even with a filler-laden prompt) found 2 fillers where
   [CrisperWhisper](https://huggingface.co/nyrahealth/CrisperWhisper), a verbatim Whisper
   large-v3 fine-tune, found 19. So CrisperWhisper is used, on MPS. Audio is split at the
   quietest points into ≤28s chunks and decoded in batches (text only). Chunks that look
   like a hallucination loop (gzip ratio > 2.4, or 8+ identical words in a row) are
   re-decoded with beam search, then split if still looping. Word timings come from
   **wav2vec2 CTC forced alignment**: our own Viterbi, the same algorithm as
   torchaudio/WhisperX, at 20ms resolution with real gaps between words. Numbers are
   spelled out for alignment. 21 min takes about 1m45s.
2. **Cut fillers** (deterministic list: `um umm uh uhh uhm ehm eh euh erm hmm hm`;
   CrisperWhisper writes them as `[UM]`/`[UH]`). CTC gives fillers tiny (40-80ms) and
   sometimes misplaced spans. So when the transcript says a gap between two kept words
   holds only fillers, **all voiced audio in that gap** (20ms level > noise floor + 5 dB)
   is treated as the filler. The gap then keeps its natural pause, capped at 0.2s if
   longer than 0.6s. Safety: if that voiced audio is longer than 1.2s (+0.5s per extra
   filler), or 6 dB louder than the neighbouring words, the ASR probably missed real words
   or a laugh. Then nothing is cut and the spot goes on the review list
   (`filler_not_cut`).
3. **Pre-take chatter.** The LLM reads a compact timestamped transcript and returns where
   the real take starts. Everything before it is cut. A proposed start later than
   max(120s, 25% of the file) is never auto-cut, only flagged. This matters because
   intros are sometimes recorded at the end. In the same call the LLM produces the
   **review list**: restarts, bad takes, production chatter, out-of-order intros. These
   are never auto-cut.
4. **Tighten silences.** Any gap > 0.6s between kept words becomes 0.2s, but only if
   ffmpeg `silencedetect` confirms ≥70% of it is silent. The threshold adapts to the
   room: 10th-percentile level + 10 dB, measured on the same mono mix silencedetect runs
   on. Gaps holding untranscribed sound (crosstalk, laughs, missed words) keep that sound;
   only the confirmed dead-air stretches inside them are tightened. Every cut point snaps
   to the quietest millisecond within ±25ms and gets a **10ms fade out/in**.
5. **A/V lag.** *Primary (MediaPipe):* heads are located with a tiled scan of upscaled
   crops (faces in these wide shots are ~40px). FaceLandmarker then measures mouth
   openness around every b/p-initial word (lips close, then release at the burst). Mouth
   openness and the audio RMS envelope are each averaged across ~180 such events (±0.8s,
   10ms grid; sub-frame jitter between events gives better-than-frame resolution). The
   two averages are cross-correlated over ±400ms. The result is an offset, plus a
   confidence from bootstrap spread and peak r. Plain continuous cross-correlation was
   tried first and gave noise on this footage, because two speakers share one envelope
   and mics cover mouths. *Secondary (LLM):* a contact sheet of mouth crops around 6
   plosives, with the frame implied by the offset outlined in blue, goes to `claude -p`
   for a sanity verdict. Both results are saved; only the MediaPipe offset is applied, and
   only if confidence ≥ 0.3. The audio is shifted before any cutting, and all cut
   decisions are made in video time.
6. **Captions**: Inter Bold (OFL, bundled), single line of ≤7 words (breaks at sentence
   ends, long pauses, or 88% width), centred 84.5% down, 68px at 1080p (calibrated
   against the text width in `reference/`), scaled by frame height, soft drop shadow, no
   outline. Spoken words are white; the current word is white on a rounded `#00AEFF` box;
   upcoming words are 50% white. Rendered with Pillow; each (line, word) state is cached.
7. **Render**: audio is cut sample-accurately in numpy. Video frames are resampled
   through the cut time-map: output frame *n* shows source frame
   `round(to_src(n/fps)·fps)`, so A/V never drifts across hundreds of cuts. Captions are
   alpha-blended in, then piped to a single ffmpeg encode (libx264 crf 18 + aac 192k).

## Tunables

All in `src/sesh_edit/plan.py` (`Params`) and `src/sesh_edit/captions.py` (`Style`).
They are echoed into every `decisions.json`:

- `fillers`, `silence_max` 0.6, `silence_target` 0.2, `silence_cover` 0.7,
  `silence_margin_db` 10, `pretake_pad` 0.25s, `snap_window` 25ms, `fade_ms` 10
- filler safety: `filler_expand_margin_db` 5 ("voiced" threshold over the noise floor),
  `filler_max` 1.2s (+`filler_max_extra` 0.5s/filler), `filler_loud_over_words_db` 6
- captions: `font_px_1080` 68, `center_y` 0.845, `max_words` 7, `max_width` 0.88,
  `box_color` #00AEFF, `upcoming_alpha` 0.5, `shadow_alpha` 0.6
- A/V: apply threshold `min_conf` 0.3 (`cli.py`); `MAX_LAG` 0.4s and `EVENT_HALF` 0.8s
  (`avsync.py`)

## Known limits

- Filler recall is bounded by the ASR. Re-transcribing an edited 4-minute slice found
  about 10 fillers left: most were never in the source transcript, a few were flagged and
  deliberately left in, and one was swallowed into a neighbouring word's span.
- ASR sometimes skips quiet or overlapping speech. Those words are missing from the
  captions, but the audio is never cut (see `skipped_gaps` in decisions.json).
- The LLM steps are not deterministic. Their replies are cached in the work dir, so
  re-runs are stable until you `--force` or delete the cache.
