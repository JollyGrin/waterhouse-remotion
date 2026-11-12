# /// script
# requires-python = ">=3.10"
# dependencies = ["numpy"]
# ///
# Synthesises the LOUVRE sound kit into public/ident/audio/louvre/ (48 kHz mono s16, peak-normalised).
# Fin landing times mirror src/ident/Louvre.tsx (W1/W2/W3, finEase lands at start + k*stagger + dur).
import numpy as np, wave, os
SR = 48000
FPS = 30
OUT = os.path.join(os.path.dirname(__file__), "..", "..", "..", "public", "ident", "audio", "louvre")
os.makedirs(OUT, exist_ok=True)
rng = np.random.default_rng(11)

def save(name, x, peak_db=-3.0):
    x = x / (np.max(np.abs(x)) + 1e-9) * (10 ** (peak_db / 20))
    with wave.open(os.path.join(OUT, name), "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((x * 32767).astype(np.int16).tobytes())

def lp(x, fc):
    fc = np.broadcast_to(np.asarray(fc, dtype=float), x.shape)
    a = 1 - np.exp(-2 * np.pi * fc / SR)
    y = np.zeros_like(x); s = 0.0
    for i in range(len(x)):
        s += a[i] * (x[i] - s); y[i] = s
    return y

def hp(x, fc):
    return x - lp(x, fc)

def tt(d):
    return np.arange(int(d * SR)) / SR

# One fin landing: a dry metal clack (noise transient + inharmonic ring) on a low thud.
def clack(pitch=1.0, weight=1.0, ring=1.0):
    t = tt(0.32)
    n = rng.standard_normal(len(t))
    trans = hp(n, 1800) * np.exp(-t / 0.0025)
    body = lp(n, 900) * np.exp(-t / 0.018) * 0.7
    fr = np.array([612, 1377, 2210, 3480]) * pitch
    amps = [0.5, 0.35, 0.22, 0.12]
    rg = sum(a * np.sin(2 * np.pi * f * t + rng.uniform(0, 6.28)) * np.exp(-t / (0.06 / (1 + j * 0.5))) for j, (f, a) in enumerate(zip(fr, amps)))
    thud = np.sin(2 * np.pi * (70 * pitch) * t) * np.exp(-t / 0.05) * weight
    return trans * 0.9 + body + rg * 0.35 * ring + thud * 0.9

def cascade(times, pitch0, edge=False):
    d = max(times) + 0.6
    x = np.zeros(int(d * SR))
    for j, tm in enumerate(times):
        c = clack(pitch0 * (1 + rng.uniform(-0.05, 0.05)), weight=0.6 if edge else 1.0, ring=0.6 if edge else 1.0)
        c *= 0.75 + rng.uniform(0, 0.25)
        i0 = int(tm * SR)
        x[i0:i0 + len(c)] += c[: len(x) - i0]
    return x

NV = 15
def lands(start, stagger, dur, ks):
    # relative to the Sequence start (start - 2)
    return sorted(((start + k * stagger + dur) - (start - 2)) / FPS for k in ks)

save("cascade1.wav", cascade(lands(12, 1.0, 19, range(NV)), 1.0), -4)
save("cascade2.wav", cascade(lands(58, 1.0, 19, range(NV)), 0.92), -4)
save("cascade3.wav", cascade(lands(105, 1.25, 15, [abs(i - 7) for i in range(NV)]), 1.12, edge=True), -6)

# Motor: a geared whir that spools up and winds down over a wave (~1.4 s).
d = 1.5; t = tt(d)
env = np.clip(t / 0.25, 0, 1) ** 1.5 * np.clip((d - t) / 0.45, 0, 1)
f0 = 58 + 34 * np.sin(np.pi * np.clip(t / 1.25, 0, 1))
ph = 2 * np.pi * np.cumsum(f0) / SR
saw = sum(np.sin(k * ph) / k for k in range(1, 14))
gear = 1 + 0.35 * np.sign(np.sin(2 * np.pi * np.cumsum(f0 * 0.33) / SR))
grit = hp(rng.standard_normal(len(t)), 2000) * 0.06 * (0.5 + 0.5 * np.sin(ph * 2.0))
m = lp(saw * gear, 900) + grit
save("motor.wav", m * env, -7)

# Sub boom on a wave landing.
t = tt(1.6)
f = 34 + 40 * np.exp(-t / 0.06)
b = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.5)
b = np.tanh(b * 2.4) / np.tanh(2.4)
tail = lp(rng.standard_normal(len(t)), 300) * np.exp(-t / 0.4) * 0.3
save("boom.wav", (b + tail) * np.minimum(1, t / 0.002), -2.5)

# Breaker: the rake light snaps on (heavy switch + mains buzz settling).
t = tt(0.9)
sw = hp(rng.standard_normal(len(t)), 1200) * np.exp(-t / 0.004) + np.sin(2 * np.pi * 90 * t) * np.exp(-t / 0.03) * 0.8
buzz = (np.sign(np.sin(2 * np.pi * 100 * t)) * 0.4 + np.sin(2 * np.pi * 50 * t)) * 0.12 * np.exp(-t / 0.35)
save("breaker.wav", sw + lp(buzz, 1500), -4)

# Low drone + room tone.
d = 5.2; t = tt(d)
dr = np.sin(2 * np.pi * 38.9 * t) + 0.3 * np.sin(2 * np.pi * 77.8 * t + 0.3) + 0.1 * np.sin(2 * np.pi * 116.7 * t)
dr *= 0.82 + 0.18 * np.sin(2 * np.pi * 0.4 * t)
room = lp(rng.standard_normal(len(t)), 380) * 0.45
save("drone.wav", (dr + room) * np.minimum(1, t / 0.3) * np.minimum(1, (d - t) / 0.3), -6)

# Part: fins whipping apart — air rush that rises and stops dead, with a low hit.
d = 0.75; t = tt(d)
fc = 300 * (5000 / 300) ** (t / d) ** 1.6
n = hp(lp(rng.standard_normal(len(t)), fc), 200) * (t / d) ** 2
hit = np.sin(2 * np.pi * np.cumsum(30 + 50 * np.exp(-np.clip(t - 0.36, 0, None) / 0.05)) / SR) * np.exp(-np.clip(t - 0.36, 0, None) / 0.3) * (t > 0.36)
save("part.wav", n * 0.8 + hit * 0.7, -4)
print("ok")
