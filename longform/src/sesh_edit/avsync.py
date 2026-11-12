"""A/V lag detection.

Primary (MediaPipe): mouth openness per frame from FaceLandmarker, cross-
correlated against the speech-band audio RMS envelope over +/-400ms.

Plain continuous cross-correlation turned out to be noise on these wide
shots: faces are ~40px 3/4 profiles, handheld mics sit in front of mouths,
and two people share one envelope. Locking to plosive word onsets fixes that.
We take every b/p-initial word from the aligned transcript (lips close, then
release right at the acoustic burst). For each one we sample the speaker's
mouth openness and the audio envelope over +/-0.8s around the onset, average
both across hundreds of events, then cross-correlate the two averages over
+/-400ms. Event times have sub-frame jitter, so the average resolves better
than one 33ms frame.

Secondary (LLM): a contact sheet of mouth crops around a few plosives,
marked at the chosen offset, goes to the `claude` CLI as a sanity check
(see cli.py).

Sign convention: offset_s > 0  => audio LAGS video (sound arrives late).
Fix = shift audio earlier by offset_s.
"""
from __future__ import annotations

import os
import subprocess
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

MODEL_URL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task"
CROP_PX = 720  # head crops are upscaled to this before landmarking
ENV_HZ = 100
MAX_LAG = 0.4
EVENT_HALF = 0.8  # seconds either side of each plosive onset
GRID = np.arange(-EVENT_HALF, EVENT_HALF + 1e-9, 0.01)  # 10ms grid for event averages


def _model_path() -> str:
    p = Path(os.environ.get("SESH_EDIT_CACHE", Path.home() / ".cache" / "sesh-edit")) / "face_landmarker.task"
    if not p.exists():
        p.parent.mkdir(parents=True, exist_ok=True)
        urllib.request.urlretrieve(MODEL_URL, p)
    return str(p)


def _landmarker():
    from mediapipe.tasks.python import BaseOptions, vision

    return vision.FaceLandmarker.create_from_options(
        vision.FaceLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=_model_path()),
            running_mode=vision.RunningMode.IMAGE,
            num_faces=1,
            min_face_detection_confidence=0.2,
            min_face_presence_confidence=0.2,
        )
    )


def read_frames(src: str, start: float, dur: float | None, w: int, h: int):
    cmd = ["ffmpeg", "-v", "error", "-ss", f"{start:.3f}"]
    if dur is not None:
        cmd += ["-t", f"{dur:.3f}"]
    cmd += ["-i", src, "-an", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    n = w * h * 3
    try:
        while True:
            b = p.stdout.read(n)
            if len(b) < n:
                break
            yield np.frombuffer(b, np.uint8).reshape(h, w, 3)
    finally:
        p.stdout.close()
        p.kill()
        p.wait()


def _mp_image(arr):
    import mediapipe as mp

    return mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(arr))


def _crop_up(frame, box):
    x0, y0, x1, y1 = box
    return np.array(Image.fromarray(frame[y0:y1, x0:x1]).resize((CROP_PX, CROP_PX), Image.BICUBIC))


def locate_heads(src: str, w: int, h: int, t_from: float, t_to: float, n_samples: int = 16) -> list[tuple]:
    """Scan overlapping square tiles (upscaled) on sampled frames; cluster faces by x."""
    s = int(h * 2 / 3)
    step = max(1, s // 3)
    xs = list(range(0, w - s + 1, step))
    if xs[-1] != w - s:
        xs.append(w - s)
    tiles = [(x, y, x + s, y + s) for y in sorted({0, (h - s) // 2}) for x in xs]
    lm = _landmarker()
    pts = []
    for t in np.linspace(t_from + 5, t_to - 5, n_samples):
        fr = next(read_frames(src, float(t), 0.1, w, h), None)
        if fr is None:
            continue
        for box in tiles:
            for f in lm.detect(_mp_image(_crop_up(fr, box))).face_landmarks:
                fx = [p.x for p in f]
                fy = [p.y for p in f]
                pts.append((box[0] + np.mean(fx) * s, box[1] + np.mean(fy) * s, (max(fy) - min(fy)) * s))
    lm.close()
    if not pts:
        return []
    pts.sort()
    clusters: list[list] = []
    for p in pts:
        if clusters and abs(p[0] - np.mean([q[0] for q in clusters[-1]])) < s / 2:
            clusters[-1].append(p)
        else:
            clusters.append([p])
    heads = []
    for c in clusters:
        if len(c) < max(3, n_samples // 4):
            continue
        cx = float(np.median([q[0] for q in c]))
        cy = float(np.median([q[1] for q in c]))
        fh = float(np.median([q[2] for q in c]))
        size = int(min(h, max(fh * 3.5, h * 0.4)))
        x0 = int(np.clip(cx - size / 2, 0, w - size))
        y0 = int(np.clip(cy - size / 2, 0, h - size))
        heads.append((x0, y0, x0 + size, y0 + size))
    return heads


def audio_envelope(audio16k: np.ndarray, sr: int = 16000) -> np.ndarray:
    """Speech-band (200-4000Hz) log-RMS envelope at ENV_HZ."""
    from scipy.signal import butter, sosfiltfilt

    sos = butter(4, [200, 4000], btype="band", fs=sr, output="sos")
    x = sosfiltfilt(sos, audio16k.astype(np.float64))
    hop = sr // ENV_HZ
    n = len(x) // hop
    rms = np.sqrt(np.mean(x[: n * hop].reshape(n, hop) ** 2, axis=1) + 1e-10)
    return np.log(rms + 1e-4)


def plosive_events(words, t_from, t_to, max_events=300):
    ev = []
    for i, wd in enumerate(words):
        t = wd["word"].strip().lower().lstrip("\"'(")
        if not t or t[0] not in "bp" or not wd.get("aligned", True):
            continue
        if wd["end"] - wd["start"] < 0.06:
            continue
        if not (t_from + 1 < wd["start"] < t_to - 1):
            continue
        ev.append(i)
    if len(ev) > max_events:
        ev = [ev[int(k)] for k in np.linspace(0, len(ev) - 1, max_events)]
    return ev


def _kernel_mean(rel_t: np.ndarray, vals: np.ndarray, sigma=0.012):
    out = np.zeros(len(GRID))
    for i, g in enumerate(GRID):
        wts = np.exp(-0.5 * ((rel_t - g) / sigma) ** 2)
        out[i] = (wts * vals).sum() / max(wts.sum(), 1e-9)
    return out


def _xcorr_lag(a: np.ndarray, b: np.ndarray):
    """Pearson r of a(t) vs b(t + lag) on GRID, lags +/-MAX_LAG. Returns lags, r."""
    lags = np.arange(-int(MAX_LAG * 100), int(MAX_LAG * 100) + 1)
    r = np.full(len(lags), np.nan)
    n = len(a)
    for i, L in enumerate(lags):
        lo, hi = max(0, -L), min(n, n - L)
        x, y = a[lo:hi], b[lo + L : hi + L]
        if len(x) > 20 and x.std() > 0 and y.std() > 0:
            r[i] = np.corrcoef(x, y)[0, 1]
    return lags / 100.0, r


def _peak(lags, r):
    pk = int(np.nanargmax(r))
    off = lags[pk]
    if 0 < pk < len(r) - 1 and np.isfinite(r[pk - 1]) and np.isfinite(r[pk + 1]):
        y0, y1, y2 = r[pk - 1], r[pk], r[pk + 1]
        den = y0 - 2 * y1 + y2
        if den != 0:
            off += 0.5 * (y0 - y2) / den * (lags[1] - lags[0])
    return float(off), float(r[pk])


def detect_offset(src, w, h, fps, audio16k, words, t_from, t_to, log=print, max_events=300):
    heads = locate_heads(src, w, h, t_from, t_to)
    log(f"    heads located: {len(heads)} {heads}")
    if not heads:
        return {"method": "mediapipe-plosive-locked-xcorr", "offset_s": 0.0, "confidence": 0.0, "note": "no faces found"}, None
    env = audio_envelope(audio16k)
    ev = plosive_events(words, t_from, t_to, max_events)
    log(f"    plosive (b/p) events: {len(ev)}")
    # frames we need -> list of (event_idx)
    need: dict[int, list[int]] = {}
    for e in ev:
        on = words[e]["start"]
        for fi in range(int(np.floor((on - EVENT_HALF) * fps)), int(np.ceil((on + EVENT_HALF) * fps)) + 1):
            need.setdefault(fi, []).append(e)
    lm = [_landmarker() for _ in heads]
    mouth: dict[int, list] = {}  # frame idx -> [openness per head]
    lipbox: dict[int, list] = {}
    first = min(need) if need else 0
    last = max(need) if need else 0
    t0 = max(0.0, first / fps)
    for k, fr in enumerate(read_frames(src, t0, (last - first + 2) / fps, w, h)):
        fi = int(round(t0 * fps)) + k
        if fi not in need:
            continue
        row, brow = [], []
        for hi, box in enumerate(heads):
            r = lm[hi].detect(_mp_image(_crop_up(fr, box)))
            if r.face_landmarks:
                f = r.face_landmarks[0]
                face_h = abs(f[10].y - f[152].y) + 1e-6
                row.append(abs(f[13].y - f[14].y) / face_h)
                sc = box[2] - box[0]
                cx = box[0] + np.mean([f[i].x for i in (61, 291, 0, 17)]) * sc
                cy = box[1] + np.mean([f[i].y for i in (61, 291, 0, 17)]) * sc
                half = max(face_h * sc * 0.3, 8)
                brow.append((cx - half, cy - half, cx + half, cy + half))
            else:
                row.append(np.nan)
                brow.append(None)
        mouth[fi] = row
        lipbox[fi] = brow
    for x in lm:
        x.close()

    # Per event: choose speaker head = the one whose mouth moves most around the onset.
    rel_all, z_all, used = [], [], []
    env_rel, env_z = [], []
    for e in ev:
        on = words[e]["start"]
        fis = [fi for fi in range(int(np.floor((on - EVENT_HALF) * fps)), int(np.ceil((on + EVENT_HALF) * fps)) + 1) if fi in mouth]
        if len(fis) < 0.8 * 2 * EVENT_HALF * fps:
            continue
        best = None
        for hi in range(len(heads)):
            v = np.array([mouth[fi][hi] for fi in fis], dtype=float)
            if np.isnan(v).mean() > 0.2:
                continue
            core = v[np.abs(np.array(fis) / fps - on) < 0.3]
            core = core[~np.isnan(core)]
            if len(core) < 6:
                continue
            score = np.std(core)
            if best is None or score > best[0]:
                best = (score, hi, v)
        if best is None:
            continue
        _, hi, v = best
        ok = ~np.isnan(v)
        rel = np.array(fis) / fps - on
        z = (v - np.nanmean(v)) / (np.nanstd(v) + 1e-9)
        rel_all.append(rel[ok])
        z_all.append(z[ok])
        used.append((e, hi))
        ei = (on + GRID) * ENV_HZ
        ev_env = np.interp(ei, np.arange(len(env)), env)
        env_z.append((ev_env - ev_env.mean()) / (ev_env.std() + 1e-9))
    if len(used) < 20:
        return {"method": "mediapipe-plosive-locked-xcorr", "offset_s": 0.0, "confidence": 0.0,
                "note": f"only {len(used)} usable plosive events", "heads": heads}, None

    def estimate(idx):
        m = _kernel_mean(np.concatenate([rel_all[i] for i in idx]), np.concatenate([z_all[i] for i in idx]))
        a = np.mean([env_z[i] for i in idx], axis=0)
        lags, r = _xcorr_lag(m, a)  # mouth(t) vs env(t+lag): lag>0 -> audio later
        return lags, r, m, a

    lags, r, m_avg, env_avg = estimate(range(len(used)))
    off, peak_r = _peak(lags, r)
    # bootstrap for confidence
    rng = np.random.default_rng(0)
    boots = []
    for _ in range(60):
        idx = rng.integers(0, len(used), len(used))
        bl, br, _, _ = estimate(idx)
        boots.append(_peak(bl, br)[0])
    boots = np.array(boots)
    spread = float(np.percentile(boots, 84) - np.percentile(boots, 16)) / 2
    conf = float(np.clip((1 - spread / 0.1) * min(1.0, max(peak_r, 0) / 0.6), 0, 1))
    res = {
        "method": "mediapipe-plosive-locked-xcorr",
        "offset_s": round(off, 3),
        "confidence": round(conf, 2),
        "peak_r": round(peak_r, 3),
        "bootstrap_1sigma_s": round(spread, 3),
        "bootstrap_median_s": round(float(np.median(boots)), 3),
        "events_used": len(used),
        "heads": [list(map(int, b)) for b in heads],
        "xcorr": {"lags_s": [round(float(x), 2) for x in lags], "r": [None if np.isnan(x) else round(float(x), 4) for x in r]},
        "event_avg": {"t_s": [round(float(x), 2) for x in GRID], "mouth_z": [round(float(x), 3) for x in m_avg],
                       "env_z": [round(float(x), 3) for x in env_avg]},
    }
    ctx = {"used": used, "lipbox": lipbox, "mouth": mouth}
    return res, ctx


# --------------------------------------------------------------- contact sheet

def plosive_contact_sheet(src, w, h, fps, words, ctx, offset_s, out_png: Path, n_words=6):
    """Mouth-crop strips around b/p onsets. Columns span from 200ms before the earlier of
    (audio onset, expected visual release) to 200ms after the later one. The frame where
    the lips SHOULD release if the offset is right (onset - offset) gets a blue border;
    the raw-audio-onset frame a thin yellow one."""
    used, lipbox, mouth = ctx["used"], ctx["lipbox"], ctx["mouth"]
    lo_f = int(np.floor((min(0.0, -offset_s) - 0.2) * fps))
    hi_f = int(np.ceil((max(0.0, -offset_s) + 0.2) * fps))
    rng_f = list(range(lo_f, hi_f + 1))
    scored = []
    for e, hi in used:
        on = words[e]["start"]
        fis = [int(round(on * fps)) + d for d in rng_f]
        if any(fi not in mouth or lipbox[fi][hi] is None for fi in fis):
            continue
        v = np.array([mouth[fi][hi] for fi in fis])
        scored.append((float(np.ptp(v)), e, hi))
    scored.sort(reverse=True)
    chosen, ts = [], []
    for s, e, hi in scored:
        if all(abs(words[e]["start"] - t) > 5 for t in ts):
            chosen.append((e, hi))
            ts.append(words[e]["start"])
        if len(chosen) >= n_words:
            break
    if not chosen:
        return None
    chosen.sort(key=lambda c: words[c[0]]["start"])
    n_fr = len(rng_f)
    cell, lab_w = (100 if n_fr <= 15 else 80), 150
    sheet = Image.new("RGB", (lab_w + cell * n_fr, 26 + cell * len(chosen)), (20, 20, 20))
    dr = ImageDraw.Draw(sheet)
    font = ImageFont.load_default()
    meta = []
    for row, (e, hi) in enumerate(chosen):
        on = words[e]["start"]
        c_fi = int(round(on * fps))
        fis = [c_fi + d for d in rng_f]
        boxes = np.array([lipbox[fi][hi] for fi in fis])
        bx = boxes.mean(0)
        cx, cy, half = (bx[0] + bx[2]) / 2, (bx[1] + bx[3]) / 2, (bx[2] - bx[0]) / 2 * 1.3
        frames = list(read_frames(src, fis[0] / fps, (n_fr + 0.5) / fps, w, h))[:n_fr]
        marked = int(np.argmin([abs((fi / fps - on) + offset_s) for fi in fis]))
        y = 26 + row * cell
        dr.text((6, y + 30), f"{row + 1}: '{words[e]['word'].strip()}'", fill=(255, 255, 255), font=font)
        dr.text((6, y + 46), f"t={on:.2f}s", fill=(160, 160, 160), font=font)
        for j, fr in enumerate(frames):
            if row == 0:
                dr.text((lab_w + j * cell + cell // 2 - 20, 6), f"{(fis[j] / fps - on) * 1000:+.0f}ms", fill=(220, 220, 220), font=font)
            x0, y0 = int(max(0, cx - half)), int(max(0, cy - half))
            x1, y1 = int(min(w, cx + half)), int(min(h, cy + half))
            im = Image.fromarray(fr[y0:y1, x0:x1]).resize((cell - 6, cell - 6), Image.BICUBIC)
            sheet.paste(im, (lab_w + j * cell + 3, y + 3))
            if fis[j] == c_fi:
                dr.rectangle([lab_w + j * cell + 1, y + 1, lab_w + (j + 1) * cell - 2, y + cell - 2], outline=(255, 210, 0), width=1)
            if j == marked:
                dr.rectangle([lab_w + j * cell, y, lab_w + (j + 1) * cell - 1, y + cell - 1], outline=(0, 174, 255), width=3)
        meta.append({"row": row + 1, "word": words[e]["word"].strip(), "onset_s": round(on, 3), "marked_col": marked + 1})
    sheet.save(out_png)
    return meta
