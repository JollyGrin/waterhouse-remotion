# PullUp soundtrack — sources and licences

Everything in this folder is license-free for commercial use with no
attribution obligation. Credits are recorded here anyway.

Rebuild with `bun run gen:audio`. Re-download the Kenney sources with
`bun run fetch:kenney` (only needed to change which sounds are picked — the
selected sources are committed under `kenney/`).

## One-shots — Kenney, CC0

Created and distributed by Kenney — <https://kenney.nl>. Licensed
[Creative Commons Zero (CC0 1.0)](http://creativecommons.org/publicdomain/zero/1.0/):
public domain, commercial use permitted, no attribution required. The pack
licence texts are kept alongside the audio as `kenney/License-*.txt`.

| Pack | Page | Source file | Used for |
|---|---|---|---|
| Impact Sounds | <https://kenney.nl/assets/impact-sounds> | `impactSoft_heavy_000.ogg` → `kenney/impact-soft-heavy.ogg` | `thud.wav` — the frame-0 impact. Chosen for being soft and low: 48 dB more energy below 200 Hz than above 2 kHz, with no metallic ring. |
| Interface Sounds | <https://kenney.nl/assets/interface-sounds> | `pluck_001.ogg` → `kenney/pluck.ogg` | `pop-you.wav`, and `pop-friend-0..5.wav` pitched down one semitone at a time (`asetrate` + `aresample`) so the friends stay related to the sound you made. |
| Interface Sounds | <https://kenney.nl/assets/interface-sounds> | `tick_001.ogg` → `kenney/tick.ogg` | `click.wav` — the viewer-counter increment. 23 ms, high-biased. |
| Interface Sounds | <https://kenney.nl/assets/interface-sounds> | `confirmation_001.ogg` → `kenney/confirmation.ogg` | `msg.wav` — the chat bubble tick. |

UI Audio (<https://kenney.nl/assets/ui-audio>) is downloaded by
`fetch-kenney.ts` and was surveyed, but nothing from it beat the Interface
Sounds picks, so no file from it is committed.

Each source is converted to 48 kHz mono, has its leading silence trimmed
(`silenceremove`) so timing stays tight, and is peak-normalised.

## Beds — synthesised, no third-party material

Generated procedurally by `scripts/gen-audio.ts` from ffmpeg primitives
(`anoisesrc`, `afade`, `lowpass`, `highpass`, `bandpass`, `volume`) with fixed
seeds. No copyrightable input, nothing downloaded.

- **`bed.wav`** — brown noise lowpassed to ~250 Hz, breathing ±2 dB on a 3–5 s
  cycle, plus sparse vinyl-style grain (~3 scripted impulses per second, 5 ms
  each, band-limited 400–2600 Hz). **No tonal component**: there is no
  oscillator anywhere in the bed, because a sustained sine reads as a whine on
  phone speakers.
- **`presence.wav`** — the real pre-concert crowd (`pixabay/crowd.wav`),
  wrapped with an equal-power crossfade. Its volume is driven per-frame from
  the viewer count. This replaced a synthesised four-band noise texture, which
  was indistinguishable from room tone.
- **`whoosh.wav`** — the loop-seam room-emptying sweep. Three staggered noise
  bands, the top one leaving first, ending at digital silence. Kept
  synthesised because the Kenney packs have no reversed whoosh.

Both beds are exactly 480000 samples (300 frames at 30 fps) and are wrapped
onto themselves with an equal-power crossfade, with a 40 ms fade at each edge
so the loop seam does not click.

## Bed variants

Three alternative beds, selected at render time with the audio-only
`bedVariant` prop (`"a"`, `"b"`, `"c"`; omitted or `"base"` uses `bed.wav`).
They change nothing visual. All are synthesised, all obey the same rules as the
base bed — no key, no melody, no tempo, no tonal drone — and all are wrapped
and edge-faded identically.

- **`bed-a.wav` — outside → inside.** Real rain on a window plus a distant
  urban wash. When YOU arrives at 2.5 s the outside ducks 10 dB and the crowd
  takes over; at 9.0–9.8 s the room empties and the rain returns, so the loop
  reads rain → room → rain.
- **`bed-b.wav` — venue before the show.** Real vinyl crackle over soft room
  tone, a non-tonal PA "power-up" from 1.0–2.5 s under the ask block (three
  noise bands opening bottom-up), and a riser from 7.5 s.
- **`bed-c.wav` — cinematic weather.** A real distant thunder rumble placed
  twice — under the ask at 1.0 s and under the riser at 7.4 s — over a heavily
  attenuated wind bed (the source is the loudest in the set by ~13 dB), plus
  the same riser.

The **riser** in B and C is three noise bands fading in bottom-up across
7.5–9.2 s, handing off to the seam whoosh so each loop builds into the frame-0
thud. It is a filter opening, not a pitch rising — there is no tonal content.
Its gains are deliberately high: at first pass it moved the bed only 1.6 dB
into the seam, which is inaudible. It now climbs about 9 dB (−38 dBFS at 7.0 s
to −29 dBFS at 8.4–9.0 s) before handing off, which is what makes the build
read.

## Recordings — Pixabay Content License

Fetched by the operator through a browser and committed under `pixabay/`.
The **Pixabay Content License** permits commercial use with **no attribution
required**; credits are recorded here anyway. None of these clips contain
music.

| File | Title | Author | Source |
|---|---|---|---|
| `pixabay/rain.wav` | Gentle Rain on Window | Eryliaa | <https://pixabay.com/sound-effects/> (id 350529) |
| `pixabay/city.wav` | Distant Urban Ambience | Alex_Jauk | <https://pixabay.com/sound-effects/> (id 201128) |
| `pixabay/wind.wav` | Gentle Wind Sounds | DRAGON-STUDIO | <https://pixabay.com/sound-effects/> (id 584728) |
| `pixabay/crackle.wav` | Vinyl Crackle (Real) | freesound_community / beautifuldaymonster1968 | <https://pixabay.com/sound-effects/film-special-effects-vinyl-crackle-real-69409/> |
| `pixabay/crowd.wav` | Small Crowd pre-concert talking party bar walla | freesound_community / JohnsonBrandEditing | <https://pixabay.com/sound-effects/people-small-crowd-pre-concert-talking-party-bar-walla-talking-6044/> |
| `pixabay/thunder.wav` | Distant Thunder | CapaholiczSFX | <https://pixabay.com/sound-effects/nature-distant-thunder-405128/> |

Each source mp3 was cut to the section actually used, converted to 48 kHz mono
`pcm_s16le`, and peak-normalised to −6 dBFS so the mix gains in
`scripts/gen-audio.ts` are predictable. To reproduce from the original mp3s:

| Output | Cut from | Start | Length |
|---|---|---|---|
| `rain.wav` | `rain-window.mp3` | 30 s | 11 s |
| `city.wav` | `city-distant-urban.mp3` | 5 s | 11 s |
| `wind.wav` | `wind-gentle.mp3` | 10 s | 11 s |
| `crackle.wav` | `vinyl-crackle.mp3` | 3 s | 11 s |
| `crowd.wav` | `crowd-preconcert.mp3` | 4 s | 11 s |
| `thunder.wav` | `thunder-distant.mp3` | 4 s | 4 s |

```
ffmpeg -ss <start> -t <len> -i <src>.mp3 -ac 1 -ar 48000 -c:a pcm_s16le <out>.wav
# then peak-normalise each to -6 dBFS
```

11 s is `CLIP_SECONDS + WRAP`: the looping layers need one second of overhang
for the equal-power wrap crossfade. `thunder.wav` is a single 4 s rumble,
placed twice by the generator rather than looped.

`presence.wav` — the murmur that swells with the viewer count — is now
`crowd.wav`, wrapped with the same crossfade. The synthesised noise-band
presence it replaced has been dropped.

### Note on levels

The real recordings are far peakier than the synthesised noise they replaced,
so peak-matching alone left the beds 5–9 LU below the loudness target. The
looping beds therefore get a gentle 3:1 compressor (`-26 dB` threshold, 20 ms
attack, 300 ms release) before normalisation, and are levelled on their
**ambient body** (1–7 s) rather than their global peak — otherwise the riser
in variants B and C sets the level and pushes their real material 5–6 dB
below variant A's, which is what made all three sound alike.
