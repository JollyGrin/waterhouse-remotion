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
| `<name>.edited.mp4` | the edit: the [Fuse intro](#intro) then the interview, h264 + aac, captions burned in, one encode pass |
| `<name>.clean.mp4` | the same cut and audio with no intro, no captions and blank title cards: input for `sesh-upscale` (skip with `--no-clean`) |
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
| `--insert-clip AT FILE START-END` | | insert a clip from another file before input time AT (repeatable) |
| `--clip-fade S` / `--clip-gain DB` | 0.4 / -6 | clip audio fades, and clip level relative to the speech |
| `--title-card AT TEXT` | | black card, white Inter Bold text, before input time AT (after any clip at AT) |
| `--card-dur S` | 3.5 | title card length (0.5s text fades) |
| `--keep-stereo` | | keep the original mic channels (default: centred mic mix, see below) |
| `--lufs` / `--no-loudnorm` | -14 | loudness target (true peak -1 dBTP) / skip it |
| `--no-intro` | | don't prepend the channel ident (output as before the intro existed) |
| `--intro FILE` | Fuse | prepend another ident: a video with alpha (see [Intro](#intro)) |

`--cut`, `--move-to-front`, `--insert-clip` and `--title-card` take times from the input file, like the review list. Each
edge is moved to the quietest point in the nearest gap between words. Example (the <guest>
session: the intro was recorded after the interview, with production chatter before it):

```
uv run sesh-edit session.mov -o out/session.edited.mp4 \
  --replace trends=trance --cut 20:03.0-20:29.0 --move-to-front 20:29.0-20:58.4 \
  --insert-clip 0:01 ~/Movies/session-stream.mov 57:48.4-57:56.4 \
  --title-card 0:01 "How did you first get into electronic music?"
```

An insert at AT goes before the kept segment starting within 2s of AT; otherwise that
segment is split at the quietest point between words. Inserted clips are conformed to the
interview's size and fps, level-matched to the speech, and fade in and out. A clip directly
followed by a title card also dips to black. Captions never run over an insert.

## Intro

`<name>.edited.mp4` and `<name>.edited.1080p.mp4` open with **Fuse**, the Waterhouse Sessions
ident (5 s, with alpha). The interview starts playing underneath at 3.933 s (Fuse frame 118),
when the ident's rings open onto it, so the output is 3.933 s + the edit. `<name>.clean.mp4`
never gets the intro: it stays the upscale input, and `sesh-overlay` adds the intro at 1080p.

- **Video:** the ident is conformed to the output's size and fps (360p gets a downscaled
  ident) and composited in the same encode pass as the captions; no extra encode.
- **Audio:** the interview is loudness-normalised first, without the intro. Then the intro
  soundtrack gets one gain so its integrated loudness equals the speech's (e.g. -10.9 → -14
  LUFS), capped so its true peak stays under -1 dBTP, and is mixed over the start of the
  interview. Its own mix is untouched (no EQ, compression or limiting).
- **Captions:** shifted by the intro offset, burned and in the `.srt`. None show while the
  ident is on screen: a line that would start under it starts when it ends (5.0 s).
- **decisions.json:** `intro` records the file, `open_s` and `level_lu` (relative level,
  default 0); `render.intro` records the measured LUFS and the applied gain, which
  `sesh-overlay` reuses. `--from-decisions` renders the recorded intro unless `--no-intro`
  or `--intro` is given. Decisions from before the intro existed get the default Fuse.

Asset: `src/sesh_edit/assets/intro/fuse-16x9.{webm,flac,json}` was made from the ProRes 4444
master rendered in the waterhouse-remotion repo (JollyGrin/waterhouse-remotion#28, `Fuse-16x9.mov`):
`ffmpeg -i Fuse-16x9.mov -an -c:v libvpx-vp9 -pix_fmt yuva420p -crf 30 -b:v 0 -auto-alt-ref 0 fuse-16x9.webm`,
`ffmpeg -i Fuse-16x9.mov -vn -c:a flac fuse-16x9.flac`. ffmpeg only decodes VP9 alpha with
`-c:v libvpx-vp9` before `-i` (the code does this).

`--intro FILE` takes any video with alpha (VP8/VP9 WebM, ProRes 4444, ...). Audio comes from
a `<stem>.flac`/`<stem>.wav` next to it, else from the file. The point where the interview
starts comes from a `<stem>.json` (`{"open_s": 3.933}`), else from the first frame that is
not fully opaque (mean alpha < 0.999), else the end (hard cut).

## 1080p / upscaling

Sources are 360p. To publish at 1080p, upscale the **clean** cut, then draw the captions and
title cards at 1080p so the text stays sharp:

```
uv run sesh-upscale out/session.clean.mp4 -o out/session.clean.1080p.mp4 --method lanczos   # minutes
uv run sesh-upscale out/session.clean.mp4 -o out/session.clean.1080p.mp4 --method x4plus    # hours, GPU
uv run sesh-overlay out/session.decisions.json out/session.clean.1080p.mp4 -o out/session.edited.1080p.mp4
```

`sesh-upscale` (x4plus) extracts the frames, then works in chunks: Real-ESRGAN 4× → Lanczos
down to `--height` → x264 → delete the 4× PNGs. At the end it concatenates the chunks and
muxes the audio. **Re-run the same command to resume**: finished chunks are skipped, and
frames already upscaled in an interrupted chunk aren't redone. It uses the standard library
only, so on a GPU box without the full environment run `uv run --no-project python -I src/sesh_edit/upscale.py …`.

| flag | default | |
|---|---|---|
| `--method` | x4plus | `x4plus` (Real-ESRGAN ncnn-vulkan) or `lanczos` (one ffmpeg pass) |
| `--height` | 1080 | output height |
| `--realesrgan PATH` | `$SESH_REALESRGAN` / PATH | `realesrgan-ncnn-vulkan` binary or its folder (with `models/`) |
| `--tile` / `--jobs` / `--gpu` | auto | ncnn `-t` / `-j` / `-g`. RTX 3070: `--tile 512 --jobs 1:1:2` |
| `--chunk N` | 1000 | frames per chunk (~4 GB of 4× PNGs at a time) |
| `--start S` / `--duration S` | | only a slice, e.g. a 10 s benchmark |
| `--crf` / `--preset` / `--encoder` | 16 / slow / libx264 | output encode |
| `--work DIR` | `<output>.upscale-work` | job state; a different job in the same dir is refused |

Monitoring: `sesh-upscale --status DIR` prints `DIR/status.json` (state, frames done, rolling
s/frame, ETA, disk free, and on NVIDIA GPU utilisation, VRAM, temperature and power) plus
the log tail. nvidia-smi samples go to `DIR/gpu.csv`. A Real-ESRGAN error (e.g. out of
VRAM: lower `--tile`) stops the job with `state: failed` and never marks the chunk done.

`sesh-overlay` checks that the video is the clean cut of those decisions (same fps and frame count),
prepends the intro recorded in the decisions (mixing its soundtrack over the clean cut's audio at
the gain sesh-edit used; with no intro the audio is copied), and writes a matching `.srt`. Background and measurements:
[docs/quality-and-upscaling.md](docs/quality-and-upscaling.md).

## Machines & getting videos in (Dropbox → GPU box)

Three machines can drive this tool. Heavy work (transcription, x4plus upscaling) runs on the
**GPU box**.

| machine | role | how to reach it |
|---|---|---|
| **GPU box** `<gpu-host>` (Windows 10, RTX 3070) | runs the pipeline | Mac: `ssh gpu` (PowerShell: chain with `;`, never `&`). Any machine: T3 linked environment **<gpu-host>**, project `waterhouse-video-editing` |
| Dean's MacBook (M3 Max) | runs it too (MPS); orchestration | local |
| <vps> (VPS) | orchestration only, no GPU | steers the GPU box through T3 only (SSH from the VPS to the GPU box is blocked by design) |

GPU box layout:

| path | what |
|---|---|
| `C:\Users\<you>\git\waterhouse\waterhouse-video-editing` | this repo (`main`) |
| `C:\Users\<you>\Videos\sesh-in\` | **inbox**: source videos |
| `C:\Users\<you>\Videos\sesh-out\` | **outbox**: edits, decisions, upscales |
| `C:\Users\<you>\tools\realesrgan\` | Real-ESRGAN ncnn-vulkan (Windows build, v0.2.5.0). User env `SESH_REALESRGAN` points here |

ffmpeg, uv, git and the `claude` CLI are on the user PATH. torch there is the CPU build
(the code picks MPS or CPU), so transcription is slower than on the Mac; upscaling uses the
GPU through Vulkan.

### Download from a Dropbox share link

Change `dl=0` to `dl=1` and keep the `rlkey=` parameter (newer `/scl/fi/` links need it).
`st=` can be dropped. On the GPU box (Windows ships `curl.exe`):

```powershell
New-Item -ItemType Directory -Force C:\Users\<you>\Videos\sesh-in | Out-Null
curl.exe -L -o "C:\Users\<you>\Videos\sesh-in\<name>.mp4" "https://www.dropbox.com/scl/fi/<id>/<name>.mp4?rlkey=<key>&dl=1"
```

On Mac/Linux it's the same `curl -L -o … "…&dl=1"`.

- A **folder** link downloads as one `.zip`: `Expand-Archive <zip> <dir>`.
- Check the size afterwards. A few-KB file is an HTML error page (bad or expired link,
  or a missing `rlkey`).
- A share link is readable by anyone who has it. Expire or delete it after the pull.
- Disk: C: had ~76 GB free on 2026-11-04. x4plus works in chunks (~4 GB of PNGs at a time),
  but don't run several upscales at once.

### Full run on the GPU box (trim → upscale → caption)

```powershell
cd C:\Users\<you>\git\waterhouse\waterhouse-video-editing
$in  = "C:\Users\<you>\Videos\sesh-in\<name>.mp4"
$out = "C:\Users\<you>\Videos\sesh-out\<name>"
uv run sesh-edit $in -o "$out.edited.mp4"                     # trim + 360p preview + <name>.clean.mp4 + decisions.json
uv run sesh-upscale "$out.clean.mp4" -o "$out.clean.1080p.mp4" --method x4plus --tile 512 --jobs 1:1:2
uv run sesh-overlay "$out.decisions.json" "$out.clean.1080p.mp4" -o "$out.edited.1080p.mp4"
```

x4plus takes hours. Re-run the same `sesh-upscale` command to resume, and check progress
with `uv run sesh-upscale --status "$out.clean.1080p.mp4.upscale-work"`. Run long jobs from
a T3 thread on the GPU box (it needs a logged-in Windows session; the T3 app starts at login).

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
7. **Audio finishing** (default; `--keep-stereo` turns it off). Each RODE mic is recorded
   to its own channel, so as-is each voice plays in one ear. The two channels are
   level-matched (median speech level of each mic while it leads), then summed to an
   identical L/R (centred) track. Each mic also picks up the other speaker ~16 dB down
   and ~2.4 ms late, so a straight sum comb-filters ("phasey" sound; measured 2.4 dB
   spectral ripple on one voice). To avoid that, the channel that is >3 dB quieter is
   ducked by up to 15 dB (fast open, 200ms close), which brings the ripple to 0.9 dB. Both
   stay open when both people talk. Loudness: gentle speech compression (3:1 above
   -28 dBFS), one linear gain to -14 LUFS, and a 4x-oversampled limiter at -1.3 dBFS. The
   gain is corrected once for the limiter, then the result is re-measured. ffmpeg's
   loudnorm alone falls back to its dynamic AGC here, because speech peaks sit ~24 dB
   above its loudness. This step takes 2-6 min.
8. **Render**: audio is cut sample-accurately in numpy. Video frames are resampled
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
