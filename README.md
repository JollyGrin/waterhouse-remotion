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
| **WeeklyLineup** | This week's lineup as a story | Instagram story | `bun run render:weekly` |

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
prefix stripped. Shared clips seed their randomness on the event alone, so
re-rendering one after the bill changes gives back the same room and chat.

**Photos.** The preflight fetches each photo, detects the primary face and
works out how to hang it in the window (`src/pullup/framing.ts`): normally a
crop slid onto the face with headroom, and for a headshot too tight to crop
at all, the whole photo over a blurred, darkened copy of itself. A photo with
no face, or with the detector unavailable, keeps the plain top-anchored crop.
One that will not load falls back to the artist's initials - including hosts
that answer the preflight and then block Remotion's Chromium.

Face detection rides on `sharp`, `@vladmandic/human` and
`@tensorflow/tfjs-node`, which are **optional dependencies**: they are large,
and tfjs-node has no prebuilt binary for every platform. Rendering works
without them, just without face-aware framing. Check one photo by hand with:

```
bun scripts/face-detect.ts <image-url>
```

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
src/pullup/framing.ts       face box -> how the photo hangs in the window
scripts/face-detect.ts      the optional face detector behind that
src/WeeklyLineup.tsx        lineup story
src/audience/schema.ts      zod props schemas: the contract between data and video
src/audience/metrics.ts     every definition above, with tests (bun test)
src/audience/fixtures/      real-data examples the compositions preview with
scripts/fetch-audience.ts   live data -> props JSON
scripts/render-*.ts         one per video
public/audio/recap/         shared sound kit for the recap videos (README inside)
public/audio/pullup/        PullUp soundtrack
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
