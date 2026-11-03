# SessionBumper sound kit — sources and licences

Everything in this folder is license-free for commercial use with no
attribution obligation. Credits are recorded here anyway. Rebuild with
`bun run gen:audio:bumper` (`scripts/gen-audio-bumper.ts`); the DSP is done
in TypeScript on the PCM because Remotion's bundled ffmpeg has no reverse,
low-pass or fade filters.

Each output is 48 kHz mono `pcm_s16le`, peak-normalised. Nothing new was
downloaded: every file is derived from a clip already in the repo. The Kenney
sources are CC0 (<https://kenney.nl>, licence texts under
`../pullup/kenney/License-*.txt`); the PullUp and Recap kits are synthesised,
see their own `CREDITS.md`.

| File | Derived from | How | Used for |
| --- | --- | --- | --- |
| `cymbal-reverse.wav` | `../pullup/whoosh.wav` (synthesised sweep) | slowed to 1.2×, reversed, 50 ms fade-in, −8 dBFS | the door: swells 20 frames into the push |
| `creak.wav` | `../pullup/kenney/pluck.ogg` (Kenney Interface Sounds, CC0) | two octaves down (0.25× rate), low-passed 1.5 kHz twice, −12 dBFS | the door hinge (both swings); the lamp cord at each swing apex |
| `hum.wav` | synthesised | 60 Hz + four harmonics, 0.4 Hz tremolo, a whisper of noise, low-passed 1.8 kHz, 4 s, −22 dBFS | the lamp, from the type fade-up, rising through the turn. The one intentionally tonal sound in the kits: it is a lamp |
| `thump.wav` | `../pullup/kenney/impact-soft-heavy.ogg` (Kenney Impact Sounds, CC0) | slowed to 0.7×, low-passed 320 Hz twice, −6 dBFS | the lamp blow-out at f84 |
| `tap.wav` | `../recap/tick.wav` (Kenney Interface Sounds `tick_001`, CC0) | an octave down, low-passed 2.5 kHz twice, −14 dBFS | paper: each piece landing, the scrap, the hand's hesitations |
| `rustle.wav` | `../pullup/whoosh.wav` (synthesised sweep) | low-passed 1.2 kHz twice, high-passed 120 Hz, −14 dBFS | paper: the strip push, the hand entering, the lift |

The door also uses, unchanged: `../pullup/thud.wav` (knocks), `../recap/slam.wav`
(the slam), `../recap/tick.wav` (the name), `../recap/whoosh.wav` (the push, at
half speed). The lamp uses `../pullup/presence.wav` (room tone, quiet) and
`../pullup/click.wav` (the switch).
