# Getting started

This repo makes all of Waterhouse's video. You don't need to read or write
any code. You open a terminal in this folder, start **Claude Code**, and say
what you want. Claude picks the right tool, runs it, and tells you where the
file landed.

There are two tools in here, and Claude chooses between them for you:

| You want to... | Tool | Where it lives |
|---|---|---|
| **Make an animation**: a promo clip for an event, the weekly lineup or board, an artist recap, a session poster, the Sessions intro (Fuse) or another ident, a stinger for OBS, a reel | **Remotion** | the repo root |
| **Edit a recorded video**: cut silences and "um"s, fix audio sync and the mics, add captions, make the 1080p version, put the intro on | **sesh-edit** | `longform/` |

> **This repo is public.** Anyone on the internet can read it. Footage,
> photos, music and finished videos are **never** committed. The folders they
> go in are already set up so git ignores them (see
> [Where your files go](#where-your-files-go)). If Claude ever asks to commit
> a video, image or audio file, say no.

---

## 1. Setup (once)

Do this in the **Terminal** app on a Mac. Paste one block at a time.

**Everyone** needs these:

```sh
# Homebrew (the Mac package manager), if you don't have it yet
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# git, ffmpeg and the GitHub CLI
brew install git ffmpeg gh

# Claude Code. Then run `claude` once and log in with your Claude account.
curl -fsSL https://claude.ai/install.sh | bash

# GitHub login, so Claude can open pull requests for you
gh auth login

# Get the repo
mkdir -p ~/git && cd ~/git
git clone https://github.com/JollyGrin/waterhouse-video.git
cd waterhouse-video
```

**For animations** (Remotion) add Bun, then install the project:

```sh
curl -fsSL https://bun.sh/install | bash
# close and reopen Terminal so `bun` is found, then:
cd ~/git/waterhouse-video
bun install
```

Remotion downloads its own copy of Chrome the first time it renders. You
don't install that yourself.

**For editing recorded video** (sesh-edit) add uv, then install it:

```sh
curl -LsSf https://astral.sh/uv/install.sh | sh
# close and reopen Terminal so `uv` is found, then:
cd ~/git/waterhouse-video/longform
uv sync
```

- The first real edit downloads about **3.5 GB** of speech models
  (CrisperWhisper ~3 GB, wav2vec2 ~360 MB, a 4 MB face model). Do it on good
  wifi. It only happens once.
- Editing needs an **Apple Silicon Mac** (M1 or newer) or the **GPU box**
  (the Windows PC in the studio, `desktop-02rit4k`). The long jobs, like the
  proper 1080p upscale, only run well on the GPU box. Ask Dean for access.
- Animation-only teammates can skip this block.

**Make your video folders** (outside the repo, so nothing in them can ever be
committed by accident):

```sh
mkdir -p ~/Movies/waterhouse/in ~/Movies/waterhouse/out
```

**Every time you work:**

```sh
cd ~/git/waterhouse-video
git pull
claude
```

Now type what you want.

---

## 2. Where your files go

| What | Put it here | Notes |
|---|---|---|
| **Raw interview footage** (from Dropbox, the camera, OBS) | `~/Movies/waterhouse/in/` | Tell Claude the file name. A Dropbox share link works too: Claude can download it (it changes `dl=0` to `dl=1`). |
| **Edited videos** (sesh-edit output) | `~/Movies/waterhouse/out/` | Claude writes the edit, the captions file and the "decisions" file here. |
| **Animations** (promo clips, boards, recaps, stingers, reels) | `out/` in the repo | Ignored by git. Each command prints the exact file name. |
| **Posters** | `out/posters/` | |
| **Artist photos** for posters | anywhere, e.g. `~/Downloads/` | Give Claude the path (you can drag the file into the Terminal window). It copies the photo into `public/artists/`, which git ignores. |
| **Music** | ask Dean for the music library folder | The weekly music beds are copyrighted. They live in `public/audio/` locally and are never committed. |

On the GPU box the folders are `C:\Users\masle\Videos\sesh-in\` (in) and
`C:\Users\masle\Videos\sesh-out\` (out).

**Never commit media.** Git ignores `out/`, `work/`, `public/session/`,
`public/reel/`, `public/artists/`, `public/fort-riddim/` and most of
`public/audio/`. The only media in the repo is the sound kits in
`public/audio/{bumper,pullup,recap}/` (made by us or free-licensed) and the
example renders in `docs/`. If `git status` ever shows a `.mp4`, `.mov`,
`.wav`, `.jpg` or `.png` you didn't expect, ask Claude to remove it from the
commit.

---

## 3. Just ask Claude

Type these in plain words. Names, dates and files can be whatever you need.
Claude asks if something is missing (which artist, which date, which file).

| Type this | What happens | Where it lands |
|---|---|---|
| **"Make the PullUp promo for Friday's event"** | Reads the studio calendar and renders a 10-second "pull up" clip for every event in the next 7 days (the artist's photo, the time, a fake chat), then tells you which file is Friday's. A shared night gets one clip with everyone on it. | `out/PullUp-<name>-<date>.mp4` |
| **"Make the Waterhouse Session clip for Tuesday"** | Same idea for the Tuesday interview night: the guest and Denzo side by side, with the running order. | `out/Session-<guest>-<date>.mp4` |
| **"Render the weekly lineup"** | This week's lineup from the calendar, as an Instagram story. This one asks questions, so Claude gives you a command to run in Terminal: press Enter twice (no login, all events). | `out/WeeklyLineup-<date>.mp4` |
| **"Make last week's board"** | The weekly board: every artist ranked by the crowd they brought, badges, and next week's lineup. | `out/HouseWeekly-<year>-W<week>.mp4` |
| **"Make a recap for Tj Gee"** | "Who showed up": the artist's last shows, who came, who stayed, who was new. | `out/Recap-<artist>-<date>.mp4` |
| **"Make a poster for Timo Feyman's session on 30.7.2026, photo is ~/Downloads/timo.jpg"** | A square session cover. With a photo, the background is cut out (needs a Mac on macOS 14 or newer). Without one you get the type-only cover. The session number counts up by itself. | `out/posters/session-<nr>-<artist>.png` |
| **"Render the Fuse intro as a webm for OBS"** | Renders Fuse, the Waterhouse Sessions intro, with a see-through background so it plays over the live scene in OBS. Other idents work the same way. *Arriving with #28: the idents aren't in the repo yet.* | `out/` (exact name comes with #28) |
| **"Show me the stingers I can use in OBS"** | Lists the eight stingers (door, corner, lamp, paper, neon, vhs, fader, flap) with their contact sheets in `docs/`, and renders the one you pick with the OBS settings to use. | `out/Bumper-<idea>.webm` |
| **"Edit this interview: cut silences and ums, add captions. The file is ~/Movies/waterhouse/in/poya.mov"** | sesh-edit transcribes it, shows you the plan (what it will cut, anything it is unsure about), then renders after you say go. | `~/Movies/waterhouse/out/poya.edited.mp4` (+ `.srt`, `.decisions.json`, `.clean.mp4`) |
| **"The caption says 'Waterhose', fix it"** | Re-renders with that word replaced everywhere. Uses the cached transcript, so it's fast. | same file, overwritten (or a `v2` if you ask) |
| **"Cut 20:03 to 20:29 out, that's us talking to the camera guy"** | Adds a manual cut (times from the original file) and re-renders. | same as above |
| **"Make the 1080p version"** | Quick version on a laptop (minutes, a bit soft). The proper AI upscale runs on the GPU box and takes hours. Then the captions and intro are drawn again at 1080p so the text stays sharp. | `~/Movies/waterhouse/out/<name>.edited.1080p.mp4` |
| **"Make a 9:16 reel from the best 30 seconds of the Boogie interview"** | Claude reads the transcript, proposes a 30-second span, and renders a vertical reel that cuts between the speakers with big captions and an end card. See the note below. | `out/reels/<slug>.mp4` |

**About reels:** the reel animation works, but the step that feeds it an
edited interview's captions isn't built yet. Claude can still do it by hand
(convert sesh-edit's word timings), but expect some back-and-forth, or ask
Dean.

You can also just ask questions: *"what can this repo make?"*, *"which
stinger is the shortest?"*, *"what did the edit cut at 12 minutes?"*

---

## 4. Seeing and tweaking

### Animations: Remotion Studio

Ask **"Open Remotion Studio"**, or run it yourself:

```sh
bunx remotion studio
```

It opens in your browser. Every animation is in the list on the left. Click
one to play it, scrub through it, and change its text fields in the panel on
the right. That's only a preview: when you like something, tell Claude so it
changes the real thing.

Ways to ask for changes:

- *"In the PullUp clip, make the headline come in half a second later"*
- *"Change the lime to the purple from the logo"*
- *"Make the poster text say SESSION #12 instead of SESSION 12"*
- *"The neon stinger is too long, cut the hold in half"*

Claude edits the composition, and Studio reloads by itself so you see the
change straight away. Ask it to render again when you're happy.

### Recorded videos: review before rendering

sesh-edit can show its plan before it renders anything. Ask **"Show me the
edit plan first"**, or Claude runs:

```sh
cd longform
uv run sesh-edit ~/Movies/waterhouse/in/poya.mov -o ~/Movies/waterhouse/out/poya.edited.mp4 --review
```

You get the list of cuts, the audio sync it detected, and a **review list**:
spots it wasn't sure about (restarts, chatter, an intro recorded at the end).
It never cuts those by itself. Watch them and tell Claude what to do:

- *"Keep the bit at 4:12, that laugh is good"*
- *"Cut the restart at 15:40"*
- *"The intro was recorded at the end (20:29 to 20:58), move it to the front"*
- *"Put a title card 'How did you first get into electronic music?' at 0:01"*

Then *"render it"*.

---

## 5. When something goes wrong

| What you see | What it means | What to type |
|---|---|---|
| A **"Missing media"** card in Studio or in a render | That animation plays footage that isn't in git (it's private or too big), e.g. `public/session/head.mp4` or a reel's cut. | *"What files does this need and where do I get them?"* Usually: ask the person who made it for the file, or let Claude regenerate it from the source. |
| The first edit sits on **"downloading"** for a long time | The one-time 3.5 GB model download. | Leave it running on good wifi. If it fails: *"The model download failed, try again"*. |
| **`ffmpeg: command not found`** | ffmpeg isn't installed. | `brew install ffmpeg`, or *"install ffmpeg for me"*. |
| A render or upscale is **very slow**, the laptop is hot | Long encodes and the AI upscale are GPU work. | *"Run this on the GPU box instead"*. For a quick look on the laptop: *"use the lanczos upscale"*. |
| **Claude picked the wrong tool** (e.g. tries to edit an interview with Remotion, or uses npm) | It didn't read the routing table. | *"Read CLAUDE.md and use the right tool"*. Editing recordings is always sesh-edit in `longform/`. Animations are always Remotion with `bun`. |

Anything else: paste the error to Claude and ask *"what went wrong?"*. It's
fine to say *"start over"*.

---

## 6. Sharing your work

Rendered videos are not shared through git. Upload them to Dropbox, Drive or
straight to Instagram.

When you've changed an **animation** (new text, new timing, a new poster
style) and want it kept for everyone, type:

> *"Save my changes on a new branch and open a pull request"*

Claude makes a branch, commits only the code changes (never media), pushes
it, and opens a pull request on GitHub for Dean to review. It prints the
link. **Never push to `main`.** If Claude offers to, say no.

To pick up everyone else's changes: `git pull` (or *"get the latest
version"*).

---

## What was tried for this guide

Done on a MacBook (Apple Silicon) on 2026-11-12, with Bun, uv, ffmpeg and
Claude Code already installed:

- **Setup:** `bun install`; `cd longform && uv sync`; `sesh-edit --help`,
  `sesh-upscale --help` and `sesh-overlay --help`; the lanczos upscale on a
  test clip.
- **Animations:** Remotion Studio opens. These all rendered: the PullUp clips
  (`--all`), a Waterhouse Session clip, the weekly lineup (run by hand in a
  terminal), the recap, the door stinger, the type-only poster and the
  SessionOpen reveal.
- **Routing:** every prompt in the table in section 3 was given to Claude
  Code in this folder. Each time it picked the right tool and command.
- **Not tried here:**
  - a real sesh-edit edit, `--review`, a caption fix, a cut or the intro
    hand-off (all need the 3.5 GB model download, which wasn't done on this
    machine);
  - the x4plus upscale (GPU box only);
  - a reel from a sesh-edit interview (the missing step above);
  - the Fuse intro and the other idents (they arrive with #28);
  - installing Homebrew, Claude Code and Bun from scratch (they were already
    installed).
