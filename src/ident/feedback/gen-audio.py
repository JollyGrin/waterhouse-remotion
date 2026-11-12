# /// script
# requires-python = ">=3.10"
# dependencies = ["numpy"]
# ///
# Synthesises the FEEDBACK sound kit into public/ident/audio/feedback/ (48 kHz mono s16, peak-normalised).
# Video-feedback world: a feedback howl over a sub drone, VHS hiss, a deck clunk, a V-hold roll,
# kicks, a stutter with a tape stop, a CRT pop, and a howl that builds as the camera dives into the monitor.
import numpy as np, wave, os
SR = 48000
OUT = os.path.join(os.path.dirname(__file__), "..", "..", "..", "public", "ident", "audio", "feedback")
rng = np.random.default_rng(11)

def save(name, x, peak_db=-3.0):
    x = x / (np.max(np.abs(x)) + 1e-9) * (10 ** (peak_db / 20))
    with wave.open(os.path.join(OUT, name), "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((x * 32767).astype(np.int16).tobytes())

def lp(x, fc):
    fc = np.broadcast_to(np.asarray(fc, dtype=float), x.shape)
    a = 1 - np.exp(-2 * np.pi * fc / SR)
    y = np.empty_like(x); s = 0.0
    for i in range(len(x)):
        s += a[i] * (x[i] - s); y[i] = s
    return y

def hp(x, fc):
    return x - lp(x, fc)

def bp(x, f0, q):
    # 2-pole resonator (constant f0 or per-sample array)
    f0 = np.broadcast_to(np.asarray(f0, dtype=float), x.shape)
    y = np.zeros_like(x); y1 = y2 = 0.0
    for i in range(len(x)):
        w = 2 * np.pi * f0[i] / SR
        r = 1 - w / (2 * q)
        c = 2 * r * np.cos(w)
        v = x[i] * (1 - r) + c * y1 - r * r * y2
        y2, y1 = y1, v; y[i] = v
    return y

def T(d):
    return np.arange(int(d * SR)) / SR

def kick(dur, f0, f1, sweep, decay, drive, click=0.3):
    t = T(dur)
    f = f1 + (f0 - f1) * np.exp(-t / sweep)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / decay)
    body = np.tanh(body * drive) / np.tanh(drive)
    c = hp(rng.standard_normal(len(t)) * np.exp(-t / 0.004), 2500) * click
    return (body + c) * np.minimum(1, t / 0.0015)

# kicks
save("kick.wav", kick(0.6, 140, 44, 0.038, 0.18, 2.4))
k = kick(1.5, 120, 38, 0.05, 0.45, 3.4, click=0.4)
t = np.arange(len(k)) / SR
save("kick-big.wav", k + lp(rng.standard_normal(len(k)), 700) * np.exp(-t / 0.3) * 0.3, -2.5)

# howl: sub drone + a resonant feedback tone that drifts and swells, dark
d = 5.0; t = T(d)
sub = np.sin(2 * np.pi * 43.65 * t) + 0.3 * np.sin(2 * np.pi * 87.3 * t + 0.6)
sub *= 0.85 + 0.15 * np.sin(2 * np.pi * 0.5 * t)
n = rng.standard_normal(len(t))
f0 = 311 * (1 + 0.012 * np.sin(2 * np.pi * 0.23 * t) + 0.004 * np.sin(2 * np.pi * 3.1 * t))
ring = bp(n, f0, 160)
ring = np.tanh(ring / (np.std(ring) * 2.2)) * (0.5 + 0.5 * np.sin(2 * np.pi * 0.31 * t - 1.2) ** 2)
ring2 = bp(n, f0 * 1.5, 220); ring2 = ring2 / (np.std(ring2) * 3 + 1e-9)
room = lp(n, 380) * 3
x = sub * 1.0 + ring * 0.18 + ring2 * 0.06 + room * 0.25
x *= np.minimum(1, t / 0.35) * np.minimum(1, (d - t) / 0.3)
save("howl.wav", x, -6)

# VHS hiss: bright tape noise with a 15.7k whine and a little flutter
d = 5.0; t = T(d)
hs = hp(lp(rng.standard_normal(len(t)), 9000), 1800)
hs *= 1 + 0.12 * np.sin(2 * np.pi * 6.3 * t)
hs += 0.05 * np.sin(2 * np.pi * 15734 * t)
hs *= np.minimum(1, t / 0.05) * np.minimum(1, (d - t) / 0.2)
save("hiss.wav", hs, -10)

# deck: play-mechanism clunk + capstan motor spin-up
d = 0.6; t = T(d)
cl = lp(rng.standard_normal(len(t)), 1200) * np.exp(-t / 0.018) * 1.4
th = np.sin(2 * np.pi * 70 * t) * np.exp(-t / 0.06)
mf = 60 + 120 * (1 - np.exp(-t / 0.15))
mo = np.sign(np.sin(2 * np.pi * np.cumsum(mf) / SR)) * 0.06 * np.minimum(1, t / 0.1) * np.exp(-np.maximum(0, t - 0.35) / 0.1)
save("deck.wav", lp(cl + th + mo, 3000), -5)

# roll: the V-hold roll, a 60 Hz sync buzz sweeping down with a whoosh, locking on the kick
d = 0.32; t = T(d)
bf = 120 * (1 - 0.5 * t / d)
buzz = np.sign(np.sin(2 * np.pi * np.cumsum(bf) / SR)) * 0.25
wh = lp(rng.standard_normal(len(t)), 2500 * (1 - t / d) + 300) * 0.8
env = np.minimum(1, t / 0.02) * (1 - t / d) ** 0.6
save("roll.wav", lp(buzz, 1500) * env + wh * env, -8)

# stutter: two 0.1 s repeats of a howl slice, then a 70 ms tape stop
src, _ = None, None
h = x  # howl buffer (pre-normalised)
sl = h[int(1.2 * SR): int(1.3 * SR)] * 2.0
sl = sl * np.minimum(1, np.arange(len(sl)) / 120) * np.minimum(1, (len(sl) - np.arange(len(sl))) / 240)
hsl = hs[: len(sl)] * 0.8
rep = np.concatenate([sl + hsl, sl + hsl])
ts = h[int(1.3 * SR): int(1.5 * SR)] * 2.0
d = 0.08; t = T(d)
rate = (1 - t / d) ** 1.5
pos = np.cumsum(rate)
pos = np.clip(pos, 0, len(ts) - 1)
stop = np.interp(pos, np.arange(len(ts)), ts) * (1 - t / d) ** 0.5
save("stutter.wav", np.concatenate([rep, stop]), -6)

# rewind squeal: a fast warbly upward chirp (tape rewinding past the head)
d = 0.12; t = T(d)
cf = 900 * (5000 / 900) ** (t / d)
ch = np.sin(2 * np.pi * np.cumsum(cf * (1 + 0.05 * np.sin(2 * np.pi * 60 * t))) / SR)
ch = hp(ch + lp(rng.standard_normal(len(t)), cf) * 0.5, 400) * np.minimum(1, t / 0.01) * (1 - t / d)
save("rewind.wav", ch, -10)

# lock: the picture locks, a dry thud + a short low sine and a tiny tick
d = 0.5; t = T(d)
lk = np.sin(2 * np.pi * 58 * t) * np.exp(-t / 0.09) + hp(rng.standard_normal(len(t)), 4000) * np.exp(-t / 0.002) * 0.4
save("lock.wav", lk, -5)

# pop: CRT channel switch, a static burst with a degauss-ish low thump
d = 0.35; t = T(d)
st = hp(rng.standard_normal(len(t)), 600) * np.exp(-t / 0.035)
dg = np.sin(2 * np.pi * 50 * t) * np.exp(-t / 0.12) * 0.7 * np.minimum(1, t / 0.005)
save("pop.wav", st * 0.6 + dg, -6)

# dive: the feedback howl builds as the camera nears the monitor (pitch + level rise), with a whoosh, cut dead
d = 0.85; t = T(d)
p = (t / d)
nn = rng.standard_normal(len(t))
fr = 311 * (1 + 0.9 * p ** 2.2)
hw = bp(nn, fr, 120); hw = np.tanh(hw / (np.std(hw) * 1.6))
ws = lp(nn, 300 + 7000 * p ** 2.5); ws = hp(ws, 150)
env = p ** 1.8
dv = (hw * 0.55 + ws * 0.7) * env
dv[-int(0.004 * SR):] *= np.linspace(1, 0, int(0.004 * SR))
save("dive.wav", dv, -5)

# sub: the landing on the other side
d = 1.6; t = T(d)
sb = kick(1.6, 90, 32, 0.08, 0.6, 2.0, click=0.15) + lp(rng.standard_normal(len(t)), 220) * np.exp(-t / 0.5) * 0.25
save("sub.wav", sb, -3)
print("ok")
