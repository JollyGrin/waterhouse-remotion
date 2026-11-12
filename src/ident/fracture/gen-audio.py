# /// script
# requires-python = ">=3.10"
# dependencies = ["numpy"]
# ///
"""Synthesise the FRACTURE sound kit (48 kHz mono 16-bit) into public/ident/audio/fracture/.
Concrete: chisel impacts, cracks, rubble, sub boom, room drone, the final break, an air drop."""
import os, sys, wave
import numpy as np

SR = 48000
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "public", "ident", "audio", "fracture")
rng = np.random.default_rng(23)


def t_(sec):
    return np.arange(int(SR * sec)) / SR


def band(x, lo=None, hi=None, order=4):
    """FFT band filter with smooth (Butterworth-like) skirts."""
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    g = np.ones_like(f)
    if hi:
        g *= 1 / np.sqrt(1 + (f / hi) ** (2 * order))
    if lo:
        g *= 1 / np.sqrt(1 + (lo / np.maximum(f, 1e-3)) ** (2 * order))
    return np.fft.irfft(X * g, len(x))


def norm(x, db):
    return x / (np.max(np.abs(x)) + 1e-9) * 10 ** (db / 20)


def write(name, x):
    x = np.clip(x, -1, 1)
    fade = np.minimum(1, (len(x) - np.arange(len(x))) / (SR * 0.01))
    x = x * fade
    with wave.open(f"{OUT}/{name}", "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((x * 32767).astype(np.int16).tobytes())


def sub(sec=1.8, f_lo=34, f_hi=78, drop=14, dec=2.4):
    t = t_(sec)
    f = f_lo + (f_hi - f_lo) * np.exp(-t * drop)
    ph = 2 * np.pi * np.cumsum(f) / SR
    s = np.sin(ph) * np.exp(-t * dec) * (1 - np.exp(-t * 500))
    s += 0.22 * np.sin(2 * ph) * np.exp(-t * 6)
    return np.tanh(s * 1.5)


def crackle(sec, n, spread, lo=1200, hi=9000, seed_dec=60):
    """A fracture: a sharp first snap and a fast decaying train of micro-snaps."""
    t = t_(sec)
    x = np.zeros_like(t)
    times = np.sort(np.concatenate([[0.0], rng.exponential(spread, n)]))
    for i, tt in enumerate(times):
        i0 = int(tt * SR)
        if i0 >= len(t):
            continue
        L = min(len(t) - i0, int(SR * 0.012))
        amp = (1.0 if i == 0 else rng.uniform(0.15, 0.7)) * np.exp(-tt * 6)
        x[i0 : i0 + L] += amp * rng.standard_normal(L) * np.exp(-np.arange(L) / (SR * 0.0025))
    return band(x, lo, hi)


# impact: hammer and chisel on stone. Dull knock body + bright tick + small sub
t = t_(0.9)
knock = np.sin(2 * np.pi * (180 + 90 * np.exp(-t * 60)) * t) * np.exp(-t * 26)
knock += 0.5 * np.sin(2 * np.pi * 410 * t + 1) * np.exp(-t * 40)
tick = band(rng.standard_normal(len(t)), 2500, 9000) * np.exp(-t * 260)
body = band(rng.standard_normal(len(t)), 120, 900) * np.exp(-t * 30)
imp = 0.9 * knock + 0.7 * tick + 0.6 * body + 0.6 * sub(0.9, 40, 90, 22, 7)
write("impact.wav", norm(np.tanh(imp * 1.3), -3))

# crack: a fracture running through the slab
c = crackle(0.7, 40, 0.07)
c += 0.4 * crackle(0.7, 15, 0.12, 300, 2500)
write("crack.wav", norm(c, -5))

# rubble: chunks and grit falling away (many small hits, low-mid), ~1.6 s
t = t_(1.8)
x = np.zeros_like(t)
for _ in range(260):
    tt = rng.gamma(2.0, 0.22)
    i0 = int(tt * SR)
    if i0 >= len(t) - 10:
        continue
    L = min(len(t) - i0, int(SR * rng.uniform(0.004, 0.03)))
    f0 = rng.uniform(140, 1200)
    k = np.arange(L) / SR
    grain = (np.sin(2 * np.pi * f0 * k) * 0.6 + rng.standard_normal(L) * 0.5) * np.exp(-k * rng.uniform(80, 300))
    x[i0 : i0 + L] += grain * rng.uniform(0.2, 1.0) * np.exp(-tt * 1.6)
x = band(x, 90, 5000)
x += 0.35 * band(rng.standard_normal(len(t)), 80, 600) * np.exp(-t * 3) * (1 - np.exp(-t * 30))
write("rubble.wav", norm(x, -6))

# boom: the slab gives (low, long)
b = sub(2.2, 30, 70, 10, 1.8)
b += 0.3 * band(rng.standard_normal(len(b)), 40, 300) * np.exp(-t_(2.2) * 4)
write("boom.wav", norm(b, -2))

# drone: concrete room tone, 5.5 s (brown noise + two low partials beating)
t = t_(5.5)
n = np.cumsum(rng.standard_normal(len(t)))
n = band(n, 22, 160)
n = n / np.max(np.abs(n))
tone = 0.25 * np.sin(2 * np.pi * 43.65 * t) + 0.18 * np.sin(2 * np.pi * 44.2 * t) + 0.08 * np.sin(2 * np.pi * 87.3 * t)
env = np.minimum(1, t / 0.6) * np.minimum(1, (5.5 - t) / 0.5)
write("drone.wav", norm((n + tone) * env, -11))

# light: work lamp contactor clunk + faint ballast buzz tail
t = t_(0.8)
ck = band(rng.standard_normal(len(t)), 2000, 8000) * np.exp(-t * 350)
th = np.sin(2 * np.pi * (85 + 50 * np.exp(-t * 40)) * t) * np.exp(-t * 16)
bz = 0.06 * np.sign(np.sin(2 * np.pi * 100 * t)) * np.exp(-t * 3) * (t > 0.02)
write("light.wav", norm(0.6 * ck + th + band(bz, 80, 3000), -5))

# tension: a hairline creak running out (pre-break), rising crackle density, 0.35 s
t = t_(0.5)
cr = crackle(0.5, 70, 0.18, 1500, 10000) * np.minimum(1, t / 0.3)
cr += 0.3 * band(rng.standard_normal(len(t)), 300, 1200) * (t / 0.5) ** 2
write("tension.wav", norm(cr, -8))

# break: the whole thing gives. Big crack, sub, long rubble tail
t = t_(2.6)
br = np.zeros_like(t)
c = crackle(1.0, 120, 0.09, 600, 10000)
br[: len(c)] += 1.0 * c
s = sub(2.6, 28, 90, 9, 1.6)
br += 1.1 * s
rb = band(rng.standard_normal(len(t)), 100, 2500) * np.exp(-t * 1.8) * (1 - np.exp(-t * 12))
br += 0.45 * rb
write("break.wav", norm(np.tanh(br * 1.2), -1))

# air: the drop, a dark whoosh swelling into the break and falling away (0.9 s)
t = t_(0.9)
a = band(rng.standard_normal(len(t)), 120, 1400) * np.exp(-((t - 0.25) ** 2) / 0.03)
write("air.wav", norm(a, -9))
print("ok")
