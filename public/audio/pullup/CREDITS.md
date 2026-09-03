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
- **`presence.wav`** — four detuned noise bands across 300–3000 Hz, each with
  its own seed and its own slow wander so they drift against one another. No
  tremolo. Its volume is driven per-frame from the viewer count.
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

- **`bed-a.wav` — outside → inside.** Rain-on-glass texture (fine 900 Hz–9 kHz
  noise plus ~9 droplet impulses/s) over a distant city wash (brown noise under
  400 Hz with a slow wander). When YOU arrives at 2.5 s the outside layer ducks
  ~18 dB over one second and the warm inside room takes over; at 9.0–9.8 s the
  room empties and the rain returns, so the loop reads rain → room → rain.
- **`bed-b.wav` — venue before the show.** Vinyl crackle (~6/s), soft room
  tone, a PA "power-up" from 1.0–2.5 s under the ask block (three noise bands
  opening bottom-up, settling to the hiss of a rig that is now switched on),
  and a riser from 7.5 s.
- **`bed-c.wav` — cinematic weather.** Three distant thunder rumbles at
  irregular intervals (brown noise bursts lowpassed to 120 Hz, no pitch), a
  wind texture with ±6 dB slow gusts, and the same riser.

The **riser** in B and C is three noise bands fading in bottom-up across
7.5–9.2 s, handing off to the seam whoosh so each loop builds into the frame-0
thud. It is a filter opening, not a pitch rising — there is no tonal content.
Its gains are deliberately high: at first pass it moved the bed only 1.6 dB
into the seam, which is inaudible. It now climbs about 9 dB (−38 dBFS at 7.0 s
to −29 dBFS at 8.4–9.0 s) before handing off, which is what makes the build
read.

### On real recordings

The brief asked for real recordings from [pixabay.com](https://pixabay.com)
under the Pixabay Content License — a crowd/bar murmur for `presence.wav`, and
rain, city and thunder for the variants.

**pixabay.com is not reachable from here.** Both the site and its CDN answer
**HTTP 403** to a scripted fetch, with and without browser headers:

```
https://pixabay.com/sound-effects/search/...  -> 403
https://cdn.pixabay.com                        -> 403
```

Everything therefore ships synthesised. No substitute source was used: the
point of Pixabay here was its no-attribution licence, and swapping in a
differently-licensed library (Freesound is reachable, but much of it is CC-BY)
would change the obligations without anyone asking for that.

To drop real recordings in later: put the files in this folder, add a row below
with the source URL and licence, and point the relevant layer in
`scripts/gen-audio.ts` at the file instead of at `anoisesrc`. Any clip used
must contain no music.

| File | Source URL | Licence |
|---|---|---|
| _(none yet)_ | | |
