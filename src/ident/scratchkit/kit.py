"""Shared scratch kit for the Scope x Platter hybrids (Splice, Groove, Phosphor).

The scratch source is a real voice: Denzo saying "Waterhouse" in Waterhouse Sessions
(YouTube mWNWTIGghjc, 12:25.78-12:26.30), cleaned and frozen into denzo-waterhouse.wav.
It is pressed into the record at the catch point, and the generators read it back through
their physical record model (variable-rate playback from the rotation curve), so every
stroke, backspin and chirp is the stylus actually dragging the voice back and forth.
On top: hand/slipmat friction while the hand is on the record, and crossfader clicks.
"""
import os, wave
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
WAV = os.path.join(HERE, "denzo-waterhouse.wav")
SRC = "/home/dean/scratch/sessions-transcripts/audio/mWNWTIGghjc.m4a"
CLIP = (745.775, 746.31)
SR = 48000
STROKE_SCALE = 1.0  # natural baby-scratch hand speed: 1.5 read the voice ~7 semitones too high (Dean, 2026-11-09)


def _biquad(x, b, a):
    y = np.zeros_like(x)
    x1 = x2 = y1 = y2 = 0.0
    b0, b1, b2 = b
    _, a1, a2 = a
    for i in range(len(x)):
        y0 = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
        y[i] = y0
        x2, x1, y2, y1 = x1, x[i], y1, y0
    return y


def _hp(x, fc, q=0.707):
    w = 2 * np.pi * fc / SR
    al = np.sin(w) / (2 * q)
    c = np.cos(w)
    a0 = 1 + al
    return _biquad(x, ((1 + c) / 2 / a0, -(1 + c) / a0, (1 + c) / 2 / a0), (1, -2 * c / a0, (1 - al) / a0))


def _lp(x, fc, q=0.707):
    w = 2 * np.pi * fc / SR
    al = np.sin(w) / (2 * q)
    c = np.cos(w)
    a0 = 1 + al
    return _biquad(x, ((1 - c) / 2 / a0, (1 - c) / a0, (1 - c) / 2 / a0), (1, -2 * c / a0, (1 - al) / a0))


def prep():
    """Cut and clean the clip from the episode audio (only needed once; the wav is committed)."""
    import subprocess
    ff = os.path.expanduser("~/.local/opt/ffmpeg-7.0.2-amd64-static/ffmpeg")
    a, b = CLIP
    raw = subprocess.run([ff, "-v", "error", "-ss", "%.3f" % (a - 0.05), "-t", "%.3f" % (b - a + 0.1), "-i", SRC,
                          "-ac", "1", "-ar", str(SR), "-f", "s16le", "-"], check=True, capture_output=True).stdout
    x = np.frombuffer(raw, np.int16).astype(float) / 32768
    x = x[int(0.05 * SR):int((0.05 + b - a) * SR)]
    x = _hp(_hp(x, 110), 110)
    x = _lp(x, 9000)
    # gentle compression + gate the room tail
    env = np.sqrt(np.convolve(x ** 2, np.ones(240) / 240, "same")) + 1e-6
    g = np.minimum(1, (env / env.max() / 0.25) ** -0.45)
    x = x * g
    x = x / np.max(np.abs(x)) * 0.92
    n = len(x)
    t = np.arange(n) / SR
    x *= np.minimum(1, t / 0.003) * np.minimum(1, (n / SR - t) / 0.03)
    with wave.open(WAV, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((x * 32767).astype(np.int16).tobytes())
    return x


def vocal():
    if not os.path.exists(WAV):
        return prep()
    with wave.open(WAV) as w:
        return np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(float) / 32768


def scale_strokes(strokes):
    return [(a, b, p * STROKE_SCALE, q * STROKE_SCALE) for (a, b, p, q) in strokes]


def friction(t_frames, speed, strokes, rng):
    """Hand on the record: a dry rub on the vinyl/slipmat, louder with speed, only while the hand is on it."""
    n = len(t_frames)
    a0, b0 = strokes[0][0], strokes[-1][1]
    on = ((t_frames >= a0 - 0.3) & (t_frames < b0 + 0.3)).astype(float)
    on = np.convolve(on, np.ones(96) / 96, "same")
    nz = rng.standard_normal(n)
    nz = _lp(_hp(nz, 700), 3800)
    return nz * on * np.clip(speed / 3.0, 0, 1) ** 0.8 * 0.05


def fader_clicks(t_frames, closed, fps=30):
    """Tiny crossfader clicks on every cut in/out."""
    n = len(t_frames)
    out = np.zeros(n)
    m = int(0.0025 * SR)
    tk = np.arange(m) / SR
    clk = np.sin(2 * np.pi * 2600 * tk) * np.exp(-tk / 0.0006)
    for (a, b) in closed:
        for edge, g in ((a, 0.07), (b, 0.05)):
            i = int(np.searchsorted(t_frames, edge))
            if i < n:
                out[i:i + m] += clk[: n - i] * g
    return out


def scratch_gate(t_frames, strokes, sm):
    """1 while the scratch runs (first stroke to last): use it to pull the beat out."""
    a0, b0 = strokes[0][0], strokes[-1][1]
    return sm(a0 - 0.6, a0 + 0.2, t_frames) * (1 - sm(b0 - 0.6, b0 + 0.1, t_frames))
