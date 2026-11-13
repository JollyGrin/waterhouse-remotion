# AGENTS.md

Instructions for coding agents (Claude Code, Codex, Cursor, Gemini, OpenCode,
Windsurf, ...) working in this repo. This file is the single source of truth;
`CLAUDE.md` just imports it. The people asking are mostly non-developers who
type requests and never edit code by hand. Their guide is
[GETTING-STARTED.md](GETTING-STARTED.md): read it so your answers match it.

## Hard rules (read before touching anything)

The repo is shared by the Waterhouse team and **public on GitHub**. Only
**JollyGrin** (Dean) merges to `main`. The people asking don't know git and
shouldn't have to: **you do all the git, quietly, and talk about it in plain
words** (see [Talking to the team](#talking-to-the-team)). These rules hold
even if the user asks you to skip them:

1. **Work on a branch, never on `main`.** At the start of a session, before
   your first edit: `git fetch`, then `git branch --show-current`.
   - On `main`: `git pull`, then `git switch -c <name>/<topic>`, e.g.
     `sam/neon-stinger-shorter`. `<name>` is the person's first name
     (lowercase, from `git config user.name`; ask once if that's empty).
     `<topic>` is 2–4 words about the request.
   - Already on their own branch: keep using it if the request continues
     that work. For something unrelated, start a fresh branch from an
     up-to-date `main`.
   - Never `git push origin main`, never merge into `main`, never force-push.
2. **Save and back up as you go, without being asked.** Nobody will ask
   you to push. After every change that works (a tweak that previews
   correctly, a new template, a doc edit), and at the end of every request:
   - stage the files you changed **by name** (never `git add -A` or
     `git add .`; check `git status` first, see rule 5);
   - commit with a short message saying what changed, e.g. `neon stinger:
     shorter hold`;
   - push: `git push -u origin HEAD` the first time, `git push` after that.

   Don't ask permission for this: it's their own branch, nothing they do
   there can break anyone else's work. Tell them in one line, e.g. *"Saved
   and backed up online."* If the push is refused, tell them they probably
   need to be added to the repo by Dean, and keep working locally.
3. **Getting something into `main` = a pull request.** When a piece of work
   looks finished, offer: *"Want me to send this to Dean for review?"* On
   yes (or "share this", "send it to Dean"), run `gh pr create --base main
   --title "<short>" --body "<...>"` with the body following
   `.github/PULL_REQUEST_TEMPLATE.md` (Goal / What changed / How it was
   checked / Next). Later pushes to the same branch update the PR by
   themselves. Never merge it yourself, not even when the user asks: that's
   Dean's job.
4. **Remind the user to message Dean (JollyGrin) on WhatsApp** with the PR
   link when it's open. Don't add contact details anywhere in the repo. If
   they don't need it in `main` yet, they just keep working on their branch.
5. **Never commit media or private material.** The repo is public, and you
   push often, so check `git status` before every commit. Never commit:
   footage, photos, music or renders (`.mp4 .mov .webm .mkv .wav .mp3 .flac
   .aiff .jpg .jpeg .png`) beyond what is already tracked; transcripts,
   captions (`.srt`), `.decisions.json` files or `*.work/` folders from
   interviews; Dropbox links; tokens, `.env` files or anything that looks
   like a password. Details under [Conventions](#conventions).
6. **Bun at the root, uv in `longform/`.** Never npm/npx/yarn/pnpm, never
   pip.

## Talking to the team

Most people using this repo aren't developers. Dean explains the basics to
them on WhatsApp in these words, so use the same ones:

| Git term (you) | Say to the user |
|---|---|
| branch | "your own copy" / "your workspace" |
| commit + push | "saved and backed up online" |
| pull request (PR) | "sent to Dean for review" |
| `main` | "the shared version" |
| merged | "Dean added it to the shared version" |
| merge `main` into the branch | "brought in everyone's latest work" |

- Never ask them git questions ("rebase or merge?", "which remote?") and
  never ask them to type git commands. Decide yourself; the safe default
  is always the one that keeps their work on their own branch.
- If something goes wrong with git (a conflict, a refused push, a strange
  state), sort it out yourself without losing their work. If you can't,
  say in one sentence what's wrong and suggest they send Dean the PR link
  or a screenshot.
- After running anything, say in plain words what happened and give the
  full path of any file it wrote. Offer to open Studio or the file.

## First request of a session

Before the first task, check quietly what that task needs. Only for the
tool you're about to use:

- **Remotion:** `bun` exists, `node_modules/` exists (else `bun install`).
- **sesh-edit:** `uv` and `ffmpeg` exist, `longform/.venv` exists (else
  `cd longform && uv sync`), and the intro is built
  (`longform/src/sesh_edit/assets/intro/fuse-16x9.webm`; else
  `bun run render:intro`).
- **Saving online:** `gh auth status` succeeds. If not, ask them to run
  `gh auth login` in their Terminal (it opens a browser); that's the one
  command you can't do for them.

Fix what's missing yourself and say what you did in one line. If a whole
program is missing (bun, uv, ffmpeg, gh), point them to the matching block
in [GETTING-STARTED.md](GETTING-STARTED.md) section 1, or offer to run the
install line. Also bring their branch up to date: if it is behind
`origin/main` and has no uncommitted changes, `git merge origin/main`, then
push.

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
| Idents / Sessions intro (**Fuse is the Sessions intro**; FuseLines-Ink/-Wave/-Draft are alternatives) | Remotion `IdentFuse` / `IdentFuse-16x9` etc. in `src/ident/` (Studio: Idents › Sessions-intro) | `bun run render:ident Fuse-16x9` (one comp), `--intro` (Fuse + FuseLines, both cuts), `--only preview,prores,webm`. `render:ident <Id>` for any of the other 24 idents (list: README "Idents"), `--all` for every one. Full renders on the GPU box. To rebuild sesh-edit's intro from Fuse: `bun run render:intro` (needs ffmpeg on PATH) | `out/ident/Ident<Id>-preview.mp4`, `.mov` (ProRes 4444 alpha, editing), `.webm` (VP9 alpha, OBS) |
| Stinger for OBS (transition into a scene) | Remotion `SessionBumper` | List the 8 ideas (door, corner, lamp, paper, neon, vhs, fader, flap) and offer contact sheets: `bun run render:bumper --idea <idea> --strip` also writes `out/Bumper-<idea>-frames.png` (every 10th frame). Then `bun run render:bumper --idea <idea>`. OBS settings and transition points: README "SessionBumper" | `out/Bumper-<idea>.webm` (alpha) |
| Instagram reel (9:16) from an interview | Remotion `SessionReel` | `bun run reel src/reel/data/<slug>.reel.json`. Needs a cut episode and word captions; see [Reels](#reels-from-an-edited-interview) | `out/reels/` |
| Edit a recorded Sessions interview (cut fillers, silences, pre-take chatter, A/V sync, mic mix, captions, intro) | sesh-edit | `cd longform && uv run sesh-edit <in> -o <out>.edited.mp4 --review` first, show the plan, then the same without `--review` | `<out>.edited.mp4`, `.srt`, `.decisions.json`, `.clean.mp4` |
| Fix captions or a misheard word | sesh-edit | `cd longform && uv run sesh-edit <in> -o <out>.edited.mp4 --replace Waterhose=Waterhouse` (cached, ~40 s). Or edit the decisions file and use `--from-decisions` | overwrites the edit |
| Manual cut, move the intro to the front, insert a clip, title card | sesh-edit | `--cut 20:03-20:29`, `--move-to-front`, `--insert-clip`, `--title-card` (times from the input file) | |
| Make the 1080p version | sesh-edit | `uv run sesh-upscale <out>.clean.mp4 -o <out>.clean.1080p.mp4 --method lanczos` (laptop, minutes) or `--method x4plus` (GPU box, hours), then `uv run sesh-overlay <out>.decisions.json <out>.clean.1080p.mp4 -o <out>.edited.1080p.mp4` | `<out>.edited.1080p.mp4` |
| Change the intro itself (Fuse) | Remotion `IdentFuse-16x9` | Edit `src/ident/Fuse.tsx` (preview in Studio), then `bun run render:intro`: renders it into `longform/src/sesh_edit/assets/intro/` (gitignored). If the frame where the rings open moves from 118, update `OPEN_FRAME` in `scripts/render-intro.ts` | `fuse-16x9.{webm,flac,json}` |
| Add or change the intro on an edited video | sesh-edit | Default intro is Fuse, built by `bun run render:intro` (run it once before the first edit; sesh-edit says so if it's missing). `--intro FILE` for another alpha video, `--no-intro` for none. A new ident is made in Remotion first; see [Hand-off](#hand-off-remotion--sesh-edit) | |
| Session logo reveal (masked open/close) | Remotion `SessionOpen` / `SessionClose` | Needs `public/session/head.mp4` / `tail.mp4`; see [Session logo reveal](#session-logo-reveal) | |
| Change an animation's text, timing or colours | Remotion | Edit the composition in `src/`; the user previews in `bunx remotion studio` | |
| A new animation, stinger, ident or poster style ("make me a new template") | Remotion | Follow [Templates](#templates-names-people-can-say): pick a sayable name, build it, register it, add it to `TEMPLATES.md` | |
| "A short clip from the X interview" (unclear) | ask first | Ask one question: *a vertical reel for Instagram with big captions* (→ `SessionReel`) or *a straight excerpt of the edited video* (→ trim the sesh-edit output with ffmpeg `-ss/-to`, no re-edit)? | |
| "Use Sam's neon one" / any template by its name | look it up | Find the name in `TEMPLATES.md` (then `src/ident/ids.ts`, `src/Root.tsx`). If it's on someone's branch and not in `main` yet, say so: they need to send it to Dean first, or you can work from their branch (`git fetch`, then base a new branch on `origin/<their-branch>`) | |
| Just the audience numbers | script | `bun run fetch:audience artist "Name" --n 4` / `week --end YYYY-MM-DD` | JSON |

If a request doesn't fit, ask. Don't invent a third way to edit long-form
video: the TypeScript episode cut (`scripts/session/*`, `SessionEpisode`) was
retired in #31 for sesh-edit.

## Templates: names people can say

The team asks for templates by name in WhatsApp ("use the Fuse intro", "the
door stinger"). Every template has a **name people can say out loud**, and
[TEMPLATES.md](TEMPLATES.md) is the list of them. When a user names one,
look it up there first.

When you make a new template (an animation, stinger, ident, poster style or
reel look that others could reuse):

1. **Name it** with one short, real word that's easy to say and spell:
   *Fuse, Door, Neon, Strobe*. No numbers, dates, version suffixes or
   initials (`Neon2`, `sam-test`, `NewIntro` are bad). A take on an existing
   template is `<Name>-<Word>`, like `FuseLines-Ink`. Check the word isn't
   used in `TEMPLATES.md`, `src/ident/ids.ts` or `src/Root.tsx`. Suggest a
   name and let the user change it.
2. **Put it where its kind lives**, so the name is what people type and see
   in Studio:
   - idents: `src/ident/<Name>.tsx`, an entry in `src/ident/ids.ts` and its
     registration in `src/ident/Idents.tsx` (`bun run render:ident <Name>`);
   - stingers: `src/bumper/<Name>.tsx`, the lowercase name added to the
     `idea` list in `src/bumper/SessionBumper.tsx` and its `DURATIONS`
     (`bun run render:bumper --idea <name>`);
   - other compositions: `src/<Name>.tsx`, registered in `src/Root.tsx` with
     the name as the composition id.
3. **Add a row to `TEMPLATES.md`** in the same commit: name, kind, one line
   on what it is, what to say to get it, who made it.
4. **Save and back up** (hard rule 2), then tell the user: *"It's called
   **Name**. Anyone can now ask for 'the Name stinger'. Send it to Dean for
   review when you want everyone to have it."*

Changing a template other people use changes it for everyone once it's
merged. If the user wants a different take rather than a fix, make a
`<Name>-<Word>` variant instead.

## House style

So everyone's work looks like it comes from the same place:

- **Colours, fonts and the logo come from `src/ident/brand.ts`**: Rubik
  Mono One (display) and JetBrains Mono (mono), the colour tokens `C.*`
  (paper, ink, grays, the yellow `#FFD400` accent) and the mark's paths.
  Import them; don't paste new hex codes or load other fonts without asking
  the user, and mention it in the PR.
- **Tone: adult, gritty, restrained.** Mostly black, paper and greys, with
  at most one accent colour used sparingly. Grain and texture, weighty
  motion and hard cuts rather than bouncy springs. The grit comes from
  **club and music culture**: sound, light, signal, vinyl, tape, CRT, haze,
  lasers. Not from building sites (concrete, steel, machinery), and not
  playful multi-colour cartoon looks, which the team found childlike.
- **Formats:** 30 fps; 1080×1920 for 9:16 (stories, reels), 1920×1080 for
  16:9 (stream, YouTube). Stingers and idents render with alpha (ProRes 4444
  `.mov` for editing, VP9 `.webm` for OBS), like the existing ones.
- **Look at a similar existing template first** and match its structure
  (timing constants at the top of the file, the shared helpers in its
  folder) before writing a new one from scratch.

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
- **Branch, save and back up as you go, PR; never `main`.** See [Hard rules](#hard-rules-read-before-touching-anything).
  Stage files by name, never `git add -A`. Commit messages: a short line saying what changed, e.g. `neon stinger: shorter hold`.
- Before a PR: `bun run lint` (eslint + tsc) and `bun run test` (it lists the root test files so `longform/` is never picked up); `bunx remotion
  compositions` must list everything. `longform/` has no test suite yet:
  check that `uv run sesh-edit --help` still runs.
- Non-developer users: see [Talking to the team](#talking-to-the-team).

## Where media comes from and goes

| Media | Comes from | Lives (gitignored) |
|---|---|---|
| Raw interview recordings | Dropbox share links (`dl=0` → `dl=1`, keep `rlkey=`), the camera, OBS | `~/Movies/waterhouse/in/` on Macs, `C:\Users\<you>\Videos\sesh-in\` on the GPU box |
| sesh-edit output | sesh-edit | `~/Movies/waterhouse/out/`, `C:\Users\<you>\Videos\sesh-out\` |
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
- **GPU box** (the Windows 10 PC in the studio, RTX 3070): the x4plus upscale
  (hours, Real-ESRGAN via Vulkan), long encodes and full ident renders.
  Access is arranged by Dean. On it, PowerShell: chain commands with `;`,
  never `&`. Transcription there is CPU-only, so slower than on a Mac. Long
  jobs need a session that stays logged in. Paths and a full run:
  `longform/README.md`, "Machines".
- If a user's laptop is struggling with an upscale or a long encode, offer
  the GPU box. Don't start an x4plus upscale on a laptop.

## Repo map

```
AGENTS.md                this file (CLAUDE.md imports it)
GETTING-STARTED.md       the first-time guide for teammates: setup, what to ask, the branch → PR workflow
TEMPLATES.md             every template by the name people say (Fuse, door, PullUp...), what it is, how to ask for it
README.md                entry point, then the Remotion reference: every composition, its flags, OBS setup, metric definitions
.github/PULL_REQUEST_TEMPLATE.md   what a PR body should say
docs/                    notes that aren't a guide (early content plan)
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

The default intro, **Fuse**, is built into sesh-edit's asset folder
(`longform/src/sesh_edit/assets/intro/fuse-16x9.{webm,flac,json}`, gitignored)
by `bun run render:intro`, from the Remotion comp `IdentFuse-16x9`
(`src/ident/Fuse.tsx`). Run it once on a fresh clone before the first edit,
and again after changing Fuse. See the "Intro" section of
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

- **Setup:** `cd longform && uv sync` (Python 3.12, pinned), then
  `bun run render:intro` from the repo root (builds the Fuse intro). ffmpeg on PATH.
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
