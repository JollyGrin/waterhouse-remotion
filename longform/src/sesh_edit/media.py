"""ffmpeg/ffprobe helpers."""
from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path

import numpy as np


def probe(path: str) -> dict:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries",
         "format=duration:stream=index,codec_type,width,height,r_frame_rate,sample_rate,channels",
         "-of", "json", path],
        check=True, capture_output=True, text=True,
    ).stdout
    j = json.loads(out)
    v = next(s for s in j["streams"] if s["codec_type"] == "video")
    a = next(s for s in j["streams"] if s["codec_type"] == "audio")
    num, den = map(int, v["r_frame_rate"].split("/"))
    return {
        "duration": float(j["format"]["duration"]),
        "width": int(v["width"]),
        "height": int(v["height"]),
        "fps": num / den,
        "sample_rate": int(a["sample_rate"]),
        "channels": int(a["channels"]),
    }


def extract_wav(src: str, dst: Path, sr: int, channels: int) -> None:
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-i", src, "-vn", "-ac", str(channels), "-ar", str(sr), "-c:a", "pcm_f32le", str(dst)],
        check=True,
    )


def read_wav(path: Path) -> tuple[np.ndarray, int]:
    import soundfile as sf

    a, sr = sf.read(str(path), dtype="float32", always_2d=False)
    return a, sr


def silencedetect(src: str, noise_db: float = -35.0, min_dur: float = 0.3) -> list[tuple[float, float]]:
    """Return [(start, end)] silent intervals (source/audio time)."""
    p = subprocess.run(
        ["ffmpeg", "-hide_banner", "-nostats", "-i", src, "-vn", "-af",
         f"silencedetect=noise={noise_db}dB:d={min_dur}", "-f", "null", "-"],
        capture_output=True, text=True,
    )
    out, start = [], None
    for line in p.stderr.splitlines():
        m = re.search(r"silence_start: ([\d.]+)", line)
        if m:
            start = float(m.group(1))
        m = re.search(r"silence_end: ([\d.]+)", line)
        if m and start is not None:
            out.append((start, float(m.group(1))))
            start = None
    return out
