"""Audio finishing: dual-mic -> centred mix (level-matched, bleed-ducked) and two-pass loudnorm.

Waterhouse sessions record one RODE mic per speaker, each on its own channel, so played
as-is each voice sits in one ear. Each mic also picks up the other speaker ~16 dB down and
~2.4 ms late. Summed straight (after level matching) that late copy comb-filters the voice
("phasey"), so the channel that isn't speaking is ducked before summing.
"""
from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path

import numpy as np


def _frame_db(x: np.ndarray, hop: int) -> np.ndarray:
    n = len(x) // hop
    return 10 * np.log10((x[: n * hop].astype(np.float64).reshape(n, hop) ** 2).mean(1) + 1e-12)


def _smooth_gain_db(g: np.ndarray, frame_s: float, attack_s: float, release_s: float) -> np.ndarray:
    """One-pole smoothing: opening (gain rising) fast, closing slow."""
    a_up, a_dn = np.exp(-frame_s / attack_s), np.exp(-frame_s / release_s)
    out = np.empty_like(g)
    y = g[0]
    for i, v in enumerate(g):
        a = a_up if v > y else a_dn
        y = a * y + (1 - a) * v
        out[i] = y
    return out


def mix_mics(stereo: np.ndarray, sr: int, duck_db: float = 15.0, duck_from_db: float = 3.0,
             duck_full_db: float = 9.0) -> tuple[np.ndarray, dict]:
    """stereo (N, 2), one speaker per channel -> (N, 2) identical channels (centred).

    1. Level match: each channel's speech level = median 50ms level over frames where that
       channel clearly leads (> 6 dB over the other and well above the noise floor). Both
       channels are gained to the average of the two.
    2. Duck: per 10ms, a channel that is quieter than the other by more than `duck_from_db`
       is turned down, reaching -`duck_db` at `duck_full_db` difference. Opens in 10ms,
       closes over 200ms. When both talk (similar levels) both stay open.
    3. Sum, halve (so a single active voice keeps its level ~-6dB; loudnorm restores it).
    """
    if stereo.ndim != 2 or stereo.shape[1] < 2:
        return stereo, {"mode": "passthrough", "reason": "not stereo"}
    L, R = stereo[:, 0], stereo[:, 1]
    hop50 = sr // 20
    dl, dr = _frame_db(L, hop50), _frame_db(R, hop50)
    floor = min(np.percentile(dl, 10), np.percentile(dr, 10))
    lead_l = (dl - dr > 6) & (dl > floor + 15)
    lead_r = (dr - dl > 6) & (dr > floor + 15)
    lvl_l = float(np.median(dl[lead_l])) if lead_l.sum() > 20 else float(np.percentile(dl, 95))
    lvl_r = float(np.median(dr[lead_r])) if lead_r.sum() > 20 else float(np.percentile(dr, 95))
    target = (lvl_l + lvl_r) / 2
    g_l, g_r = target - lvl_l, target - lvl_r
    Lg, Rg = L * 10 ** (g_l / 20), R * 10 ** (g_r / 20)

    hop = sr // 100
    el = _frame_db(Lg, hop)
    er = _frame_db(Rg, hop)
    k = np.ones(3) / 3  # 30ms
    el, er = np.convolve(el, k, "same"), np.convolve(er, k, "same")
    ramp = lambda d: -duck_db * np.clip((d - duck_from_db) / (duck_full_db - duck_from_db), 0, 1)
    wl = _smooth_gain_db(ramp(er - el), 0.01, 0.01, 0.2)
    wr = _smooth_gain_db(ramp(el - er), 0.01, 0.01, 0.2)
    t_f = (np.arange(len(wl)) + 0.5) * hop
    t_s = np.arange(len(L))
    gl = 10 ** (np.interp(t_s, t_f, wl) / 20).astype(np.float32)
    gr = 10 ** (np.interp(t_s, t_f, wr) / 20).astype(np.float32)
    mono = (0.5 * (Lg * gl + Rg * gr)).astype(np.float32)
    info = {"mode": "centred-mix", "speech_level_db": {"left": round(lvl_l, 1), "right": round(lvl_r, 1)},
            "gain_db": {"left": round(g_l, 1), "right": round(g_r, 1)},
            "duck": {"depth_db": duck_db, "from_db": duck_from_db, "full_db": duck_full_db,
                     "time_ducked_left": round(float((wl < -6).mean()), 2),
                     "time_ducked_right": round(float((wr < -6).mean()), 2)}}
    return np.stack([mono, mono], axis=1), info


def _loudnorm_json(stderr: str) -> dict:
    m = re.findall(r"\{[^{}]*\}", stderr, re.S)
    return json.loads(m[-1])


def measure_loudness(wav: Path) -> dict:
    r = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(wav), "-af",
                        "loudnorm=I=-14:TP=-1:LRA=11:print_format=json", "-f", "null", "-"],
                       capture_output=True, text=True, check=True)
    return _loudnorm_json(r.stderr)


def _run_af(src: Path, dst: Path, af: str, sr: int) -> str:
    r = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-y", "-i", str(src), "-af", af, "-ar", str(sr),
                        "-c:a", "pcm_f32le", str(dst)], capture_output=True, text=True, check=True)
    return r.stderr


# Speech levelling before the final gain: gentle compression (3:1 above -28 dBFS, soft knee),
# then a 4x-oversampled limiter so true peaks stay under the ceiling after the gain.
COMPRESS = "acompressor=threshold=0.04:ratio=3:attack=8:release=200:knee=4:detection=rms"


def loudnorm_2pass(src: Path, dst: Path, target_i: float = -14.0, target_tp: float = -1.0, sr: int = 48000,
                   compress: bool = True) -> dict:
    """Two-pass loudness normalisation with ONE linear gain for the whole programme.

    Pass 1 measures integrated loudness (EBU R128, ffmpeg loudnorm analysis) after the
    compressor. Pass 2 applies compressor + the exact gain to reach `target_i` + a true-peak
    limiter at `target_tp` (run at 192 kHz, so inter-sample peaks are caught). The limiter
    slightly lowers loudness, so the gain is corrected once and re-applied; the result is
    re-measured and reported. (ffmpeg's loudnorm itself would fall back to its dynamic AGC
    mode here, because speech peaks sit ~24 dB above its loudness.)"""
    tmp = dst.with_name(dst.stem + ".compressed.wav")
    pre = COMPRESS if compress else "anull"
    _run_af(src, tmp, pre, sr)
    m1 = measure_loudness(tmp)
    gain = target_i - float(m1["input_i"])
    lim = f"aresample=192000,alimiter=limit={10 ** ((target_tp - 0.3) / 20):.4f}:attack=2:release=60:level=false,aresample={sr}"
    out = {}
    for _ in range(3):
        _run_af(tmp, dst, f"volume={gain:.2f}dB,{lim}", sr)
        out = measure_loudness(dst)
        err = target_i - float(out["input_i"])
        if abs(err) < 0.3:
            break
        gain += err
    tmp.unlink(missing_ok=True)
    m0 = measure_loudness(src)
    return {"target_i": target_i, "target_tp": target_tp, "compressor": pre, "gain_db": round(gain, 2),
            "input_i": float(m0["input_i"]), "input_tp": float(m0["input_tp"]), "input_lra": float(m0["input_lra"]),
            "output_i": float(out["input_i"]), "output_tp": float(out["input_tp"]), "output_lra": float(out["input_lra"])}
