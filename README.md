# Waterhouse video

All of Waterhouse Studios' video work in one repo: the promo clips, idents and
stingers (Remotion), and the tool that edits the Waterhouse Sessions
interviews (`sesh-edit`). Shared by the Waterhouse team; most people drive it
through an AI coding agent (Claude Code, Codex, Cursor, Gemini, ...) rather
than by editing code.

**New here? Read [GETTING-STARTED.md](GETTING-STARTED.md).** It has the setup,
what to ask your agent, and how to share your work.

## The rules

This repo is **public** and `main` is what everyone else builds on, so:

1. **Always work on a branch.** Never commit or push to `main`.
2. **Push your branch early and often**, so your work is always on GitHub
   and anyone can pick it up. Your AI agent does this for you as it goes.
3. **Want it in `main`? Open a pull request** into `main`. Only
   **JollyGrin** (Dean) merges.
4. **Then message Dean on WhatsApp** with the PR link. Otherwise just keep
   working on your branch.
5. **Never commit media**: footage, photos, music, renders. Git ignores the
   folders they live in; keep it that way.

The commands for 1–4 are in
[GETTING-STARTED.md, "Sharing your work"](GETTING-STARTED.md#6-sharing-your-work).
Agents get the same rules from [AGENTS.md](AGENTS.md) (`CLAUDE.md` imports it).

Every template (Fuse, the door stinger, PullUp, ...) is listed by the name
people use for it in [TEMPLATES.md](TEMPLATES.md).

## Two tools in this repo

| | Tool | Where | Runs with |
|---|---|---|---|
| **Animations**: promo clips, the weekly lineup and board, artist recaps, posters, the Sessions intro (Fuse) and other idents, OBS stingers, reels | **Remotion** | the repo root | Bun |
| **Editing recorded interviews**: cut fillers and silences, fix A/V sync and the mic mix, captions, the intro, 1080p upscaling | **sesh-edit** | [`longform/`](longform/) ([its README](longform/README.md)) | uv (Python) |

Idents are **made** in Remotion and **composited** by sesh-edit: Fuse
(`src/ident/Fuse.tsx`) is the Sessions intro, and `bun run render:intro`
builds it into sesh-edit. Details: AGENTS.md, "Hand-off".

## Quick commands (developers)

The full setup, per tool, is in GETTING-STARTED.md. If you already have
ffmpeg, Bun and uv:

```sh
git clone https://github.com/JollyGrin/waterhouse-video.git && cd waterhouse-video
bun install                                  # animations (Remotion)
(cd longform && uv sync)                     # video editing (sesh-edit)
bun run render:intro                         # the Fuse intro sesh-edit needs (not in git)

bunx remotion studio                         # preview every animation in the browser
bun run render:recap --fixture               # render one: out/Recap-tj-gee-2026-09-03.mp4
cd longform && uv run sesh-edit ~/Movies/waterhouse/in/interview.mov --review   # edit plan, no render
```

Before a PR: `bun run lint` and `bun run test`. The first `sesh-edit` run
downloads ~3.5 GB of models. Renders land in `out/` (gitignored). No tokens or
`.env` for the clips: every API they read is public.

## Where the docs are

| File | What it is for |
|---|---|
| [GETTING-STARTED.md](GETTING-STARTED.md) | first-time guide: install, where files go, what to ask, branch → PR → WhatsApp |
| [AGENTS.md](AGENTS.md) | instructions for coding agents: the rules, which tool for which task, conventions |
| this README, below | the Remotion reference: every composition, its flags, OBS setup, what the numbers mean |
| [longform/README.md](longform/README.md) | the sesh-edit reference: flags, pipeline, the GPU box, upscaling |
| [longform/docs/quality-and-upscaling.md](longform/docs/quality-and-upscaling.md) | why the upscaler is what it is |
| `public/audio/*/CREDITS.md` | where every tracked sound comes from and its licence |
| [docs/CONTENT_PLAN.md](docs/CONTENT_PLAN.md) | early planning notes, history only |

---

# Remotion reference

Remotion project that renders the vertical (1080×1920, 30 fps) clips Waterhouse
sends to artists and posts to stories, plus the landscape stingers and idents
for OBS and the edited Sessions videos. Everything renders from live data; no
design tool needed. Needs Bun and ffmpeg on the PATH (Remotion bundles its own
Chromium).

## The videos

| Video | What it is | Who gets it | Command |
|---|---|---|---|
| **ArtistRecap** ("Who Showed Up") | An artist's last N shows: who came, who stayed, who was new, plus a target to beat next time | One artist, within a day of their show | `bun run render:recap "Tj Gee"` |
| **HouseWeekly** | The week's board: every artist ranked by the crowd they brought, four badges, the 8-week house line, next week's lineup | The artist group chat, Monday morning | `bun run render:weekly-board --end 2026-09-03` |
| **PullUp** | 10 s looping "I'm on tonight, pull up" clip per event. A shared booking - two or more artists on one reservation - gets a single clip led by the event title, with everyone on the bill in the stream window | Artists forward it to friends before a show | `bun run render:pullup` |
| **WaterhouseSession** | 10 s looping clip for the Tuesday "Waterhouse Sessions" night: the guest and Denzo side by side in the stream window, with the running order ("interview with Denzo, then live set") under it | The guest forwards it to friends before the session | `bun run render:session` (guests from the booking) or `--guest "Duncen"` |
| **WeeklyLineup** | This week's lineup as a story | Instagram story | `bun run render:weekly` |
| **SessionBumper** | A library of ready-made 3–4 s stingers that open onto a live scene. Landscape, webm with alpha, eight ideas: "door", "corner", "lamp", "paper", "neon", "vhs", "fader" and "flap". (The Sessions intro itself is Fuse, see [Idents](#idents-fuse--the-sessions-intro).) | OBS, as a Stinger transition into any scene | `bun run render:bumper --idea door` |
| **Idents** (`src/ident/`) | Channel idents with alpha, portrait and 16:9. **Fuse is the Waterhouse Sessions intro**; FuseLines are three alternatives. See [Idents](#idents-fuse--the-sessions-intro) | Opening edited Sessions videos (sesh-edit bundles Fuse), OBS | `bun run render:ident Fuse-16x9` |

Output lands in `out/` (gitignored). A clip takes 1–2 minutes to render.
Renders are never committed: to see what a composition looks like, render it
(`bun run render:recap --fixture` needs no network) or open `bun run dev`.

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
bun run render:bumper --idea neon                   # out/Bumper-neon.webm
bun run render:bumper --idea vhs                    # out/Bumper-vhs.webm (burns in today's date)
bun run render:bumper --idea fader                  # out/Bumper-fader.webm
bun run render:bumper --idea flap                   # out/Bumper-flap.webm
bun run render:bumper --idea door --guest "Duncen"  # card reads "with Denzo and Duncen"
bun run render:bumper --idea door --idle            # out/Bumper-door-idle.webm, loopable
bun run render:bumper --idea corner --strip         # also out/Bumper-corner-frames.png
bun run render:bumper --idea door --matte           # out/Bumper-door-matte.mp4, Track Matte fallback
bun run render:bumper --idea door --format prores   # out/Bumper-door.mov, ProRes 4444 with alpha, for editing
```

A library of ready-made stingers: eight finished ideas to pick from, each
one OBS Stinger transition. None of them is the Sessions intro: Dean chose
**Fuse** for that (see #28), so these are kept as stock for other scenes and
shows.

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
- **neon** (120 frames, 4 s): night, rain on a dark plaster wall, a wet
  street below. The mark is a neon sign: lime tubes (white core, two
  blurred glows) that strike one by one - house f8, beam A f18, beam B f26,
  pillar f34 - each with three to five seeded dropouts before it holds, a
  warm pool of light on the wall around every lit tube, a tick and a
  transformer buzz that steps up per tube. "WATERHOUSE SESSIONS" strikes in
  purple at f44, "with Denzo" as a small white tube at f52. The puddle shows
  the whole sign inverted, warped by the water (a displacement map stepped
  on twos) and broken by raindrop rings that drip. Hold f60–72 with beam B
  buzzing out for two frames every ~20. The camera tilts down f72–100: the
  wall slides out the top, the puddle fills the frame, the rings calm and
  the reflection fades, leaving water. From f100 one last ring expands out
  of frame and the water inside it is the live scene. Fully transparent
  from f112.
- **vhs** (125 frames, 4.2 s): a black CRT with scanlines, a barrel
  vignette and a whisper of static. A hand (the same silhouette as paper)
  brings a labelled cassette up from the bottom edge - "WATERHOUSE SESSIONS
  — w/ DENZO" in marker, a touch crooked, the hand trembling on twos - the
  camera punches in at f24 and the cassette drops into the VCR with a motor
  and a clunk. Blue screen at f30, "PLAY ▶" top-left with a chroma offset,
  tracking bars sweep up, hiss starts, and the tape's own intro plays from
  f40: the mark in white, 3 px tape wobble row by row, red/cyan bleed, head-
  switching noise in the bottom 12 rows, a dropout line every ~15 frames,
  the burnt-in date bottom-right. "with Denzo" fades up at f58. Hold f70–82.
  Then the picture rolls a full screen height (f82–92), heavy bands,
  "TRACKING" blinking, a 6-frame snow burst at f94, and from f100 the
  tracking locks in three sweeps bottom to top, each leaving the live scene
  behind a jagged, snowy edge; the scanlines and vignette go with them.
  Fully transparent from f118.
- **fader** (120 frames, 4 s): overhead view of one channel strip of a
  mixing desk. Denzo's hand comes in (f2–8) and pushes the fader up
  (f8–40, a small overshoot and settle at the end stop); each quarter of
  the throw unmutes a channel whose LED lights one piece of the mark on a
  dot-matrix panel, with an LED click per piece. The VU needle swings,
  "WATERHOUSE SESSIONS" scrolls in under the mark at f40, ON AIR lights at
  f48 with three dropouts and a relay clunk, and "with Denzo" hard-cuts in
  at f52. Hold f56–60. The hand moves to PLAY and presses it at f68 (clunk,
  white flash, 3 % punch-in), and the camera pushes into the panel
  (f72–96) while a rise builds. From f84 the lit dots are holes onto the
  live scene; from f90 every dot grows in rings from the centre until they
  merge. Fully transparent from f106.
- **flap** (125 frames, 4.2 s): a split-flap departure board. From f8 the
  mosaic flips column by column through greys into the mark; at f44–45 the
  two character rows clatter through letters to spell "WATERHOUSE
  SESSIONS" / "WITH DENZO", one clack per landed tile over a fluorescent
  hum. One tile (the second S of SESSIONS) sticks on the wrong letter and
  corrects itself at f72 with a double clack. From f84 every flap turns
  once more in a diagonal wave from the top left, and the other side of
  each flap is the live scene. The schedule is `src/bumper/flap-plan.ts`.
  Fully transparent from f110.
- `--idle` renders the state to loop before the stinger: door, the open-door
  card held for 2 s with the camera still drifting (the scene already shows
  through the doorway); corner, the drift up to the corner (f0–46; it
  restarts from the centre, so it is a cut, not a seamless loop); lamp, the
  lit mark with the lamp micro-swaying and the moth circling; paper, the
  finished sheet, boiling on twos; neon, the lit sign held in the rain with
  the rings and beam B's buzz still going; vhs, the tape intro held,
  wobbling, hissing and dropping out; fader, the strip with the fader up,
  the needle dancing to the music and ON AIR breathing; flap, the finished
  board with one tile rattling.
- Timing constants are in one block at the top of `src/bumper/Door.tsx`,
  `Corner.tsx`, `Lamp.tsx`, `Paper.tsx`, `Neon.tsx`, `Vhs.tsx` and `Fader.tsx`
  (the split-flap's live in `flap-plan.ts`); change a frame number there,
  nothing else needs touching. If a split-flap timing changes, re-run
  `bun run gen:audio:bumper` so the baked clack cascade follows it. The corner's drift is solved from the bounce frames so it always
  lands exactly on the corner frame (`src/bumper/corner-plan.ts`).
- In the Studio, tick `preview` to see a checkerboard where the scene will
  be; it is never part of a render. `SessionBumperStrip` is the contact sheet
  the `--strip` flag renders.
- The bumper one-shots (creak, hum, thump, tap, rustle, reversed cymbal;
  rain, buzz, neon tick, drip; clunk, motor, hiss, seek, snow; fader,
  led-click, relay, rise; clack, flap-cascade, fluoro) are in
  `public/audio/bumper/`, derived from the existing kits or synthesised by
  `bun run gen:audio:bumper`; see `public/audio/bumper/CREDITS.md`.

**OBS setup (Stinger transition).** Settings → Transitions → add *Stinger*.
Video File: `Bumper-door.webm` (or corner / lamp / paper / neon / vhs / fader / flap).
Transition Point Type: *Frame*; Transition Point: **64** for door (the
push), **70** for corner, **84** for lamp (the thump, as the white takes
over), **84** for paper (the grab, before the lift), **100** for neon (the
puddle has filled the frame, the last ring starts), **100** for vhs (the
snow ends, the first tracking sweep), **84** for fader (the lit dots open
into the stream as the camera pushes in) and **84** for flap (the first tile
of the diagonal wave flips to transparent) - the frame the reveal starts, so the new
scene is already live behind it when the card opens. Audio: the webm carries the sounds on its own track, so set
Audio Monitoring to *Monitor and Output* if they should reach the stream,
and Audio Fade Style to *Fade out to transition point*. Leave *Track Matte*
off: the webm's alpha does the reveal. Then pick it as the transition into
the "Waterhouse Sessions" scene.

**Track Matte fallback.** If OBS plays the webm without transparency (an
older build, or hardware decoding that drops VP9 alpha), render the matte
version instead: `--matte` writes an opaque 3840×1080 mp4 with the bumper
over black on the left and its alpha as a luma matte on the right. The
sound comes from the left half only (the matte copy is muted). In the
Stinger settings tick *Use a Track Matte*, Matte Layout *Same file, side by
side*, left fill / right matte, same transition point.

### Idents (Fuse = the Sessions intro)

Channel idents ported from the nb-bumpers prototype into `src/ident/` (#28).
In Studio they sit under **Idents**, with **Idents › Sessions-intro** at the
top. **Fuse is the Waterhouse Sessions intro:** the scope beam draws the mark,
then it is scratched on a record. FuseLines are three alternatives with a
redrawn beam. The other 24 are the prototype's other ideas, kept as stock.

| Idea | Comp ids | What it is |
| --- | --- | --- |
| Fuse | `IdentFuse`, `IdentFuse-16x9` | **the Sessions intro** (5 s) |
| FuseLines-Ink | `IdentFuseLines-Ink`, `IdentFuseLines-Ink-16x9` | Fuse with the beam as an ink line after the Waterhouse Radio poster, Denzo 4 semitones lower |
| FuseLines-Wave | `IdentFuseLines-Wave`, `IdentFuseLines-Wave-16x9` | the ink line with wave echoes, Denzo 7 semitones lower |
| FuseLines-Draft | `IdentFuseLines-Draft`, `IdentFuseLines-Draft-16x9` | the ink line as a draughtsman's drawing, Denzo 12 semitones lower |

The other ideas (only those with a 16:9 id have a landscape layout):

| Idea | Comp ids | What it is | Sound and data from |
| --- | --- | --- | --- |
| Cymatics | `IdentCymatics`, `IdentCymatics-16x9` | white sand on a speaker-driven plate runs into Chladni figures, then into the mark | `cymatics/gen-audio.py (+ timeline.ts)` |
| Deadpan | `IdentDeadpan` | typed mono lines, a browser selection, DELETE, a slammed title card | shared kits in `public/audio/` |
| Drop | `IdentDrop` | physics comedy: the title and the mark land on a ledge as heavy blocks, then a trapdoor drops them | shared kits in `public/audio/` |
| Extrude | `IdentExtrude` | the brutal offset shadow extrudes into a 3D block | shared kits in `public/audio/` |
| Feedback | `IdentFeedback`, `IdentFeedback-16x9` | a camera pointed at its own monitor; kicks push the feedback into a tunnel | `feedback/gen-audio.py` |
| Fracture | `IdentFracture` | the mark chiselled out of a board-formed concrete slab | `fracture/gen-audio.py, gen-texture.py (concrete.png)` |
| Groove | `IdentGroove`, `IdentGroove-16x9` | Scope's Lissajous resolves into a spinning record, then Platter's second half | `groove/gen-audio.py (+ motion.ts)` |
| Laser | `IdentLaser`, `IdentLaser-16x9` | a club laser show in haze; the projector draws the mark | `laser/gen-audio.py` |
| Louvre | `IdentLouvre` | a wall of metal fins turns in waves to reveal the mark | `louvre/gen-audio.py` |
| Monolith | `IdentMonolith` | Extrude remade serious: dark concrete slabs under one raking light | `monolith/gen-audio.py` |
| Morph | `IdentMorph` | a black square bounces, splits and morphs into the logo pieces on the beat | shared kits in `public/audio/` |
| Phosphor | `IdentPhosphor`, `IdentPhosphor-16x9` | Scope's beam becomes Platter's record without a cut | `phosphor/gen-audio.py (+ motion.ts)` |
| Pinscreen | `IdentPinscreen` | a wall of machined pins presses the mark out in relief | `pinscreen/gen-audio.py` |
| Platter | `IdentPlatter`, `IdentPlatter-16x9` | a record under a booth light; the DJ scratches the mark on the label | `platter/gen-audio.py (+ motion.ts)` |
| Popup | `IdentPopup` | the mark as a paper pop-up book | shared kits in `public/audio/` |
| Press | `IdentPress` | the site's button is the ident: a card pops, the logo pieces land on the beat | shared kits in `public/audio/` |
| Scope | `IdentScope`, `IdentScope-16x9` | an oscilloscope beam draws the mark; the sound is the XY signal | `scope/gen-audio.py` |
| Slice | `IdentSlice` | knife cuts split a stack of cut paper, showing its coloured layers | shared kits in `public/audio/` |
| Spectro | `IdentSpectro`, `IdentSpectro-16x9` | the mark hidden in the spectrogram of the sound | `spectro/gen-audio.py (+ tape.png, data.ts), then gen-wide.py (wide-data.ts)` |
| Splice | `IdentSplice`, `IdentSplice-16x9` | Scope's first half, hard-cut on the big kick into Platter's second half | `splice/gen-audio.py (+ motion.ts)` |
| Stamp | `IdentStamp` | a riso press: misregistered ink passes snap into register | shared kits in `public/audio/` |
| Strobe | `IdentStrobe` | the mark cut out of a black wall, a club strobe behind it | `strobe/gen-audio.py` |
| Tile | `IdentTile` | the mark multiplies into brand wallpaper, then a dive through one door | shared kits in `public/audio/` |
| Xerox | `IdentXerox` | an underground techno flyer coming off a photocopier | `xerox/gen-audio.py` |

Every comp also has a `-preview` twin over stand-in footage (a Sessions
thumbnail). The others are alpha: transparent wherever the content shows through.

```
bun run render:ident Fuse-16x9          # the intro, 16:9
bun run render:ident --intro            # Fuse + FuseLines, both cuts
bun run render:ident Fuse --only prores # just the editing master
bun run render:ident Scope Scope-16x9   # any other ident, by its id without "Ident"
bun run render:ident --all              # every ident (long: GPU box)
```

Each comp writes three files to `out/ident/`: `Ident<Id>-preview.mp4` (H.264,
to watch), `Ident<Id>.mov` (ProRes 4444 with alpha, for editing) and
`Ident<Id>.webm` (VP9 with alpha, for an OBS stinger). The alpha files are
checked with ffprobe. Full renders are heavy, so run them on the GPU box.
Rendered files never go in git.

**sesh-edit's intro.** The intro that sesh-edit prepends,
`longform/src/sesh_edit/assets/intro/fuse-16x9.{webm,flac,json}`, is built from
Fuse 16:9 (`IdentFuse-16x9`) by `bun run render:intro` (gitignored; run it once
on a fresh clone, and after changing Fuse). It renders the ProRes master with
`render:ident`, encodes the webm and flac, and writes `open_s` (frame 118 / 30).
If the frame where the rings open moves, update `OPEN_FRAME` in
`scripts/render-intro.ts`. `--reuse` skips the render if the `.mov` exists.

**Sound and timing.** Each soundtrack is synthesised by a Python generator
next to the code. The generator also writes the motion data the picture
reads. Both outputs are committed. After any timing change, re-run the
generator so picture and sound stay locked:

```
uv run src/ident/splice/gen-audio.py        # public/ident/audio/splice/mix.wav (Fuse's soundtrack) + src/ident/splice/motion.ts
uv run src/ident/fuselines/gen-audio.py 4   # public/ident/audio/fuselines/mix-4.wav (also 7, 12)
```

The other generators are in the table above, all run the same way
(`uv run src/ident/<idea>/<script>.py`). Spectro's `gen-wide.py` reads the mix
`gen-audio.py` writes, so run them in that order. Ideas without a generator
use the tracked sound kits in `public/audio/{bumper,pullup,recap}/`.

The generators carry uv inline-script headers (numpy, plus Pillow for Spectro
and the Fracture texture), so `uv run` fetches what they need. Never pip-install into
the system Python. The scratch voice is `src/ident/scratchkit/denzo-waterhouse.wav`:
Denzo saying "Waterhouse", cut from the published Sessions video (YouTube
mWNWTIGghjc). Ident-owned media lives in `public/ident/`. `public/audio/` stays
for the other videos' sounds.

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
and [#11 here](https://github.com/JollyGrin/waterhouse-video/issues/11).

## Media for local compositions

Some compositions play footage that is too large or too private for git
(`public/session/`, `public/reel/` and `public/fort-riddim/` are gitignored).
On a fresh clone they show a "Missing media" card naming each missing file
instead of failing with a 404. Once the files are in place they render
normally.

| Composition | Needs (under `public/`) | Where it comes from |
|---|---|---|
| SessionOpen | `session/head.mp4` | the first 5 s of a finished episode, cut with ffmpeg (AGENTS.md, "Session logo reveal") |
| SessionClose | `session/tail.mp4` | the last 5 s, same way |
| SessionReel | `reel/<slug>-cut.mp4` (the `cutFile` in `src/reel/data/current.json`) | `bun run reel src/reel/data/<slug>.reel.json`, lifted out of a cut episode (from sesh-edit: `<name>.clean.mp4`; see AGENTS.md, "Reels") |
| FortRiddim | `fort-riddim/c1m.mp4`, `c1fx.mp4`, `c2fx.mp4`, `c3m.mp4`, `c3fx.mp4`, `soundtrack.wav`, `logo-white.png`, `poster/{boogie,disc,top,lineup,info}.png` | clips and soundtrack: `bun scripts/fort-riddim/make.ts --c1 IMG_2250.MOV --c2 IMG_2253.MOV --c3 IMG_2246.MOV` (or `FORT_RIDDIM_C1/_C2/_C3`) from Manuel's phone footage; logo and poster cut-outs: copied in by hand from the FORT RIDDIM poster artwork |
| FortRiddimPromo | `fort-riddim/promo.mp4` | `bun run promo --source FORTRIDDIMPROMO.MP4` (or `FORT_RIDDIM_PROMO_SRC`), Manuel's disc animation |
| FortRiddimShowcase | `fort-riddim/promo.mp4` | as FortRiddimPromo; `bun run showcase --source FORTRIDDIMPROMO.MP4` |

Ask whoever made the cut for the files, or regenerate them from the sources
with the commands above.

## macOS-only steps

Everything renders on macOS, Linux and Windows except these, which call
macOS tools:

- **Poster photo prep** (`bun run poster`, `bun run covers`):
  `scripts/cutout.swift` uses the Vision framework and needs **macOS 14+**
  with the Xcode command line tools (`swift`). It lifts the subject out of
  photos without transparency (a photo that already has an alpha channel
  skips this) and always runs face detection on the cut-out to frame it, so
  these two scripts only run on a Mac. Rendering the `SessionPoster`
  composition itself works anywhere.
- **Music bed picker** (`scripts/pick-track.ts`): AIFF tracks are decoded
  with macOS `afconvert` first (Remotion's bundled ffmpeg has no AIFF
  demuxer). mp3, wav and flac work anywhere. ffmpeg is taken from PATH,
  else Remotion's bundled copy.
- **Scheduled cover sync**: `scripts/contrib/covers-cron.sh` is an example
  launchd wrapper (notifications via `osascript`). Use your OS scheduler to
  run `bun scripts/sync-covers.ts` elsewhere.

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
src/bumper/                 SessionBumper: Door/Corner/Lamp/Paper/Neon/Vhs/Fader/Flap.tsx, Logo.tsx, logo-sample.ts, flap-plan.ts, fx.ts (tests)
src/audience/schema.ts      zod props schemas: the contract between data and video
src/audience/metrics.ts     every definition above, with tests (bun run test)
src/audience/fixtures/      real-data examples the compositions preview with
scripts/fetch-audience.ts   live data -> props JSON
scripts/render-*.ts         one per video
public/audio/recap/         shared sound kit for the recap videos (README inside)
public/audio/pullup/        PullUp soundtrack (WaterhouseSession uses it too)
```

Preview any composition in the Remotion studio with `bun run dev`.

## Changing things

- **A number looks wrong.** Run `bun run fetch:audience ...` and read the
  JSON before touching the video. The thresholds (30 days, 90 days, one
  third, 30 minutes) are named constants at the top of
  `src/audience/metrics.ts`, and `bun run test` covers each rule.
- **Copy or layout.** Edit the composition file. Beat frame ranges are
  constants at the top of each.
- **Sound.** `public/audio/recap/README.md` explains each file and the level
  plan. Rebuild the kit with `bun run gen:audio:recap`.
- **Refresh the example fixtures from live data.**
  `bun run fetch:audience --fixtures`.
- **Before a PR.** `bun run lint` and `bun run test`. Then push the branch,
  open the PR into `main`, and WhatsApp Dean (see [The rules](#the-rules)).

Design spec with storyboards (Dean's Claude artifact, not public):
https://claude.ai/code/artifact/e0a9d74d-6af7-41cd-8baf-5b5b88ef78c6
