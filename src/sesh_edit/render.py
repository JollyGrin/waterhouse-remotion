"""Single-pass render: cut audio (numpy, sample-accurate, 10ms fades), resample video
frames through the cut time-map, burn captions, encode h264 + aac once."""
from __future__ import annotations

import subprocess
from pathlib import Path

import numpy as np

from .captions import Renderer, Style, group_lines, state_at, write_srt
from .plan import TimeMap


def shift_audio(audio: np.ndarray, sr: int, offset_s: float) -> np.ndarray:
    """offset_s > 0: audio lags video -> move audio earlier."""
    n = int(round(abs(offset_s) * sr))
    if n == 0:
        return audio
    pad = np.zeros((n,) + audio.shape[1:], dtype=audio.dtype)
    if offset_s > 0:
        return np.concatenate([audio[n:], pad])
    return np.concatenate([pad, audio[:-n]])


def cut_audio(audio: np.ndarray, sr: int, keeps: list[list[float]], fade_ms: float) -> np.ndarray:
    nf = max(1, int(sr * fade_ms / 1000))
    ramp = np.linspace(0.0, 1.0, nf, dtype=np.float32)
    if audio.ndim == 2:
        ramp = ramp[:, None]
    parts = []
    for s, e in keeps:
        a, b = int(round(s * sr)), int(round(e * sr))
        seg = audio[a:b].copy()
        if len(seg) > 2 * nf:
            seg[:nf] *= ramp
            seg[-nf:] *= ramp[::-1]
        parts.append(seg)
    return np.concatenate(parts)


def caption_lines(cap_words: list[dict], tm: TimeMap, W: int, H: int, st: Style):
    out_words = []
    for w in cap_words:
        i = tm.segment_of(w["start"], tol=0.03)
        if i is None:
            continue  # word was cut
        s = tm.cum[i] + max(0.0, w["start"] - tm.s[i])
        e = tm.cum[i] + min(w["end"], tm.e[i]) - tm.s[i]
        out_words.append({"word": w["word"], "start": float(s), "end": float(max(e, s + 0.05))})
    out_words.sort(key=lambda w: w["start"])
    r = Renderer(W, H, st)
    return group_lines(out_words, W, r.font, st), r


def render(src: str, info: dict, decisions: dict, out_mp4: Path, out_srt: Path, work: Path, st: Style,
           fade_ms: float = 10.0, log=print) -> dict:
    import soundfile as sf

    W, H, fps = info["width"], info["height"], info["fps"]
    keeps = decisions["keep_segments"]
    offset = decisions["av_offset"]["applied_s"]
    tm = TimeMap(keeps)

    # ---- audio
    log("    audio: decode, shift, cut with fades")
    full_wav = work / "audio_full.wav"
    if not full_wav.exists():
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", src, "-vn", "-c:a", "pcm_f32le", str(full_wav)], check=True)
    audio, sr = sf.read(str(full_wav), dtype="float32", always_2d=True)
    audio = shift_audio(audio, sr, offset)
    cut = cut_audio(audio, sr, keeps, fade_ms)
    cut_wav = work / "audio_cut.wav"
    sf.write(str(cut_wav), cut, sr, subtype="FLOAT")
    del audio

    # ---- captions
    lines, rend = caption_lines(decisions["caption_words"], tm, W, H, st)
    write_srt(lines, out_srt)

    # ---- video: output frame n shows source frame round(to_src(n/fps) * fps)
    n_out = int(round(len(cut) / sr * fps))
    src_idx = np.array([int(round(tm.to_src((n + 0.5) / fps) * fps - 0.5)) for n in range(n_out)])
    src_idx = np.clip(src_idx, 0, None)
    first = int(src_idx[0])
    log(f"    video: {n_out} output frames")
    enc = subprocess.Popen(
        ["ffmpeg", "-v", "error", "-y",
         "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", f"{fps}", "-i", "-",
         "-i", str(cut_wav),
         "-map", "0:v", "-map", "1:a",
         "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
         "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", str(out_mp4)],
        stdin=subprocess.PIPE,
    )
    fsz = W * H * 3
    dec = None

    def open_decoder(idx: int):
        # segments may be out of order (moved intro): (re)start decoding at frame idx
        return subprocess.Popen(["ffmpeg", "-v", "error", "-ss", f"{idx / fps:.4f}", "-i", src, "-an", "-f", "rawvideo",
                                 "-pix_fmt", "rgb24", "-"], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)

    def close_decoder(d):
        if d is not None:
            d.stdout.close()
            d.kill()
            d.wait()

    cur_idx = first - 1
    frame = None
    hint = 0
    try:
        for n, want in enumerate(src_idx):
            if dec is None or want < cur_idx or want - cur_idx > fps * 10:
                close_decoder(dec)
                dec = open_decoder(int(want))
                cur_idx = int(want) - 1
                log(f"      decoding from source frame {want} ({want / fps:.2f}s)")
            while cur_idx < want:
                b = dec.stdout.read(fsz)
                if len(b) < fsz:
                    break  # EOF: repeat last frame
                frame = np.frombuffer(b, np.uint8).reshape(H, W, 3)
                cur_idx += 1
            out = frame.copy()
            ln, cw, hint = state_at(lines, n / fps, hint)
            if ln is not None:
                rend.composite(out, rend.strip(ln, cw))
            enc.stdin.write(out.tobytes())
            if n % (int(fps) * 120) == 0:
                log(f"      {n / fps / 60:5.1f}/{n_out / fps / 60:.1f} min")
    finally:
        enc.stdin.close()
        enc.wait()
        close_decoder(dec)
    if enc.returncode != 0:
        raise RuntimeError("ffmpeg encode failed")
    return {"output_duration_s": round(len(cut) / sr, 3), "caption_lines": len(lines), "frames": n_out}
