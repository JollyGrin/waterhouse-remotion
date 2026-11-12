# /// script
# requires-python = ">=3.10"
# dependencies = ["numpy"]
# ///
# SCOPE sound bed -> public/ident/audio/scope/bed.wav (48 kHz stereo s16).
# The XY signal is the picture: L = beam x, R = beam y, on the same frame timeline as src/ident/Scope.tsx.
import numpy as np, wave, os
SR = 48000
FPS = 30
OUT = os.path.join(os.path.dirname(__file__), "..", "..", "..", "public", "ident", "audio", "scope")
rng = np.random.default_rng(11)
DUR = 134 / FPS + 0.6
n = int(DUR * SR)
t = np.arange(n) / SR
fr = t * FPS  # frame clock

def at(f):
    return int(f / FPS * SR)

def lp(x, fc, order=2):
    X = np.fft.rfft(x)
    fq = np.fft.rfftfreq(len(x), 1 / SR)
    X *= 1 / np.sqrt(1 + (fq / fc) ** (2 * order))
    return np.fft.irfft(X, len(x))

def hp(x, fc, order=2):
    X = np.fft.rfft(x)
    fq = np.fft.rfftfreq(len(x), 1 / SR)
    X *= 1 / np.sqrt(1 + (fc / np.maximum(fq, 1e-3)) ** (2 * order))
    return np.fft.irfft(X, len(x))

def smooth(a, b, x):
    s = np.clip((x - a) / (b - a), 0, 1)
    return s * s * (3 - 2 * s)

def place(buf, x, f, gain=1.0):
    i = at(f)
    m = min(len(x), len(buf) - i)
    buf[i:i + m] += x[:m] * gain

L = np.zeros(n); R = np.zeros(n)

def both(x, f, g=1.0, pan=0.0):
    place(L, x, f, g * (1 - max(0, pan)))
    place(R, x, f, g * (1 + min(0, pan)))

# ---- kicks ----
def kick(dur, f0, f1, sweep, decay, drive, click=0.3):
    tt = np.arange(int(dur * SR)) / SR
    f = f1 + (f0 - f1) * np.exp(-tt / sweep)
    ph = 2 * np.pi * np.cumsum(f) / SR
    body = np.tanh(np.sin(ph) * np.exp(-tt / decay) * drive) / np.tanh(drive)
    c = hp(rng.standard_normal(len(tt)) * np.exp(-tt / 0.003), 2500) * click
    return (body + c) * np.minimum(1, tt / 0.0015)

k = kick(0.6, 165, 48, 0.035, 0.17, 2.0)
for f in [15, 30, 45, 75, 90]:
    both(k, f, 0.8)
kb = kick(1.5, 150, 42, 0.05, 0.45, 3.0, click=0.4)
tb = np.arange(len(kb)) / SR
kb = kb + lp(rng.standard_normal(len(kb)), 700) * np.exp(-tb / 0.3) * 0.5
both(kb, 60, 0.95)

# ---- mains hum: from power-on to power-off ----
hum = sum(a * np.sin(2 * np.pi * 50 * h * t) for h, a in [(1, 1), (2, 0.5), (3, 0.35), (5, 0.12), (7, 0.06)])
hum = np.tanh(hum * 1.5) * 0.06 * smooth(2, 6, fr) * (1 - smooth(105, 108, fr))
L += hum; R += hum

# ---- power-on: relay tick + degauss thoom ----
d = 0.9; tt = np.arange(int(d * SR)) / SR
thoom = np.sin(2 * np.pi * np.cumsum(38 + 40 * np.exp(-tt / 0.08)) / SR) * np.exp(-tt / 0.25)
thoom += lp(rng.standard_normal(len(tt)), 400) * np.exp(-tt / 0.12) * 0.8
tick = hp(rng.standard_normal(len(tt)), 3000) * np.exp(-tt / 0.002) * 0.6
both(thoom * 0.5 + tick, 2, 0.6)

# ---- the XY signal ----
CX, CY = 540, 420 + 333 * 0.76
POLY = [
    [(348, 3), (0, 283), (0, 665), (348, 665)],
    [(379.6, 48.7), (685.2, 149), (685.2, 287.5), (379.6, 204.4)],
    [(722.2, 161), (1000, 252.3), (1000, 372.9), (722.2, 297.6)],
    [(596.6, 398), (775.1, 438.8), (775.1, 665.9), (596.6, 665.9)],
]
pts = []
for poly in POLY:
    loop = poly + [poly[0]]
    for a, b in zip(loop[:-1], loop[1:]):
        m = max(2, int(np.hypot(b[0] - a[0], b[1] - a[1]) / 4))
        for j in range(m):
            pts.append((a[0] + (b[0] - a[0]) * j / m, a[1] + (b[1] - a[1]) * j / m))
P = np.array(pts)
P = (130 + P * 0.76 - [CX, CY]) / np.array([400, 300])
P[:, 1] *= -1
def trace(phase):
    u = (phase % 1) * len(P)
    i = np.floor(u).astype(int); fr_ = u - i
    a = P[i % len(P)]; b = P[(i + 1) % len(P)]
    return a + (b - a) * fr_[:, None]

base = 55.0
# pitch: wobble on the f75 kick, collapse on power-off
bend = 1 - 0.28 * np.exp(-np.maximum(fr - 75, 0) / 4.2) * (fr >= 75) * np.cos(np.maximum(fr - 75, 0) * 1.3)
off = np.where(fr >= 105, np.exp(-(fr - 105) / 2.2), 1.0)
freq = base * bend * (0.15 + 0.85 * off)
phase = np.cumsum(freq) / SR
logo = trace(phase)
spin = 0.95 * np.exp(-np.maximum(fr - 90, 0) / 3) * (fr >= 90)
logo[:, 0] *= np.cos(spin)
logo += rng.standard_normal(logo.shape) * (20 / 300) * np.exp(-np.maximum(fr - 90, 0) / 2.6)[:, None] * (fr >= 90)[:, None]

phi = (fr - 33) * 0.16
lisx = np.sin(2 * np.pi * 3 * base * t + phi)
lisy = np.sin(2 * np.pi * 2 * base * t)

fold = smooth(33, 47, fr)
morph = smooth(45, 60, fr)
smear = 4 * morph * (1 - morph)
x = (1 - morph) * lisx + morph * logo[:, 0] + smear * 0.12 * np.sin(2 * np.pi * 23 * base * t)
y = (1 - morph) * lisy + morph * logo[:, 1] + smear * 0.12 * np.cos(2 * np.pi * 17 * base * t)
gate = fold * (1 - smooth(105, 112, fr))
lvl = 0.16 * gate * (1 + 0.6 * np.exp(-np.maximum(fr - 60, 0) / 5) * (fr >= 60))
xy_l = lp(x * lvl, 2600); xy_r = lp(y * lvl, 2600)
L += xy_l; R += xy_r

# ---- the title being written: a thin vector buzz, sweeping with the beam ----
w = smooth(64, 66, fr) * (1 - smooth(81, 84, fr))
wf = 220 + 90 * np.sin(2 * np.pi * 7.5 * t)
saw = 2 * ((np.cumsum(wf) / SR) % 1) - 1
buzz = lp(saw, 1800) * w * 0.05 * (0.6 + 0.4 * (np.sin(2 * np.pi * 15 * t) > 0))
L += buzz * 0.8; R += buzz

# ---- power-off: tchk, flyback whine falling, then the dot ping ----
d = 1.2; tt = np.arange(int(d * SR)) / SR
tchk = hp(rng.standard_normal(len(tt)), 1500) * np.exp(-tt / 0.006) * 0.9
thump = np.sin(2 * np.pi * np.cumsum(30 + 60 * np.exp(-tt / 0.05)) / SR) * np.exp(-tt / 0.3)
whine = np.sin(2 * np.pi * np.cumsum(1800 + 7000 * np.exp(-tt / 0.12)) / SR) * np.exp(-tt / 0.18) * 0.06
both(tchk + thump * 0.8 + whine, 105, 0.7)
d = 1.0; tt = np.arange(int(d * SR)) / SR
ping = (np.sin(2 * np.pi * 2900 * tt) * 0.5 + np.sin(2 * np.pi * 4400 * tt) * 0.25) * np.exp(-tt / 0.22) * np.minimum(1, tt / 0.01)
ping += hp(rng.standard_normal(len(tt)), 6000) * np.exp(-tt / 0.15) * 0.15
both(ping, 115, 0.12)

# ---- room: very low noise floor ----
room = lp(rng.standard_normal(n), 300) * 0.05 * smooth(0, 10, fr) * (1 - smooth(110, 124, fr))
L += room; R += room

S = np.stack([L, R], 1)
S = np.tanh(S * 1.2) / 1.2
S = S / np.max(np.abs(S)) * 10 ** (-1.5 / 20)
with wave.open(os.path.join(OUT, "bed.wav"), "wb") as wv:
    wv.setnchannels(2); wv.setsampwidth(2); wv.setframerate(SR)
    wv.writeframes((S * 32767).astype(np.int16).tobytes())
rms = 20 * np.log10(np.sqrt(np.mean(S ** 2)))
print("bed.wav", S.shape, "rms dB", round(rms, 1))
