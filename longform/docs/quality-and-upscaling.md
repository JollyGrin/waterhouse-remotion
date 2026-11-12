# Output quality & AI upscaling — learnings

Experiment run 2026-11-03 on the <guest> interview (2026-10-06).

**Decision (Dean, 2026-11-03, after two rounds and a motion review): Real-ESRGAN
`realesrgan-x4plus` is the upscaler.** It beat `realesr-general-x4v3`, `realesr-animevideov3`,
`4xNomos8kSC`, `4xLSDIRplusC`, `4x_NMKD-Siax_200k`, a deblock pre-pass, and a
Lanczos-blend + grain post-pass. Not yet wired into `sesh-edit`; see "Next" at the bottom.

**Evidence:** the example frames and comparison videos are not in git (the repo is
public). They live on Dean's MacBook in
`~/Movies/sesh-edit-out/esrgan-test/` (`1-…` to `5-…mp4`), along with the throwaway test
scripts in `scripts/` (x4v3 PyTorch runner, labelled grid builder).

## 1. Why the <guest> edit looked compressed (it's the recording, not the render)

- Source `2026-10-06 19-13-35-sessions-<guest>-interview.mov` is **640×360 @ 30fps,
  ~0.8 Mbps h264**. The render (`libx264 -preset medium -crf 18`) is not the bottleneck;
  it can't restore detail that was never recorded.
- Cause: Dean's MacBook OBS **Twitch** profile (`~/Library/Application Support/obs-studio/
  basic/profiles/Twitch/basic.ini`) has canvas `BaseCX/CY=1920×1080` but
  `OutputCX/CY=640×360`, Simple output mode, `RecQuality=Stream`: the recording is a
  copy of the 360p stream encode.
- The DJ-set file (`…<guest>-stream.mov`) is the same 640×360.
- Captions look soft because they are drawn at the output resolution (360p) and then
  scaled up by the player. **Rendering at 1080p makes captions perfectly crisp** no
  matter how soft the footage is.

**Fix forward (biggest win, zero compute):** in OBS, Twitch profile → Settings → Output →
**Advanced**. Recording tab: its own encoder, no rescale (full 1920×1080), quality-based
rate control (x264 CRF ~16–18, or Apple VT at high quality). Streaming tab keeps its own
rescale/bitrate. Then sessions arrive at real 1080p and no upscaling is needed.
Not applied yet — Dean's call.

## 2. Target: always deliver 1080p

Even from a 360p source: draw captions at 1080p and upscale the footage. YouTube also
streams 1080p uploads at a far higher bitrate than 360p ones, so viewers see less
re-compression.

## 3. Upscaler comparison (same 10s clip: source 5:00–5:10, 300 frames, M3 Max)

| method | speed | look | verdict |
|---|---|---|---|
| ffmpeg Lanczos to 1080p | instant | soft, blurry: a blown-up 360p | fallback only |
| **Real-ESRGAN `realesrgan-x4plus`** (ncnn-vulkan) | **~2.3 s/frame** (11:40 for 300) → **~22 h** for an 18:44 video | clearly sharper: hair, beards, hands, shirt print, window frames. Skin slightly smooth/painterly, background detail partly invented | **default — looks great (Dean, 2026-11-03)** |
| Real-ESRGAN `realesr-animevideov3` (ncnn) | ~0.22 s/frame (10× faster) | flat, cartoony faces (anime-trained) | rejected |
| Real-ESRGAN `realesr-general-x4v3` (PyTorch, MPS) | **~0.31 s/frame** (93–99 s for 300) → **~3 h** for 18:44, **7.5× faster** than x4plus | about x4plus quality on these stills. Denoise 0.5 is a touch smoother/painterly; 1.0 keeps more grain and crisper print/edges | good speed alternative (~3 h), but visibly below x4plus — not chosen |

Comparison artefacts (not in git): `~/Movies/sesh-edit-out/esrgan-test/`
(`1-plain-LEFT_vs_x4plus-RIGHT.mp4`, `2-x4plus-LEFT_vs_fast-anime-RIGHT.mp4`, `3way_face.png`).

## 4. `realesr-general-x4v3`

Built for real-world footage; tiny SRVGGNetCompact network (~4.7 MB). It has a denoise
knob: blend `realesr-general-x4v3.pth` with `realesr-general-wdn-x4v3.pth`
(denoise=1.0 → plain model, lower → stronger denoise). Not in the ncnn macOS release, so
it runs in PyTorch: the arch is ~20 lines and needs no `basicsr`/`realesrgan` packages
(those packages break on current torchvision anyway).

Results (same 300 frames, MPS on M3 Max, run via `uv run --no-project --with torch --with numpy --with pillow`):
- Speed: denoise 0.5 93.1 s, denoise 1.0 98.9 s → ~0.31 s/frame, ~7.5× faster than x4plus.
- Look: on stills, close to x4plus. Faces and hands are equally sharp. denoise 0.5 smooths skin
  and fabric a little more; denoise 1.0 keeps more texture and the crispest text/edges.
  x4plus still shows marginally more natural micro-detail on the host's face.
- Not yet judged: temporal shimmer in motion. Clip:
  `4-x4plus-LEFT_vs_x4v3-denoise05-RIGHT.mp4`; stills: `3way_x4plus_v3d05_v3d10.png`,
  `host_x4plus_vs_v3d05.png`.
- If motion holds up, x4v3 (denoise ~0.7–1.0) is the practical default: ~3 h overnight
  vs ~22 h, and it runs in-process (torch is already a dependency), no external binary.

## 5. Round 2 — other knobs (5s clip, 150 frames, control = plain Lanczos resize)

Grid video `5-grid-8-variants-<guest>.mp4` and stills `5-grid-{<guest>,host}-still.png` in
`~/Movies/sesh-edit-out/esrgan-test/`. Community ncnn models from
[upscayl/custom-models](https://github.com/upscayl/custom-models) drop into the same
`realesrgan-ncnn-vulkan -n <name>` binary.

| variant | time / 150 fr | first read on stills |
|---|---|---|
| x4plus + 25% Lanczos blend + fine grain (`noise=alls=4:allf=t`) | free (post-process) | less plastic, slightly softer than x4plus |
| deblock + hqdn3d → x4plus | 259 s (+ prepass) | cleaner, fewer sharpened compression blocks, a touch softer |
| `4xLSDIRplusC` | 316 s | barely beats control: too soft. Rejected |
| `4xNomos8kSC` | 265 s | about as sharp as x4plus with more natural beard/skin texture. **Contender** |
| `4x_NMKD-Siax_200k` | 281 s | most detail, but crunchy and hallucinated (blocky building texture). Shimmer risk |
| x4v3 denoise 1.0 | ~47 s | reference |

The community 4x models run in the same ~1.7–2.1 s/frame class as x4plus. **Verdict: none beat
x4plus in motion; x4plus stays.** Untested ideas: face restoration (GFPGAN/CodeFormer) on top of the
winner, and temporal video SR (RealBasicVSR) for shimmer-free, frame-borrowed detail.

## How to run it: `sesh-upscale` + `sesh-overlay` (2026-11-03)

sesh-edit now writes `<name>.clean.mp4` next to `<name>.edited.mp4` (same cut, same audio,
no captions, blank title cards). Upscale the clean cut, then draw the text at the new size:

```
sesh-upscale <name>.clean.mp4 -o <name>.clean.1080p.mp4 [--method x4plus|lanczos] [--tile 512 --jobs 1:1:2]
sesh-overlay <name>.decisions.json <name>.clean.1080p.mp4 -o <name>.edited.1080p.mp4
```

See the README ("1080p / upscaling") for flags and monitoring. <guest> (18:44, 33,721 frames):
lanczos 1080p in 3 min plus 7 min overlay on the M3 Max. x4plus measured at 0.75 s/frame on the
RTX 3070, so about 7 h.

### RTX 3070 (Windows GPU computer, `ssh gpu`), measured 2026-11-03

| ncnn settings | s/frame | VRAM | |
|---|---|---|---|
| auto tile | 0.87 | 3.5 GB | |
| `-t 128 -j 2:4:4` | 0.98 | | smaller tiles are slower |
| `-t 400 -j 2:2:2` | 0.74 | 7.9 GB | about the whole card, which the desktop shares |
| **`-t 512 -j 1:1:2`** | **0.75** | **5.4 GB** | **use this** |
| `-t 640` | | | out of VRAM: `vkQueueSubmit failed -4`, broken frames |

That is 3.1× the M3 Max (2.3 s/frame). The GPU stays at 96–99 % utilisation, about 240 W (the
power limit) and 79 °C max, so it is GPU-bound: PNG I/O and `-j` threads aren't the
bottleneck. The ncnn log lists only `[0 NVIDIA GeForce RTX 3070]`.

Machine notes: the BtbN ffmpeg build's `h264_nvenc` needs NVIDIA driver 610+, and the machine
has 560.94, so encode with libx264 (it takes seconds per chunk, not a bottleneck). C: has about
77 GB free, and the 4× PNGs of a full edit (~125 GB) don't fit, hence the chunks. Real-ESRGAN
is in `C:\Users\<you>\sesh-work\tools\realesrgan\`. Run the script without the sesh-edit
environment (no torch needed):

```
uv run --no-project python -I src\sesh_edit\upscale.py IN.mp4 -o OUT.mp4 --work WORKDIR `
  --realesrgan C:\Users\<you>\sesh-work\tools\realesrgan --tile 512 --jobs 1:1:2
```

Gotchas:
- Upscale **before** burning captions. Upscaling burned-in text smears it.
- A/V: the raw `.mov` is not synced (<guest>: voice 0.261 s early). Only use sesh-edit outputs,
  or shift the audio by `av_offset.applied_s`, when you make samples.
- Each frame is upscaled independently, so check full-screen playback for temporal
  shimmer (sofa texture, plants, hair) before committing to a long run.

## Next

1. Overnight x4plus run of the <guest> edit on the GPU computer.
2. OBS recording fix (§1) so future sessions don't need any of this.
