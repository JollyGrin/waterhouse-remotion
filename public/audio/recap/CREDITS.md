# Recap sound kit — sources and licences

Everything in this folder is license-free for commercial use with no
attribution obligation. Credits are recorded here anyway.

Rebuild with `bun run gen:audio:recap`. The Kenney sources are **not**
duplicated here: the kit reads the copies already committed under
`../pullup/kenney/`, which `bun run fetch:kenney` re-downloads and whose pack
licence texts sit alongside them as `License-*.txt`.

See [README.md](./README.md) for what each output file is for.

## One-shots — Kenney, CC0

Created and distributed by Kenney — <https://kenney.nl>. Licensed
[Creative Commons Zero (CC0 1.0)](http://creativecommons.org/publicdomain/zero/1.0/):
public domain, commercial use permitted, no attribution required.

| Pack             | Page                                        | Source file                              | Used for                                                                                                                                                                                                                                                                          |
| ---------------- | ------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Impact Sounds    | <https://kenney.nl/assets/impact-sounds>    | `../pullup/kenney/impact-soft-heavy.ogg` | `slam.wav` and `land.wav`. Rebuilt in layers to kill the ring: a full-band attack (low-passed 1400 Hz for slam, 650 Hz for land) over a body low-passed to 180–200 Hz. `slam` adds a synthesised sub thump; `land` rolls the attack back to 55% so it settles instead of hitting. |
| Interface Sounds | <https://kenney.nl/assets/interface-sounds> | `../pullup/kenney/pluck.ogg`             | `pop.wav` — cut to 100 ms and low-passed to 3.2 kHz so a run of them reads as a tick-tick-tick rather than a melody.                                                                                                                                                              |
| Interface Sounds | <https://kenney.nl/assets/interface-sounds> | `../pullup/kenney/tick.ogg`              | `tick.wav` — the counting click, unchanged from PullUp's `click.wav` bar its level.                                                                                                                                                                                               |
| Interface Sounds | <https://kenney.nl/assets/interface-sounds> | `../pullup/kenney/confirmation.ogg`      | `chime.wav` — low-passed twice at 1.6 kHz and faded out from 220 ms, so the badge reveal is a soft _dunk_ with no bright bell in it.                                                                                                                                              |

Each source is converted to 48 kHz mono, has its leading silence trimmed
(`silenceremove`) so timing stays tight, and is peak-normalised.

## Synthesised — no third-party material

Generated procedurally by `scripts/gen-audio-recap.ts` from ffmpeg primitives
(`anoisesrc`, `afade`, `lowpass`, `highpass`, `bandpass`, `volume`) with fixed
seeds. No copyrightable input, nothing downloaded.

- **`bed.wav`** — brown noise low-passed to ~220 Hz, breathing ±2 dB on a
  2.6–8.7 s cycle (periods chosen to divide 26 s exactly, so the wander loops
  too), plus 33 scripted grain impulses (5 ms each, band-limited 500–2200 Hz,
  ~1.2/s). **No tonal component**: there is no oscillator anywhere in it.
- **`whoosh.wav`** — three noise bands whose fades are staggered so the top
  leaves first, which is how a downward sweep is built when `lowpass` has a
  fixed cutoff. 280 ms, ending at digital silence.
- **`rise.wav`** — the same three bands opening bottom-up across 600 ms. A
  filter opening, not a pitch rising.
- The sub layer inside **`slam.wav`** — brown noise squeezed under 70 Hz with
  a 10 ms attack and an exponential decay.

## Level plan

| File                    | Peak target |
| ----------------------- | ----------- |
| `slam.wav`              | −6 dBFS     |
| `land.wav`              | −8 dBFS     |
| `rise.wav`              | −9 dBFS     |
| `chime.wav`             | −11 dBFS    |
| `whoosh.wav`, `pop.wav` | −12 dBFS    |
| `tick.wav`              | −20 dBFS    |
| `bed.wav`               | −30 dBFS    |

The bed is levelled on its **body** (2–20 s), past the fade in and before the
fade out, so the fades do not set the gain.
