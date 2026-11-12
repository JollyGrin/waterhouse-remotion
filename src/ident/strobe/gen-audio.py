# /// script
# requires-python = ">=3.10"
# dependencies = ["numpy"]
# ///
# Synthesises the STROBE sound kit into public/ident/audio/strobe/ (48 kHz mono s16, peak-normalised).
import numpy as np, wave, os
SR = 48000
OUT = os.path.join(os.path.dirname(__file__), "..", "..", "..", "public", "ident", "audio", "strobe")
rng = np.random.default_rng(7)

def save(name, x, peak_db=-3.0):
    x = x / (np.max(np.abs(x)) + 1e-9) * (10 ** (peak_db / 20))
    with wave.open(os.path.join(OUT, name), "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((x * 32767).astype(np.int16).tobytes())

def onepole_lp(x, fc):
    fc = np.broadcast_to(np.asarray(fc, dtype=float), x.shape)
    y = np.zeros_like(x); s = 0.0
    a = 1 - np.exp(-2 * np.pi * fc / SR)
    for i in range(len(x)):
        s += a[i] * (x[i] - s); y[i] = s
    return y

def hp(x, fc):
    return x - onepole_lp(x, fc)

def kick(dur, f0, f1, sweep, decay, drive, click=0.35):
    t = np.arange(int(dur * SR)) / SR
    f = f1 + (f0 - f1) * np.exp(-t / sweep)
    ph = 2 * np.pi * np.cumsum(f) / SR
    body = np.sin(ph) * np.exp(-t / decay)
    body = np.tanh(body * drive) / np.tanh(drive)
    n = rng.standard_normal(len(t)) * np.exp(-t / 0.004)
    c = hp(n, 2500) * click
    att = np.minimum(1, t / 0.0015)
    return (body + c) * att

# Techno kick for the strobe hits.
save("kick.wav", kick(0.55, 150, 46, 0.035, 0.16, 2.2))
# The landing: deeper, longer, dirtier, with a dark noise tail.
k = kick(1.4, 130, 40, 0.05, 0.42, 3.2, click=0.45)
t = np.arange(len(k)) / SR
tail = onepole_lp(rng.standard_normal(len(k)), 900) * np.exp(-t / 0.35) * 0.35
save("kick-big.wav", k + tail, -2.5)

# Strobe discharge: a dry tick plus a short metallic ring.
d = 0.12; t = np.arange(int(d * SR)) / SR
tick = hp(rng.standard_normal(len(t)), 3000) * np.exp(-t / 0.003)
ring = (np.sin(2 * np.pi * 2350 * t) + 0.6 * np.sin(2 * np.pi * 3710 * t)) * np.exp(-t / 0.025) * 0.25
save("zap.wav", tick + ring, -6)

# Sub drone with a slow beat, and a whisper of filtered noise (room tone).
d = 5.0; t = np.arange(int(d * SR)) / SR
dr = np.sin(2 * np.pi * 41.2 * t) + 0.35 * np.sin(2 * np.pi * 82.4 * t + 0.4) + 0.12 * np.sin(2 * np.pi * 123.6 * t)
dr *= 0.8 + 0.2 * np.sin(2 * np.pi * 0.45 * t)
room = onepole_lp(rng.standard_normal(len(t)), 420) * 0.5
x = dr + room
x *= np.minimum(1, t / 0.4) * np.minimum(1, (d - t) / 0.3)
save("drone.wav", x, -6)

# Filtered noise riser that stops dead.
d = 0.9; t = np.arange(int(d * SR)) / SR
fc = 200 * (6000 / 200) ** (t / d) ** 2
n = onepole_lp(rng.standard_normal(len(t)), fc)
n = hp(n, 150)
env = (t / d) ** 2.2
save("riser.wav", n * env, -6)
print("ok")
