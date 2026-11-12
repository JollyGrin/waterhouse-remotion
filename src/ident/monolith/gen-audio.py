# /// script
# requires-python = ">=3.10"
# dependencies = ["numpy"]
# ///
"""Synthesise the MONOLITH sound kit (48 kHz mono 16-bit) into public/ident/audio/monolith/."""
import os, sys, wave
import numpy as np

SR = 48000
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "public", "ident", "audio", "monolith")
rng = np.random.default_rng(7)


def onepole_lp(x, fc):
    a = np.exp(-2 * np.pi * fc / SR)
    y = np.empty_like(x)
    acc = 0.0
    for i in range(len(x)):
        acc = (1 - a) * x[i] + a * acc
        y[i] = acc
    return y


def lp(x, fc, n=2):
    for _ in range(n):
        x = onepole_lp(x, fc)
    return x


def hp(x, fc):
    return x - lp(x, fc, 1)


def norm(x, db):
    return x / (np.max(np.abs(x)) + 1e-9) * 10 ** (db / 20)


def write(name, x):
    x = np.clip(x, -1, 1)
    with wave.open(f"{OUT}/{name}", "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((x * 32767).astype(np.int16).tobytes())


def t_(sec):
    return np.arange(int(SR * sec)) / SR


# boom: sub sine with a pitch drop, fast attack, ~1.5 s tail, plus a dull transient
t = t_(1.8)
f = 36 + 44 * np.exp(-t * 16)
ph = 2 * np.pi * np.cumsum(f) / SR
boom = np.sin(ph) * np.exp(-t * 2.6) * (1 - np.exp(-t * 600))
boom += 0.25 * np.sin(2 * ph) * np.exp(-t * 6)
click = lp(rng.standard_normal(len(t)) * np.exp(-t * 180), 900)
boom += 0.6 * click / (np.max(np.abs(click)) + 1e-9) * 0.5
boom = np.tanh(boom * 1.4)
write("boom.wav", norm(boom, -3))

# rumble: brown-ish noise, low-passed, slow swell, 5 s bed
t = t_(5.0)
n = np.cumsum(rng.standard_normal(len(t)))
n = hp(n, 18)
n = lp(n, 110, 3)
env = np.minimum(1, t / 0.8) * np.minimum(1, (5.0 - t) / 0.9) * (0.75 + 0.25 * np.sin(2 * np.pi * 0.35 * t))
write("rumble.wav", norm(n * env, -10))

# metal: inharmonic partials (struck steel beam), long low ring, short bright ring
t = t_(2.6)
f0 = 92.0
parts = [(1.0, 1.0, 1.2), (2.405, 0.6, 1.8), (3.87, 0.45, 2.6), (5.41, 0.3, 3.4), (6.93, 0.22, 4.5), (8.93, 0.15, 6.0), (1.006, 0.5, 1.3)]
metal = sum(a * np.sin(2 * np.pi * f0 * r * t + rng.uniform(0, 6.28)) * np.exp(-t * d) for r, a, d in parts)
tr = hp(rng.standard_normal(len(t)), 1500) * np.exp(-t * 90)
metal = metal * (1 - np.exp(-t * 900)) + 0.35 * tr
metal = lp(metal, 5000, 1)
write("metal.wav", norm(metal, -4))

# swell: reversed decaying noise+tone tail, ends abruptly (into the push)
t = t_(1.4)
tail = lp(rng.standard_normal(len(t)), 700, 2) * np.exp(-t * 3.2)
tail += 0.6 * np.sin(2 * np.pi * 55 * t) * np.exp(-t * 2.5)
tail += 0.3 * np.sin(2 * np.pi * 82.5 * t) * np.exp(-t * 3.0)
swell = tail[::-1] * np.minimum(1, (1.4 - t[::-1]) / 0.004 + 0)  # keep the abrupt end
write("swell.wav", norm(swell, -6))

# switch: heavy breaker — sharp click + low thunk + short ring
t = t_(0.6)
ck = hp(rng.standard_normal(len(t)), 2500) * np.exp(-t * 400)
th = np.sin(2 * np.pi * (70 + 60 * np.exp(-t * 40)) * t) * np.exp(-t * 18)
rg = 0.15 * np.sin(2 * np.pi * 410 * t) * np.exp(-t * 14) + 0.1 * np.sin(2 * np.pi * 997 * t) * np.exp(-t * 20)
write("switch.wav", norm(0.6 * ck + th + rg, -4))

# slit: airy high hiss opening (band-limited noise, fast attack, 0.7 s decay)
t = t_(0.9)
h = hp(lp(rng.standard_normal(len(t)), 7000, 1), 2200) * np.exp(-t * 5) * (1 - np.exp(-t * 300))
write("slit.wav", norm(h, -14))
print("ok")
