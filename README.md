# Waterhouse promo videos

Remotion project that renders the vertical (1080×1920, 30 fps) clips Waterhouse
sends to artists and posts to stories. Everything renders from live data; no
design tool needed.

## Setup (once)

```
bun install
```

Needs Bun and ffmpeg on the PATH (Remotion bundles its own Chromium). No
tokens or `.env` for the recap videos: every API they read is public.

## The videos

| Video | What it is | Who gets it | Command |
|---|---|---|---|
| **ArtistRecap** ("Who Showed Up") | An artist's last N shows: who came, who stayed, who was new, plus a target to beat next time | One artist, within a day of their show | `bun run render:recap "Tj Gee"` |
| **HouseWeekly** | The week's board: every artist ranked by the crowd they brought, four badges, the 8-week house line, next week's lineup | The artist group chat, Monday morning | `bun run render:weekly-board --end 2026-09-03` |
| **PullUp** | 10 s looping "I'm on tonight, pull up" clip per event. A shared booking - two or more artists on one reservation - gets a single clip led by the event title, with everyone on the bill in the stream window | Artists forward it to friends before a show | `bun run render:pullup` |
| **WaterhouseSession** | 10 s looping clip for the Tuesday "Waterhouse Sessions" night: the guest and Denzo side by side in the stream window, with the running order ("interview with Denzo, then live set") under it | The guest forwards it to friends before the session | `bun run render:session` (guests from the booking) or `--guest "Duncen"` |
| **WeeklyLineup** | This week's lineup as a story | Instagram story | `bun run render:weekly` |
| **SessionBumper** | 3–4 s stinger that plays before the Tuesday stream and opens onto the live scene. Landscape, webm with alpha, four ideas: "door", "corner", "lamp" and "paper" | OBS, as the Stinger transition into "Waterhouse Sessions with Denzo" | `bun run render:bumper --idea door` |

Output lands in `out/` (gitignored). A clip takes 1–2 minutes to render.
`docs/` holds the latest rendered examples and frame strips.

### ArtistRecap

```
bun run render:recap "Tj Gee"            # last 4 shows, live data
bun run render:recap "Tj Gee" --n 6      # up to 6 shows
bun run render:recap --fixture           # the checked-in example, no network
```

Writes `out/Recap-{artist-slug}-{YYYY-MM-DD}.mp4`, dated by the show it
recaps. The name must match the artist's stage name in the Waterhouse portal.

### HouseWeekly

```
bun run render:weekly-board                      # the 7 days ending today
bun run render:weekly-board --end 2026-09-03     # the 7 days ending that date
bun run render:weekly-board --fixture            # the checked-in example
```

Writes `out/HouseWeekly-{YYYY-Www}.mp4`. Run it on Monday for the week that
just ended.

### PullUp and WeeklyLineup

```
bun run render:pullup          # pick from the next 5 events
bun run render:pullup --all    # every approved event in the next 7 days
bun run render:weekly          # prompts for a bearer token; Enter = public endpoint
```

PullUp writes `out/PullUp-{name}-{YYYY-MM-DD}.mp4`, one file per event:

- **One artist** - named after the artist, their photo in the stream window.
- **Two or more artists on the same reservation** - one file named after the
  event (`out/PullUp-beatshopping-2026-09-11.mp4`), with the headline and the
  chat leading with the night rather than one name. Two artists share the
  window side by side; three or more become a row of chips. Everybody on the
  bill is named.
- **No artists linked** - the purpose line stands in, same as WeeklyLineup.

The event title is the `purpose` with its `Radio:` / `Reserved:` / `Private:`
prefix stripped; a shared booking with no usable purpose is named after its
artists instead (`PullUp-elemzene-l4c4-...`). Two bookings that would write
the same filename get their start time appended.

Shared clips seed on the event id rather than on any one artist, so the
accent colour, the audio variant, the chat lines and the "you" line come back
the same on every re-render. The room avatars do **not**: they are picked
from the roster minus whoever is on the bill, so they shift when the bill
changes or the roster grows.

**Photos.** How a photo hangs in the stream window follows one rule, from
the shape of the photo itself (`src/pullup/framing.ts`):

- **Portrait** (taller than it is wide) - shown whole and centred, over a
  blurred, darkened copy of itself. A tight headshot cropped to the
  landscape window loses the mouth, or the eyes, or both, so it is never
  cropped.
- **Landscape or square** - filled and centred, losing only the edges of a
  photo that already suits the window.

The same rule applies to each half of a two-artist bill. The round chips of
a three-plus bill and the room avatars stay filled and centred: they are
small circles, and the shape does not matter there.

The composition measures each photo as the browser loads it, holding the
frame open until it knows - no image decoding, no preflight, no extra
dependency. The render script only checks that a URL answers with an image
at all; anything that does not, or that loads for the preflight and is then
refused by Remotion's Chromium, falls back to the artist's initials. That
case is printed loudly at the end of the run, listing which clips went out
with initials where a face should be; do not forward those before fixing the
artist's profile image.

### WaterhouseSession

```
bun run render:session                                         # guest(s) from tonight's booking
bun run render:session --date 2026-10-13                       # Simon & Willem, two-guest layout
bun run render:session --guest "Duncen"                        # today, time from the calendar
bun run render:session --guest "Simon" --guest "Willem"        # two guests, named explicitly
bun run render:session --guest "Duncen" --date 2026-10-06      # another Tuesday
bun run render:session --guest "Duncen" --interview-minutes 30
bun run render:session --guest "Duncen" --no-interview         # plain guest set, Denzo hosting
bun run render:session --guest "Duncen" --time 20:00           # override the start time
```

Writes `out/Session-{guest-slug}-{YYYY-MM-DD}.mp4`, named after the guest as
you typed it (or their stage name when taken from the booking); two guests
give `out/Session-{slug}-{slug}-{YYYY-MM-DD}.mp4`. A fork of PullUp (`src/WaterhouseSession.tsx`); PullUp itself is
unchanged.

- **Guests**: without `--guest`, they are the artists linked to that night's
  booking other than Denzo. One is the usual clip; two switch to the
  two-guest layout; none or more than two stops and asks for `--guest`.
  `--guest` can be given once or twice and always wins.
- **Two guests**: the stream window shows three panes - both guests, then
  Denzo as host - and the names are joined ("Simon & Willem") in the running
  order (`19:00 SIMON & WILLEM` over `INTERVIEW WITH DENZO, THEN LIVE SET
  19:20`), the chat line and the call to action. One-guest clips are
  unchanged.
- **Photos** for Denzo and the guest(s) come from their portal artist
  profiles. `--guest` matches a stage name exactly, or by its leading word(s)
  if that is unambiguous ("Duncen" finds "Duncen Haakmat"); the artists on
  that night's booking are checked before the whole roster.
- **Start time** defaults to the approved "Waterhouse Sessions" booking on
  the portal calendar for that date. No booking, no `--time`: it stops and
  asks for one.
- **Running order** under the stream window: `19:00 INTERVIEW WITH DENZO,
  THEN LIVE SET 19:20`, the set time following `--interview-minutes`
  (default 20). With `--no-interview` it reads `19:00 LIVE SET, HOSTED BY
  DENZO` and the chat and call to action switch to the set-only copy.
- **Call to action** reads `TODAY 19:00` when you render on the session's
  own date, and the weekday (`TUESDAY 19:00`) when you render ahead of time.
  The line under the headline always keeps the weekday (`TUE 19:00`).
- Photos hang by the same portrait/landscape rule as PullUp. Any guest or host
  whose photo is missing or fails to load falls back to initials and the run
  ends with a loud warning; a room avatar falling back is only noted.

### SessionBumper

```
bun run render:bumper --idea door                   # out/Bumper-door.webm
bun run render:bumper --idea corner                 # out/Bumper-corner.webm
bun run render:bumper --idea lamp                   # out/Bumper-lamp.webm
bun run render:bumper --idea paper                  # out/Bumper-paper.webm
bun run render:bumper --idea door --guest "Duncen"  # card reads "with Denzo and Duncen"
bun run render:bumper --idea door --idle            # out/Bumper-door-idle.webm, loopable
bun run render:bumper --idea corner --strip         # also docs/bumper-corner-frames.png
bun run render:bumper --idea door --matte           # out/Bumper-door-matte.mp4, Track Matte fallback
bun run render:bumper --idea door --format prores   # out/Bumper-door.mov, ProRes 4444 with alpha, for editing
```

The only landscape clip: **1920×1080, 30 fps**, rendered as **VP9 webm with
alpha** (`yuva420p`, png frames, Opus audio). Where the live scene should
show through, the frame is transparent; nothing is composited in Remotion.
The script checks the result with ffprobe and fails if the alpha channel is
missing. For editing (Premiere, DaVinci, CapCut), use the `.mov` from
`--format prores`: ProRes 4444 keeps the alpha and every NLE takes it,
which VP9 webm does not. Composition `SessionBumper` in `src/bumper/`; the mark is
`src/bumper/Logo.tsx`, the four paths of `public/logo.svg` as separate
pieces.

- **door** (120 frames, 4 s): white paper card, small black mark, a
  hand-held camera (slow drift, half a degree of roll, a punch-in and shake
  on every hit). Someone's shadow grows under the pillar door, knock knock,
  the pillar swings open on its hinge onto the live scene with a warm wedge
  of room light spilling from it, slams shut, holds six frames, opens fully;
  the house jolts, the roof wobbles and the type bounces a frame or two
  after every hinge move. "with Denzo" cuts in on the beat, a reversed cymbal
  swells, and the whole card rushes through the doorway with a touch of blur.
  Paper grain, 1 px red/cyan misregistration on the type, edges that boil
  every two frames. The sounds sit on a 120 bpm grid (`BEAT_GRID` at the top
  of `Door.tsx`). Fully transparent from f112.
- **corner** (115 frames, 3.8 s): black card, the lockup drifts and bounces
  (lime, then purple, then white), lands dead in the top-left corner at f46,
  one white flash, "with Denzo" cuts in, the glass cracks from the corner and
  the panes fall away onto the live scene, the mark's pane last. Fully
  transparent from f100.
- **lamp** (110 frames, 3.7 s): black. A click, and a work lamp on a cord
  swings in from the right as a damped pendulum, settling by f50; its cone
  is the only light, so the white mark and the type exist only where it
  falls. The cord creaks at every apex, a moth circles the bulb, the bulb
  flickers. "WATERHOUSE SESSIONS / with Denzo" fade up inside the cone, a
  hum starts, then the bulb turns to camera (f72–84): the cone becomes a
  growing disc, blooms, and blows the frame out to white by f90. The white
  fades to the live scene f90–104. Fully transparent from f104.
- **paper** (115 frames, 3.8 s): a camera looking straight down at a sheet
  of warm paper, everything on twos with a pixel of jitter, like stop
  motion. The four pieces of the mark drop in as black card 8 frames apart
  (house, beam A, beam B, pillar), shadows tightening as they land, each
  with its own small tilt; a printed strip is pushed in from the right and a
  torn scrap reading "with Denzo" is dropped on it. A flat hand (a
  placeholder silhouette; a cut-out of Denzo's real hand comes later)
  slides in, flicks the pillar open (the live scene is under the sheet),
  hesitates twice, pinches the bottom-right corner and lifts the whole sheet
  off the top right, its shadow growing and detaching. Fully transparent
  from f108.
- `--idle` renders the state to loop before the stinger: door, the open-door
  card held for 2 s with the camera still drifting (the scene already shows
  through the doorway); corner, the drift up to the corner (f0–46; it
  restarts from the centre, so it is a cut, not a seamless loop); lamp, the
  lit mark with the lamp micro-swaying and the moth circling; paper, the
  finished sheet, boiling on twos.
- Timing constants are in one block at the top of `src/bumper/Door.tsx`,
  `Corner.tsx`, `Lamp.tsx` and `Paper.tsx`; change a frame number there,
  nothing else needs touching. The corner's drift is solved from the bounce frames so it always
  lands exactly on the corner frame (`src/bumper/corner-plan.ts`).
- In the Studio, tick `preview` to see a checkerboard where the scene will
  be; it is never part of a render. `SessionBumperStrip` is the contact sheet
  the `--strip` flag renders.
- The bumper one-shots (creak, hum, thump, tap, rustle, reversed cymbal) are
  in `public/audio/bumper/`, derived from the existing kits by
  `bun run gen:audio:bumper`; see `public/audio/bumper/CREDITS.md`.

**OBS setup (Stinger transition).** Settings → Transitions → add *Stinger*.
Video File: `Bumper-door.webm` (or corner / lamp / paper). Transition Point
Type: *Frame*; Transition Point: **64** for door (the push), **70** for
corner, **84** for lamp (the thump, as the white takes over) and **84** for
paper (the grab, before the lift) - the frame the reveal starts, so the new
scene is already live behind it when the card opens. Audio: the webm carries the sounds on its own track, so set
Audio Monitoring to *Monitor and Output* if they should reach the stream,
and Audio Fade Style to *Fade out to transition point*. Leave *Track Matte*
off: the webm's alpha does the reveal. Then pick it as the transition into
the "Waterhouse Sessions" scene.

**Track Matte fallback.** If OBS plays the webm without transparency (an
older build, or hardware decoding that drops VP9 alpha), render the matte
version instead: `--matte` writes an opaque 3840×1080 mp4 with the bumper
over black on the left and its alpha as a luma matte on the right. In the
Stinger settings tick *Use a Track Matte*, Matte Layout *Same file, side by
side*, left fill / right matte, same transition point.

### Just the numbers

```
bun run fetch:audience artist "Tj Gee" --n 4 --out out/recap.json
bun run fetch:audience week --end 2026-09-03 --out out/week.json
```

The same data the recap videos use, as JSON, for checking a number before
you send a clip.

## What the numbers mean

All of it comes from the Twitch chatter snapshots the event logger takes
every 30 seconds, joined to the studio calendar. The definitions live in one
place, `src/audience/metrics.ts`, and the videos only draw them.

| Term | Meaning |
|---|---|
| **Crowd** | People who came for this artist: new faces plus their own regulars. House regulars who watch every stream are not counted. The weekly board ranks on this. |
| **Pulled** | New faces: hadn't watched any Waterhouse stream in the past 30 days. |
| **Returning** | Came to a previous show of this artist in the past 90 days and isn't a house regular. |
| **House regular** | Attended a third or more of all Waterhouse streams in the past 90 days. |
| **Hold** | Share of everyone watching who stayed at least 30 minutes (or half the set, if shorter). |
| **Peak** | Most people watching at once, everyone included. |
| **Follows** | New Twitch follows during the set. |

Weekly badges: **Most pulled**, **Held the room** (hold, min 3 viewers),
**Most follows**, **Best comeback** (biggest crowd gain vs the artist's own
previous show).

The house account and known bots are excluded before anything is counted.
Viewers appear as initials only, never Twitch handles.

Chat activity ("spoke") is designed but switched off until the event logger
stores chat events. See
[waterhouse-twitch-overlay #17](https://github.com/JollyGrin/waterhouse-twitch-overlay/issues/17)
and [#11 here](https://github.com/JollyGrin/waterhouse-remotion/issues/11).

## Where things are

```
src/ArtistRecap.tsx         the recap composition (5 beats, 600 frames)
src/HouseWeekly.tsx         the weekly board (5 beats, 750 frames)
src/PullUp.tsx              per-event loop
src/pullup/plan.ts          reservations -> render jobs (solo vs shared)
src/pullup/framing.ts       the portrait/landscape rule for the stream window
src/WaterhouseSession.tsx   Tuesday session loop (fork of PullUp)
src/session/plan.ts         calendar slot, guest lookup, running order
src/WeeklyLineup.tsx        lineup story
src/bumper/                 SessionBumper: Door.tsx, Corner.tsx, Logo.tsx, corner-plan.ts (tests)
src/audience/schema.ts      zod props schemas: the contract between data and video
src/audience/metrics.ts     every definition above, with tests (bun test)
src/audience/fixtures/      real-data examples the compositions preview with
scripts/fetch-audience.ts   live data -> props JSON
scripts/render-*.ts         one per video
public/audio/recap/         shared sound kit for the recap videos (README inside)
public/audio/pullup/        PullUp soundtrack (WaterhouseSession uses it too)
docs/                       latest rendered examples and frame strips
```

Preview any composition in the Remotion studio with `bun run dev`.

## Changing things

- **A number looks wrong.** Run `bun run fetch:audience ...` and read the
  JSON before touching the video. The thresholds (30 days, 90 days, one
  third, 30 minutes) are named constants at the top of
  `src/audience/metrics.ts`, and `bun test` covers each rule.
- **Copy or layout.** Edit the composition file. Beat frame ranges are
  constants at the top of each.
- **Sound.** `public/audio/recap/README.md` explains each file and the level
  plan. Rebuild the kit with `bun run gen:audio:recap`.
- **Refresh the example fixtures from live data.**
  `bun run fetch:audience --fixtures`.
- **Before a PR.** `bun run lint` and `bun test`.

Design spec with storyboards:
https://claude.ai/code/artifact/e0a9d74d-6af7-41cd-8baf-5b5b88ef78c6
