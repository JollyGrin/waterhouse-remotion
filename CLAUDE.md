# CLAUDE.md

Instructions for coding agents (Claude Code, Codex, ...) working in this repo.
`AGENTS.md` is a symlink to this file. The people asking are mostly
non-developers who type requests and never edit code by hand. Their guide is
[GETTING-STARTED.md](GETTING-STARTED.md): read it so your answers match it.

## Pick the tool first

Two tools live here. **Animation and clip generation → Remotion (repo root,
Bun).** **Editing recorded video → sesh-edit (`longform/`, uv).** They never
substitute for each other: don't cut an interview in Remotion, and don't make
graphics in sesh-edit.

| If the task is... | Use | Run (from the repo root unless it says `cd longform`) | Output |
|---|---|---|---|
| Promo clip for an event ("pull up tonight") | Remotion `PullUp` | `bun run render:pullup --all` (every approved event in the next 7 days, no prompts), then point the user at the clip they asked for. The picker without `--all` is interactive and can't be piped | `out/PullUp-<name>-<date>.mp4` |
| Clip for a Tuesday Waterhouse Session | Remotion `WaterhouseSession` | `bun run render:session [--date YYYY-MM-DD] [--guest "Name"]`; flags in README | `out/Session-<guest>-<date>.mp4` |
| Weekly lineup story | Remotion `WeeklyLineup` | `bun run render:weekly`. **Interactive** (two prompts: token, then which events) and it can't be driven from a pipe, so ask the user to run it in their own Terminal and press Enter twice (public endpoint, all events) | `out/WeeklyLineup-<date>.mp4` |
| Weekly board (ranked by crowd, badges) | Remotion `HouseWeekly` | `bun run render:weekly-board [--end YYYY-MM-DD]` | `out/HouseWeekly-<YYYY-Www>.mp4` |
| Artist recap ("who showed up") | Remotion `ArtistRecap` | `bun run render:recap "Stage Name" [--n 6]`; `--fixture` for no network | `out/Recap-<artist>-<date>.mp4` |
| Session poster / cover | Remotion `SessionPoster` / `SessionPosterType` | `bun run poster --name "Name" --date D.M.YYYY [--photo path-or-url] [--session N]`. No photo = type-only cover. A poster with a photo needs macOS 14+ (cut-out and face detection via Vision, README "macOS-only steps"); the type-only cover renders anywhere. All covers: `bun run covers`. On a fresh clone run `mkdir -p posters` first, or it renders the PNG and then fails saving `posters/state.json` | `out/posters/session-<nr>-<slug>.png` |
| Idents / Sessions intro (**Fuse is the Sessions intro**; FuseLines-Ink/-Wave/-Draft are alternatives) | Remotion `IdentFuse` / `IdentFuse-16x9` etc. in `src/ident/` (Studio: Idents › Sessions-intro) | `bun run render:ident Fuse-16x9` (one comp), `--intro` (Fuse + FuseLines, both cuts), `--only preview,prores,webm`. `render:ident <Id>` for any of the other 24 idents (list: README "Idents"), `--all` for every one. Full renders on the GPU box. To replace sesh-edit's bundled intro: README "Idents" | `out/ident/Ident<Id>-preview.mp4`, `.mov` (ProRes 4444 alpha, editing), `.webm` (VP9 alpha, OBS) |
| Stinger for OBS (transition into a scene) | Remotion `SessionBumper` | List the 8 ideas (door, corner, lamp, paper, neon, vhs, fader, flap) and offer contact sheets: `bun run render:bumper --idea <idea> --strip` also writes `out/Bumper-<idea>-frames.png` (every 10th frame). Then `bun run render:bumper --idea <idea>`. OBS settings and transition points: README "SessionBumper" | `out/Bumper-<idea>.webm` (alpha) |
| Instagram reel (9:16) from an interview | Remotion `SessionReel` | `bun run reel src/reel/data/<slug>.reel.json`. Needs a cut episode and word captions; see [Reels](#reels-from-an-edited-interview) | `out/reels/` |
| Edit a recorded Sessions interview (cut fillers, silences, pre-take chatter, A/V sync, mic mix, captions, intro) | sesh-edit | `cd longform && uv run sesh-edit <in> -o <out>.edited.mp4 --review` first, show the plan, then the same without `--review` | `<out>.edited.mp4`, `.srt`, `.decisions.json`, `.clean.mp4` |
| Fix captions or a misheard word | sesh-edit | `cd longform && uv run sesh-edit <in> -o <out>.edited.mp4 --replace Waterhose=Waterhouse` (cached, ~40 s). Or edit the decisions file and use `--from-decisions` | overwrites the edit |
| Manual cut, move the intro to the front, insert a clip, title card | sesh-edit | `--cut 20:03-20:29`, `--move-to-front`, `--insert-clip`, `--title-card` (times from the input file) | |
| Make the 1080p version | sesh-edit | `uv run sesh-upscale <out>.clean.mp4 -o <out>.clean.1080p.mp4 --method lanczos` (laptop, minutes) or `--method x4plus` (GPU box, hours), then `uv run sesh-overlay <out>.decisions.json <out>.clean.1080p.mp4 -o <out>.edited.1080p.mp4` | `<out>.edited.1080p.mp4` |
| Add or change the intro on an edited video | sesh-edit | Default intro is Fuse (bundled). `--intro FILE` for another alpha video, `--no-intro` for none. A new ident is made in Remotion first; see [Hand-off](#hand-off-remotion--sesh-edit) | |
| Session logo reveal (masked open/close) | Remotion `SessionOpen` / `SessionClose` | Needs `public/session/head.mp4` / `tail.mp4`; see [Session logo reveal](#session-logo-reveal) | |
| Change an animation's text, timing or colours | Remotion | Edit the composition in `src/`; the user previews in `bunx remotion studio` | |
| Just the audience numbers | script | `bun run fetch:audience artist "Name" --n 4` / `week --end YYYY-MM-DD` | JSON |

If a request doesn't fit, ask. Don't invent a third way to edit long-form
video: the TypeScript episode cut (`scripts/session/*`, `SessionEpisode`) was
retired in #31 for sesh-edit.

## Conventions

- **Bun only at the root.** `bun install`, `bun run <script>`, `bunx remotion
  ...`. Never `npm`, `npx`, `yarn` or `pnpm`.
- **uv only in `longform/`.** `uv sync`, `uv run sesh-edit ...`. Never `pip`.
- **The repo is public. Never commit media**: footage, photos, music,
  renders. Check `git status` before every commit and leave out any
  `.mp4/.mov/.webm/.wav/.mp3/.flac/.aiff/.jpg/.png` that isn't already
  tracked. The tracked exceptions are the sound kits in
  `public/audio/{bumper,pullup,recap}/` and the idents' generated inputs in
  `public/ident/` and `src/ident/` (WAVs from their `gen-audio.py`,
  `denzo-waterhouse.wav`). Renders, frame strips and stills
  never go in git (not even in `docs/`): they can be rebuilt, so give the
  command instead. `bun run test` fails if one is tracked under `docs/`,
  `out/` or `longform/docs/`.
- **Never push to `main`.** Work on a branch and open a PR with `gh pr create`.
  When a user says "save my changes", that's what they mean.
- Before a PR: `bun run lint` (eslint + tsc) and `bun run test` (it lists the root test files so `longform/` is never picked up); `bunx remotion
  compositions` must list everything. `longform/` has no test suite yet:
  check that `uv run sesh-edit --help` still runs.
- Non-developer users: tell them in plain words what you ran and the full
  path of what it wrote. Offer to open Studio or the file.

## Where media comes from and goes

| Media | Comes from | Lives (gitignored) |
|---|---|---|
| Raw interview recordings | Dropbox share links (`dl=0` → `dl=1`, keep `rlkey=`), the camera, OBS | `~/Movies/waterhouse/in/` on Macs, `C:\Users\masle\Videos\sesh-in\` on the GPU box |
| sesh-edit output | sesh-edit | `~/Movies/waterhouse/out/`, `C:\Users\masle\Videos\sesh-out\` |
| Artist photos, event data, audience numbers | the Waterhouse portal API (public), CDN URLs | fetched at render time; poster photos copied to `public/artists/` |
| Weekly music beds (copyrighted) | the music library folder in `weekly/state.json` | `public/audio/` (except the tracked kits) |
| Footage some compositions play | the person who made it | `public/session/`, `public/reel/`, `public/fort-riddim/`, `work/` |
| Renders | Remotion | `out/` |

A composition whose footage is missing shows a "Missing media" card naming
the file (`src/MissingMedia.tsx`). README "Media for local compositions" lists
what each one needs and where it comes from: tell the user, don't commit a
stand-in. Scheduled cover sync is an example launchd wrapper in
`scripts/contrib/covers-cron.sh` (macOS); elsewhere schedule
`bun scripts/sync-covers.ts` yourself.

## Which machine renders

- **Laptops** (Apple Silicon): all Remotion renders (a clip takes about 1
  minute), Studio, posters (a photo needs macOS 14+), sesh-edit
  `--review` and normal edits (MPS), the lanczos upscale.
- **GPU box** `desktop-02rit4k` (Windows 10, RTX 3070): the x4plus upscale
  (hours, Real-ESRGAN via Vulkan), and long encodes. Reach it through the T3
  linked environment **DESKTOP-02RIT4K**, or `ssh gpu` from Dean's Mac
  (PowerShell: chain with `;`, never `&`). Transcription there is CPU-only, so
  slower than on a Mac. Run long jobs from a T3 thread on the box.
- If a user's laptop is struggling with an upscale or a long encode, offer
  the GPU box. Don't start an x4plus upscale on a laptop.

## Repo map

```
CLAUDE.md, AGENTS.md     this file (AGENTS.md is a symlink)
GETTING-STARTED.md       the first-time guide for teammates
README.md                Remotion details: every composition, its flags, OBS setup, metric definitions
src/Root.tsx             every Remotion composition is registered here
src/PullUp.tsx, WaterhouseSession.tsx, WeeklyLineup.tsx, ArtistRecap.tsx, HouseWeekly.tsx
src/SessionPoster*.tsx   posters (src/poster/: mark, grain)
src/bumper/              SessionBumper stingers (one file per idea; timing constants at the top)
src/ident/               idents incl. Fuse, the Sessions intro (ids.ts = catalogue, Idents.tsx = Studio registrations, */gen-audio.py = soundtrack + motion generators, run with uv)
src/session/             Tuesday session plan (plan.ts) + session graphics: LogoReveal (SessionOpen/Close), WhMark, Captions, theme
src/reel/                SessionReel (9:16 reel), ReelCaptions, theme (crop boxes per speaker), data/*.reel.json
src/fort-riddim/         FORT RIDDIM promo, showcase and reel (one-off, Manuel)
src/audience/            metrics + schemas for recap and board (tests: bun run test)
scripts/render-*.ts      one render script per video
scripts/make-poster.ts, sync-covers.ts, cutout.swift   posters
scripts/reel/make-reel.ts                              reel cut + render
longform/                sesh-edit (Python, uv): the long-form editor; its README is the reference
out/, work/              renders and intermediates (gitignored)
```

## Hand-off: Remotion → sesh-edit

Idents and intros are **made** in Remotion and **composited** by sesh-edit.

(Step 1 is tested. Steps 2–3 follow `longform/README.md` but haven't been
run end to end yet: that needs a real edit with the models downloaded.)

1. Render the ident with alpha. For a 16:9 bumper:
   `bun run render:bumper --idea door --format prores` → `out/Bumper-door.mov`
   (ProRes 4444 with alpha and sound).
2. Tell sesh-edit where the interview should start showing through: write
   `out/Bumper-door.json` containing `{"open_s": 2.133}` (the OBS transition
   point frame ÷ 30; door is frame 64). Without it, sesh-edit uses the first
   frame that isn't fully opaque.
3. `cd longform && uv run sesh-edit <in> -o <out>.edited.mp4 --intro ../out/Bumper-door.mov`.
   sesh-overlay reuses that intro for the 1080p version.

The default intro, **Fuse**, is already bundled in sesh-edit
(`longform/src/sesh_edit/assets/intro/fuse-16x9.{webm,flac,json}`). It was
rendered from the Remotion comp `IdentFuse-16x9` (`src/ident/Fuse.tsx`).
To change it, re-render with `bun run render:ident Fuse-16x9 --only prores`
and rebuild the bundled files as README "Idents" describes. See the "Intro" section of
`longform/README.md` for how the audio is levelled and captions held back.

## Session logo reveal

`SessionOpen` and `SessionClose` (`src/session/LogoReveal.tsx`) show the first
and last 5 seconds of a finished episode masked inside the Waterhouse mark.
They read `public/session/head.mp4` and `tail.mp4`. Cut those from an edited
video with ffmpeg:

```sh
mkdir -p public/session
ffmpeg -i <episode>.mp4 -t 5 -c:v libx264 -crf 16 -c:a aac public/session/head.mp4
ffmpeg -sseof -5 -i <episode>.mp4 -c:v libx264 -crf 16 -c:a aac public/session/tail.mp4
```

Then `bunx remotion render SessionOpen out/session-open.mp4`. Joining the
reveal onto a full episode was done by the retired `make-bookends.ts`; the
episode's intro is now sesh-edit's job.

## Reels from an edited interview

`SessionReel` crops a wide two-shot to 9:16, cuts between the speakers and
lays karaoke captions on. `scripts/reel/make-reel.ts` builds it from a reel
definition (`src/reel/data/<slug>.reel.json`):

- `source`: a cut episode **without** burned-in captions. From sesh-edit that
  is `<name>.clean.mp4`.
- `captions`: a JSON array of words `{t, d, w, br}` (start s, duration s,
  text, line break after) timed to `source`.
- `segments`: the spans to use, in `source` time, each with a `shot` from
  `src/reel/theme.ts` (crop boxes per speaker; add one for a new room
  layout).

The two checked-in reels were made from the retired TypeScript cut, whose
`work/<slug>/master.mp4` and `captions.json` stay on the machine that made
them. **sesh-edit doesn't write the `captions` file yet.** Its word timings are
in `<name>.work/transcript.json` (input time) and the cut map is
`keep_segments` in `<name>.decisions.json`; converting them is a small
script that hasn't been written. Until then, do it by hand for the user and
say so. The composition itself, and the checked-in `current.json`, keep
working: on a machine without `public/reel/<slug>-cut.mp4` it shows the
missing-media card.

## sesh-edit (`longform/`)

The full reference is `longform/README.md`. What matters most when driving it:

- **Setup:** `cd longform && uv sync` (Python 3.12, pinned). ffmpeg on PATH.
  The `claude` CLI must be logged in: the LLM steps call `claude -p`
  headless, no API key. First run downloads ~3.5 GB of models.
- **Always `--review` first** for a new file, and show the user the review
  list (restarts, bad takes, chatter, out-of-order intros). Those are never
  auto-cut; act on the user's answer with `--cut`, `--move-to-front`, etc.
- **Times** for `--cut`, `--move-to-front`, `--insert-clip` and
  `--title-card` are input-file times (`20:03` or `20:03.5`), like the review
  list. Edges snap to the quietest point between words.
- **Re-runs are cheap** (~40 s): the transcript, silences and A/V analysis
  are cached in `<name>.work/`. `--force` recomputes them.
- **`--from-decisions <file>`** renders straight from a (possibly
  hand-edited) decisions file without recomputing: delete a cut, nudge
  `keep_segments`, change `av_offset.applied_s`.
- **Outputs:** `<name>.edited.mp4` (intro + interview, captions burned in),
  `<name>.clean.mp4` (same cut, no intro or captions: the upscale and reel
  input), `<name>.edited.srt`, `<name>.decisions.json`.
- **1080p:** upscale the clean cut (`sesh-upscale`), then `sesh-overlay`
  draws captions, title cards and the intro at 1080p. x4plus is resumable:
  re-run the same command. `sesh-upscale --status <work-dir>` shows progress.
- **Tunables** (silence thresholds, filler list, caption style) are in
  `longform/src/sesh_edit/plan.py` (`Params`) and `captions.py` (`Style`).
  Prefer flags over editing them.
