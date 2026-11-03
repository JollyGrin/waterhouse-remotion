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
| `rain.wav` | synthesised | seeded noise 400 Hz – 5 kHz, level wandering slowly between knots, 4.5 s, −20 dBFS | neon: the street, under everything until the water clears |
| `buzz.wav` | synthesised | 60 Hz clipped sawtooth (odd harmonics to the 9th), 120 Hz throb, seeded 12 ms crackle bursts, low-passed 3.5 kHz, 3.2 s, −18 dBFS | neon: the transformer, louder with every tube |
| `neon-tick.wav` | synthesised | 12 ms noise burst high-passed 1.8 kHz, −10 dBFS | neon: each tube striking, each dropout |
| `drip.wav` | synthesised | 110 ms sine chirp 1.6 kHz → 500 Hz, −16 dBFS | neon: each raindrop hitting the puddle |
| `clunk.wav` | `../pullup/kenney/impact-soft-heavy.ogg` (Kenney Impact Sounds, CC0) | 1.1× rate, low-passed 900 Hz twice, −6 dBFS | vhs: the cassette seating |
| `motor.wav` | synthesised | 90 → 150 Hz tone spinning up over 0.25 s with a sub-harmonic rattle and a dull noise bed, 1.2 s, −16 dBFS | vhs: the loading motor |
| `hiss.wav` | synthesised | seeded noise 300 Hz – 6 kHz with a faint 50 Hz mains buzz, 3.5 s, −24 dBFS | vhs: tape hiss from PLAY to the lock |
| `seek.wav` | synthesised | the motor with a 2.3 Hz pitch wobble, 0.9 s, −14 dBFS | vhs: the heads hunting during the roll |
| `snow.wav` | synthesised | full-band noise with a 15.6 kHz line whistle, soft-clipped, 0.5 s, −12 dBFS | vhs: the snow burst |
| `fader.wav` | synthesised | noise through a low-pass whose cutoff (250 Hz – 1.65 kHz) and level follow the thumb's velocity profile (`faderTravel`, 4-frame ramp, end stop at frame 32), an end-stop tick, 1.2 s, −16 dBFS | fader: the fader's friction, f8–40 |
| `led-click.wav` | synthesised | 2 ms click + 2.2 kHz ping, 30 ms, −12 dBFS | fader: each channel LED, pitched up a little per channel |
| `relay.wav` | synthesised | 140 Hz thud, 900 Hz tick, 8 ms of noise, 90 ms, −8 dBFS | fader: the ON AIR relay |
| `rise.wav` | synthesised | 60 Hz with harmonics sweeping to 420 Hz over 0.8 s, louder as it goes, hard cut, −14 dBFS | fader: the push into the panel, cut at f96 |
| `clack.wav` | synthesised | 6 ms plastic tick under 2.5 kHz, a 700 Hz body, a 180 Hz knock, 50 ms, −10 dBFS | flap: row 2's letters (they depend on the guest name), played live with ±15 % pitch |
| `flap-cascade.wav` | synthesised from `clack` | every flip start in `src/bumper/flap-plan.ts` (mosaic, row 1, the stuck tile's fix, the exit wave) placed at its frame, pitched ±15 % and weighted per phase, soft-clipped, 3.6 s, −8 dBFS | flap: the whole cascade. Re-run the generator if the plan's timing changes |
| `fluoro.wav` | synthesised | 100 Hz buzz with falling harmonics, a 2 kHz whine, a 1.3 Hz ripple, 4 s, −24 dBFS | flap: the hall's tubes |

The door also uses, unchanged: `../pullup/thud.wav` (knocks), `../recap/slam.wav`
(the slam), `../recap/tick.wav` (the name), `../recap/whoosh.wav` (the push, at
half speed). The lamp uses `../pullup/presence.wav` (room tone, quiet) and
`../pullup/click.wav` (the switch). The VHS uses `../pullup/presence.wav`
(room tone) and `../pullup/click.wav` (PLAY, and each tracking sweep). The
fader uses `../pullup/presence.wav`, `hum.wav` (the desk's electrics),
`clunk.wav` + `../pullup/click.wav` (PLAY) and `../recap/tick.wav` (the name
tape). The split-flap uses `../pullup/presence.wav` (hall).
