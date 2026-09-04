# Recap sound kit

Shared by both "Who Showed Up" videos — `ArtistRecap` (remotion-6) and
`HouseWeekly` (remotion-7). One kit, so the two clips sound like a series.

Rebuild with `bun run gen:audio:recap` (`scripts/gen-audio-recap.ts`). The
`.wav` files are committed, so rendering never depends on running it. Sources
and licences are in [CREDITS.md](./CREDITS.md).

All eight files are **48 kHz mono `pcm_s16le`**.

## What each file is for

| File         | Length   | Peak     | Use it for                                                                                                                                                   |
| ------------ | -------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `bed.wav`    | 26.000 s | −30 dBFS | The whole clip. Lay it under everything from frame 0 and let the composition trim — both videos are ≤ 25 s. Fades in over 0.5 s and out over the last 1.5 s. |
| `slam.wav`   | 0.300 s  | −6 dBFS  | The two hardest moments: the hook name landing, and the BEAT reveal. The heaviest thing in the kit — use it twice, not eight times.                          |
| `land.wav`   | 0.220 s  | −8 dBFS  | A big number arriving (uniques, crowd, the weekly total). A settle, not a hit.                                                                               |
| `pop.wav`    | 0.100 s  | −12 dBFS | Each viewer bar in the recap, each row on the weekly board. Meant to be fired many times in a row.                                                           |
| `tick.wav`   | 0.045 s  | −20 dBFS | Typed/counting-up lines. Per digit or per frame step; it is deliberately tiny.                                                                               |
| `whoosh.wav` | 0.280 s  | −12 dBFS | Beat-to-beat transitions. Start it ~0.15 s _before_ the cut so the tail lands on the new beat.                                                               |
| `chime.wav`  | 0.290 s  | −11 dBFS | Badge reveals on the weekly board. Low-passed on purpose — there is no bright bell in this kit.                                                              |
| `rise.wav`   | 0.600 s  | −9 dBFS  | The 600 ms run-up into the BEAT reveal. Ends exactly on 0.6 s, so butt `slam.wav` straight onto its end.                                                     |

## Level plan

Every one-shot peaks at or below **−6 dBFS**; the bed sits at **−30 dBFS**
peak (−44.5 dBFS mean), roughly 24 dB below the one-shots. That gap is much
wider than PullUp's (−1 SFX / −5.5 bed) by design: these videos are _read_
rather than watched, so the bed only exists to stop the gaps between beats
feeling dead. Nothing in it should ever pull the eye off a number.

Remotion lays a mono source into stereo, which costs about 3 dB, so the
loudest thing here renders at roughly −9 dBTP — comfortably under the ceiling
even with several one-shots stacked.

## Rules the kit follows

Carried over from the PullUp soundtrack, for the same reasons:

- **No tonal component anywhere.** No oscillator, no key, no tempo, no melody.
  A sustained sine reads as a whine on phone speakers and on headphones, and
  a musical bed would date the clip and fight whatever the viewer is playing.
  The low weight in `slam.wav` is brown noise under 70 Hz, not a sine; `rise`
  and `whoosh` are filters opening and closing, not pitches moving.
- **Weight from filtered noise, texture from scripted grain.** The bed is
  brown room tone under 220 Hz breathing ±2 dB, plus about 1.2 band-limited
  5 ms impulses per second — a third of PullUp's density, so it reads as air
  rather than as crackle.
- **One-shots die quickly.** The Kenney impact has a long ringing tail that
  reads as a gong, so `slam` and `land` are rebuilt in layers: a full-band
  attack that dies fast over a low-passed body. Nothing rings.

## A note on looping

`bed.wav` is wrapped onto itself with an equal-power crossfade, so the texture
is continuous across the seam — but it then gets the asked-for 0.5 s fade in
and 1.5 s fade out, which means it is _not_ gapless end to end. Looping it
would land on a dip, not on a click. Neither video needs to: both are shorter
than 26 s and simply trim.
