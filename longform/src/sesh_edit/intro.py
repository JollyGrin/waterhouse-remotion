"""The channel ident (default: Fuse) prepended to the captioned outputs.

The ident has an alpha channel and is built to open onto the interview: the interview starts
playing underneath at `open_s` (Fuse: frame 118 = 3.933s) and the ident's alpha composites
over it until the ident ends. The intro is applied only when encoding the captioned outputs
(<name>.edited.mp4 and the sesh-overlay 1080p), never to <name>.clean.mp4, so the edit
timeline (keep segments, inserts, caption times) stays intro-free and is shifted at encode.

Audio: the interview is loudness-normalised first, without the intro. The intro soundtrack is
then gained as a whole so its integrated loudness matches the speech (`level_lu` relative,
default 0), capped so its true peak stays under the ceiling, and summed over the start of
the interview audio. Its own mix is not altered (no EQ, no compression, no limiter).

An intro is a video file with alpha (WebM VP8/VP9 yuva420p, ProRes 4444, ...). Its audio is
taken from a sidecar `<stem>.flac` / `<stem>.wav` if present, else from the file itself. The
open point comes from a sidecar `<stem>.json` ({"open_s": ...}); without one, it is the first
frame that is no longer fully opaque (mean alpha < 0.999), or the end if it never opens."""
from __future__ import annotations

import json
import subprocess
import tempfile
from pathlib import Path

import numpy as np

ASSET_DIR = Path(__file__).parent / "assets" / "intro"
DEFAULT_FILE = "fuse-16x9.webm"
TP_CEILING = -1.0


MISSING_HINT = ("The bundled Fuse intro isn't built yet. From the repo root run: bun run render:intro\n"
                "(it renders Fuse in Remotion into {dir}). Or pass --no-intro to edit without it.")


def resolve(file: str) -> Path:
    """Bundled intros are stored by bare name (machine-independent decisions.json). They are
    built from the Remotion source by `bun run render:intro`, not committed."""
    p = Path(file).expanduser()
    if p.is_absolute():
        return p
    path = ASSET_DIR / p
    if not path.exists():
        raise SystemExit(f"intro not found: {path}\n" + MISSING_HINT.format(dir=ASSET_DIR))
    return path


def _probe(path: Path) -> dict:
    j = json.loads(subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration:stream=codec_type,codec_name,r_frame_rate",
         "-of", "json", str(path)], check=True, capture_output=True, text=True).stdout)
    v = next(s for s in j["streams"] if s["codec_type"] == "video")
    num, den = map(int, v["r_frame_rate"].split("/"))
    return {"codec": v["codec_name"], "fps": num / den, "duration": float(j["format"]["duration"]),
            "has_audio": any(s["codec_type"] == "audio" for s in j["streams"])}


def _vdec(codec: str) -> list[str]:
    """ffmpeg's native VP8/VP9 decoders drop the alpha plane; libvpx keeps it (must precede -i)."""
    return {"vp9": ["-c:v", "libvpx-vp9"], "vp8": ["-c:v", "libvpx"]}.get(codec, [])


def alpha_means(path: Path) -> np.ndarray:
    """Mean alpha (0-1) of every frame, at the file's own frame rate."""
    pr = _probe(path)
    b = subprocess.run(["ffmpeg", "-v", "error", *_vdec(pr["codec"]), "-i", str(path), "-an",
                        "-vf", "format=rgba,alphaextract,scale=320:180", "-f", "rawvideo", "-pix_fmt", "gray", "-"],
                       capture_output=True, check=True).stdout
    return np.frombuffer(b, np.uint8).reshape(-1, 180 * 320).mean(1) / 255.0


def make_spec(file: str | None = None) -> dict:
    """The decisions.json `intro` entry for FILE (None = the bundled Fuse ident)."""
    if file is None:
        stored = DEFAULT_FILE
    else:
        p = Path(file).expanduser().resolve()
        stored = p.name if p.parent == ASSET_DIR.resolve() else str(p)
    path = resolve(stored)
    if not path.exists():
        raise SystemExit(f"intro not found: {path}")
    pr = _probe(path)
    side = path.with_suffix(".json")
    if side.exists():
        open_s, how = float(json.loads(side.read_text())["open_s"]), side.name
    else:
        m = alpha_means(path)
        idx = np.nonzero(m < 0.999)[0]
        open_s = idx[0] / pr["fps"] if len(idx) else pr["duration"]
        how = "first frame with mean alpha < 0.999" if len(idx) else "never opens (no alpha): hard cut at the end"
    return {"file": stored, "open_s": round(open_s, 6), "open_from": how, "dur_s": round(pr["duration"], 6),
            "level_lu": 0.0}


def offset_frames(spec: dict, fps: float) -> int:
    """The interview starts at this output frame; audio uses the same offset (frames / fps)."""
    return int(round(spec["open_s"] * fps))


def load_audio(spec: dict, sr: int, ch: int) -> np.ndarray | None:
    path = resolve(spec["file"])
    src = next((s for s in (path.with_suffix(".flac"), path.with_suffix(".wav")) if s.exists()), None)
    if src is None:
        if not _probe(path)["has_audio"]:
            return None
        src = path
    b = subprocess.run(["ffmpeg", "-v", "error", "-i", str(src), "-vn", "-t", f"{spec['dur_s']:.4f}",
                        "-ac", str(ch), "-ar", str(sr), "-f", "f32le", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(b, np.float32).reshape(-1, ch).copy()


def loudness(a: np.ndarray, sr: int) -> dict:
    """EBU R128 integrated loudness and true peak of an (N, ch) float array."""
    import soundfile as sf

    from .audio import measure_loudness

    with tempfile.TemporaryDirectory() as d:
        p = Path(d) / "a.wav"
        sf.write(str(p), a, sr, subtype="FLOAT")
        m = measure_loudness(p)
    return {"i": float(m["input_i"]), "tp": float(m["input_tp"])}


def mix_audio(body: np.ndarray, sr: int, spec: dict, fps: float, speech_lufs: float | None = None,
              gain_db: float | None = None) -> tuple[np.ndarray, dict]:
    """Intro soundtrack + body (delayed by the intro offset). `gain_db` (e.g. recorded in
    decisions.json) skips the level matching; otherwise the intro is matched to
    `speech_lufs` (measured on `body` if not given)."""
    off = offset_frames(spec, fps)
    n_off = int(round(off / fps * sr))
    ia = load_audio(spec, sr, body.shape[1])
    info = {"offset_frames": off, "offset_s": round(off / fps, 6)}
    out = np.zeros((n_off + len(body), body.shape[1]), np.float32)
    out[n_off:] = body
    if ia is None:
        info["audio"] = None
        return out, info
    m = loudness(ia, sr)
    if gain_db is None:
        if speech_lufs is None:
            speech_lufs = loudness(body, sr)["i"]
        g = speech_lufs + spec.get("level_lu", 0.0) - m["i"]
        capped = g > TP_CEILING - m["tp"]
        gain_db = round(min(g, TP_CEILING - m["tp"]), 2)
        info |= {"speech_lufs": round(speech_lufs, 2), "tp_capped": bool(capped)}
    ia = ia[: len(out)] * np.float32(10 ** (gain_db / 20))
    out[: len(ia)] += ia
    mixed = loudness(out[: max(len(ia), n_off + sr)], sr)
    info |= {"audio": True, "intro_lufs": round(m["i"], 2), "intro_tp": round(m["tp"], 2), "gain_db": gain_db,
             "intro_lufs_applied": round(m["i"] + gain_db, 2), "intro_section_tp": round(mixed["tp"], 2)}
    return out, info


class IntroFrames:
    """The ident conformed to the output size and fps, read one frame at a time in order.
    `over(frame)` composites the next ident frame over `frame` (RGB uint8); once the ident has
    ended it returns `frame` unchanged."""

    def __init__(self, spec: dict, W: int, H: int, fps: float):
        path = resolve(spec["file"])
        self.W, self.H = W, H
        self.n = int(round(spec["dur_s"] * fps))
        self.i = 0
        vf = (f"fps={fps},format=rgba,scale={W}:{H}:force_original_aspect_ratio=decrease:flags=lanczos,"
              f"pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:color=black@0,setsar=1")
        self.proc = subprocess.Popen(["ffmpeg", "-v", "error", *_vdec(_probe(path)["codec"]), "-i", str(path), "-an",
                                      "-vf", vf, "-frames:v", str(self.n), "-f", "rawvideo", "-pix_fmt", "rgba", "-"],
                                     stdout=subprocess.PIPE)

    @property
    def done(self) -> bool:
        return self.i >= self.n

    def over(self, frame: np.ndarray) -> np.ndarray:
        if self.done:
            return frame
        b = self.proc.stdout.read(self.W * self.H * 4)
        self.i += 1
        if len(b) < self.W * self.H * 4:
            self.n = self.i  # shorter than its container said: treat as ended
            return frame
        f = np.frombuffer(b, np.uint8).reshape(self.H, self.W, 4)
        a = f[:, :, 3:4]
        if a.min() == 255:
            return np.ascontiguousarray(f[:, :, :3])
        if a.max() == 0:
            return frame
        a = a.astype(np.float32) / 255.0
        return (f[:, :, :3] * a + frame * (1.0 - a) + 0.5).astype(np.uint8)

    def close(self):
        if self.proc is not None:
            self.proc.stdout.close()
            self.proc.kill()
            self.proc.wait()
            self.proc = None


def hold_captions(lines: list[dict], spec: dict, fps: float) -> list[dict]:
    """Captions (body time) never show while the ident is on screen: a line that would start
    before the ident ends starts when it ends (1.07s into the interview for Fuse). A line
    left with no time on screen is held for 0.5s (up to the next line)."""
    t0 = spec["dur_s"] - offset_frames(spec, fps) / fps
    if t0 <= 0:
        return lines
    for k, ln in enumerate(lines):
        if ln["start"] < t0:
            ln["start"] = t0
            nxt = lines[k + 1]["start"] if k + 1 < len(lines) else float("inf")
            ln["show_end"] = max(ln["show_end"], min(t0 + 0.5, max(nxt, t0)))
    return [ln for ln in lines if ln["show_end"] > ln["start"]]


def shift_lines(lines: list[dict], off_s: float) -> list[dict]:
    """Copies of the caption lines in output time (for the .srt)."""
    return [dict(ln, start=ln["start"] + off_s, end=ln["end"] + off_s, show_end=ln["show_end"] + off_s,
                 words=[dict(w, start=w["start"] + off_s, end=w["end"] + off_s) for w in ln["words"]])
            for ln in lines]
