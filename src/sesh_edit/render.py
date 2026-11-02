"""Single-pass render of the edit timeline.

Timeline = keep segments of the main video (any order) + inserts (clips from other files,
title cards). Audio is assembled sample-accurately in numpy (10ms fades at every cut,
longer fades on clips), mixed to a centred track and loudness-normalised. Video frames are
picked per output frame from the right source, captions are burned in, and everything is
encoded once (h264 + aac)."""
from __future__ import annotations

import subprocess
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from .captions import FONT_PATH, Renderer, Style, group_lines, state_at, write_srt
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


def _fade(seg: np.ndarray, n_in: int, n_out: int) -> np.ndarray:
    if len(seg) <= n_in + n_out:
        return seg
    if n_in:
        r = np.linspace(0.0, 1.0, n_in, dtype=np.float32)
        seg[:n_in] *= r[:, None] if seg.ndim == 2 else r
    if n_out:
        r = np.linspace(1.0, 0.0, n_out, dtype=np.float32)
        seg[-n_out:] *= r[:, None] if seg.ndim == 2 else r
    return seg


def cut_audio(audio: np.ndarray, sr: int, keeps: list[list[float]], fade_ms: float) -> np.ndarray:
    nf = max(1, int(sr * fade_ms / 1000))
    return np.concatenate([_fade(audio[int(round(s * sr)) : int(round(e * sr))].copy(), nf, nf) for s, e in keeps])


def _decode_audio(path: str, start: float, dur: float, sr: int, ch: int) -> np.ndarray:
    b = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{start:.4f}", "-t", f"{dur:.4f}", "-i", path, "-vn",
                        "-ac", str(ch), "-ar", str(sr), "-f", "f32le", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(b, np.float32).reshape(-1, ch).copy()


def _rms_db(a: np.ndarray) -> float:
    """Loudness proxy for level matching an insert: mean power of the louder half of 400ms blocks."""
    m = a.mean(1) if a.ndim == 2 else a
    blk = 19200 if len(m) > 19200 else len(m)
    n = len(m) // blk
    p = (m[: n * blk].astype(np.float64).reshape(n, blk) ** 2).mean(1)
    p = np.sort(p)[len(p) // 2 :]
    return float(10 * np.log10(p.mean() + 1e-12))


def assemble_audio(main: np.ndarray, sr: int, tm: TimeMap, fade_ms: float, log=print) -> np.ndarray:
    """Concatenate the timeline. Item k occupies samples [round(cum[k]*sr), round(cum[k+1]*sr))."""
    nf = max(1, int(sr * fade_ms / 1000))
    ch = main.shape[1]
    bounds = np.round(tm.cum * sr).astype(int)
    out = np.zeros((bounds[-1], ch), np.float32)
    # reference level for inserted clips: the louder half of the kept speech
    speech = np.concatenate([main[int(round(it["start"] * sr)) : int(round(it["end"] * sr))]
                             for it in tm.items if it["kind"] == "main"][:400])
    ref_db = _rms_db(speech)
    for k, it in enumerate(tm.items):
        n = bounds[k + 1] - bounds[k]
        if it["kind"] == "main":
            a = int(round(it["start"] * sr))
            seg = _fade(main[a : a + n].copy(), nf, nf)
        elif it["kind"] == "clip":
            seg = _decode_audio(it["path"], it["start"], it["dur_s"], sr, ch)[:n]
            g = ref_db + it.get("gain_db", -6.0) - _rms_db(seg)  # music sits a little under the speech
            seg *= np.float32(10 ** (g / 20))
            it["applied_gain_db"] = round(g, 1)
            nfc = int(sr * it.get("fade_s", 0.4))
            seg = _fade(seg, nfc, nfc)
            log(f"    clip {Path(it['path']).name} @{it['start']:.1f}s: gain {g:+.1f} dB, fades {it.get('fade_s', 0.4)}s")
        else:
            continue  # title card: silence
        out[bounds[k] : bounds[k] + len(seg)] = seg
    return out


def caption_lines(cap_words: list[dict], tm: TimeMap, W: int, H: int, st: Style):
    out_words = []
    for w in cap_words:
        i = tm.segment_of(w["start"], tol=0.03)
        if i is None:
            continue  # word was cut
        s = tm.cum[i] + max(0.0, w["start"] - tm.s[i])
        e = tm.cum[i] + min(w["end"], tm.e[i]) - tm.s[i]
        out_words.append({"word": w["word"], "start": float(s), "end": float(max(e, s + 0.05)), "item": i})
    out_words.sort(key=lambda w: w["start"])
    r = Renderer(W, H, st)
    lines = group_lines(out_words, W, r.font, st)
    # never let a caption linger into an insert (set clip, title card)
    ins_starts = [tm.cum[k] for k, it in enumerate(tm.items) if it["kind"] != "main"]
    for ln in lines:
        nxt = [t for t in ins_starts if t >= ln["end"] - 1e-6]
        if nxt:
            ln["show_end"] = min(ln["show_end"], nxt[0])
    return lines, r


class TitleCard:
    """Black frame, white Inter Bold text centred, text fades in/out."""

    def __init__(self, text: str, W: int, H: int, dur: float, fade: float, font_px_1080: float = 84):
        self.dur, self.fade = dur, fade
        fs = max(12, round(font_px_1080 * H / 1080))
        font = ImageFont.truetype(str(FONT_PATH), fs)
        words = text.split()

        def wrap(maxw: float) -> list[str]:
            lines, cur = [], ""
            for w in words:
                t = (cur + " " + w).strip()
                if cur and font.getlength(t) > maxw:
                    lines.append(cur)
                    cur = w
                else:
                    cur = t
            return lines + [cur]

        lines = wrap(W * 0.8)
        if len(lines) > 1:  # balance the lines instead of leaving one word on the last
            n, maxw = len(lines), font.getlength(text) / len(lines)
            while len(lines := wrap(maxw)) > n:
                maxw += fs * 0.25
        img = Image.new("L", (W, H), 0)
        d = ImageDraw.Draw(img)
        lh = fs * 1.25
        y = H / 2 - lh * len(lines) / 2
        for ln in lines:
            d.text((W / 2, y + lh / 2), ln, font=font, fill=255, anchor="mm")
            y += lh
        self.mask = np.asarray(img, np.float32) / 255.0

    def frame(self, t: float) -> np.ndarray:
        a = min(1.0, t / self.fade, (self.dur - t) / self.fade) if self.fade > 0 else 1.0
        v = (self.mask * max(0.0, a) * 255).astype(np.uint8)
        return np.repeat(v[:, :, None], 3, axis=2)


class FrameSource:
    """Sequential raw-frame reader over one file; re-seeks when asked to go backwards or far ahead."""

    def __init__(self, path: str, W: int, H: int, fps: float, conform: bool):
        self.path, self.W, self.H, self.fps, self.conform = path, W, H, fps, conform
        self.proc, self.cur, self.frame = None, -1, None

    def _open(self, idx: int):
        self.close()
        vf = []
        if self.conform:
            vf = ["-vf", f"fps={self.fps},scale={self.W}:{self.H}:force_original_aspect_ratio=decrease,"
                         f"pad={self.W}:{self.H}:(ow-iw)/2:(oh-ih)/2,setsar=1"]
        self.proc = subprocess.Popen(["ffmpeg", "-v", "error", "-ss", f"{idx / self.fps:.4f}", "-i", self.path, "-an",
                                      *vf, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
                                     stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        self.cur = idx - 1

    def get(self, idx: int) -> np.ndarray:
        if self.proc is None or idx < self.cur or idx - self.cur > self.fps * 10:
            self._open(idx)
        fsz = self.W * self.H * 3
        while self.cur < idx:
            b = self.proc.stdout.read(fsz)
            if len(b) < fsz:
                break  # EOF: repeat last frame
            self.frame = np.frombuffer(b, np.uint8).reshape(self.H, self.W, 3)
            self.cur += 1
        if self.frame is None:
            self.frame = np.zeros((self.H, self.W, 3), np.uint8)
        return self.frame

    def close(self):
        if self.proc is not None:
            self.proc.stdout.close()
            self.proc.kill()
            self.proc.wait()
            self.proc = None


def render(src: str, info: dict, decisions: dict, out_mp4: Path, out_srt: Path, work: Path, st: Style,
           fade_ms: float = 10.0, log=print) -> dict:
    import soundfile as sf

    from .audio import loudnorm_2pass, mix_mics

    W, H, fps = info["width"], info["height"], info["fps"]
    keeps = decisions["keep_segments"]
    inserts = decisions.get("inserts", [])
    offset = decisions["av_offset"]["applied_s"]
    aopt = decisions.get("audio", {"mix": "centred", "loudnorm": {"i": -14.0, "tp": -1.0}})
    tm = TimeMap(keeps, inserts)

    # ---- audio
    log("    audio: decode, shift, mix, cut with fades")
    full_wav = work / "audio_full.wav"
    if not full_wav.exists():
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", src, "-vn", "-c:a", "pcm_f32le", str(full_wav)], check=True)
    audio, sr = sf.read(str(full_wav), dtype="float32", always_2d=True)
    audio = shift_audio(audio, sr, offset)
    mix_info = {"mode": "original channels"}
    if aopt.get("mix") == "centred":
        audio, mix_info = mix_mics(audio, sr)
        log(f"    mic mix: gains L {mix_info['gain_db']['left']:+.1f} / R {mix_info['gain_db']['right']:+.1f} dB, "
            f"bleed ducking {mix_info['duck']['depth_db']:.0f} dB")
    cut = assemble_audio(audio, sr, tm, fade_ms, log)
    del audio
    cut_wav = work / "audio_cut.wav"
    sf.write(str(cut_wav), cut, sr, subtype="FLOAT")
    n_samples = len(cut)
    del cut
    ln_info = None
    if aopt.get("loudnorm"):
        log(f"    loudness: two-pass to {aopt['loudnorm']['i']} LUFS / {aopt['loudnorm']['tp']} dBTP")
        final_wav = work / "audio_final.wav"
        ln_info = loudnorm_2pass(cut_wav, final_wav, aopt["loudnorm"]["i"], aopt["loudnorm"]["tp"], sr)
        log(f"      {ln_info['input_i']:.1f} -> {ln_info['output_i']:.1f} LUFS, true peak {ln_info['output_tp']:.1f} dBTP")
        cut_wav = final_wav

    # ---- captions
    lines, rend = caption_lines(decisions["caption_words"], tm, W, H, st)
    write_srt(lines, out_srt)

    # ---- video
    n_out = int(round(n_samples / sr * fps))
    log(f"    video: {n_out} output frames, {len(tm.items)} timeline items ({len(inserts)} inserts)")
    enc = subprocess.Popen(
        ["ffmpeg", "-v", "error", "-y",
         "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", f"{fps}", "-i", "-",
         "-i", str(cut_wav),
         "-map", "0:v", "-map", "1:a",
         "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
         "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", str(out_mp4)],
        stdin=subprocess.PIPE,
    )
    sources: dict[str, FrameSource] = {src: FrameSource(src, W, H, fps, conform=False)}
    cards: dict[int, TitleCard] = {}
    hint = 0
    try:
        for n in range(n_out):
            t = (n + 0.5) / fps
            k = tm.item_at(t)
            it = tm.items[k]
            local = t - tm.cum[k]
            if it["kind"] == "main":
                frame = sources[src].get(max(0, int(round((it["start"] + local) * fps - 0.5))))
            elif it["kind"] == "clip":
                fsrc = sources.setdefault(it["path"], FrameSource(it["path"], W, H, fps, conform=True))
                frame = fsrc.get(int(round((it["start"] + local) * fps - 0.5)))
                vf = it.get("video_fade_out_s", 0.0)
                if vf and it["dur"] - local < vf:  # dip to black into a following title card
                    frame = (frame * max(0.0, (it["dur"] - local) / vf)).astype(np.uint8)
            else:
                if k not in cards:
                    cards[k] = TitleCard(it["text"], W, H, it["dur"], it.get("fade_s", 0.5))
                frame = cards[k].frame(local)
            out = frame.copy()
            if it["kind"] == "main":
                ln, cw, hint = state_at(lines, n / fps, hint)
                if ln is not None:
                    rend.composite(out, rend.strip(ln, cw))
            enc.stdin.write(out.tobytes())
            if n % (int(fps) * 120) == 0:
                log(f"      {n / fps / 60:5.1f}/{n_out / fps / 60:.1f} min")
    finally:
        enc.stdin.close()
        enc.wait()
        for s in sources.values():
            s.close()
    if enc.returncode != 0:
        raise RuntimeError("ffmpeg encode failed")
    return {"output_duration_s": round(n_samples / sr, 3), "caption_lines": len(lines), "frames": n_out,
            "audio_mix": mix_info, "loudness": ln_info,
            "inserts": [{k_: v for k_, v in it.items() if k_ != "dur"} for it in tm.items if it["kind"] != "main"]}
