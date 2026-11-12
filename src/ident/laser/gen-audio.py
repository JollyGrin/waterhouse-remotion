# /// script
# requires-python = ">=3.10"
# dependencies = ["numpy"]
# ///
# LASER sound bed -> public/ident/audio/laser/bed.wav (48 kHz stereo s16), on the src/ident/Laser.tsx timeline.
# The galvo buzz is the scan pattern itself: L = scanner x, R = scanner y, at the scan repeat rate.
import numpy as np, wave, os
SR = 48000
FPS = 30
OUT = os.path.join(os.path.dirname(__file__), "..", "..", "..", "public", "ident", "audio", "laser")
rng = np.random.default_rng(7)
DUR = 136 / FPS + 1.2
n = int(DUR * SR)
t = np.arange(n) / SR
fr = t * FPS

def at(f): return int(f / FPS * SR)
def filt(x, fc, hi=False, order=2):
    X = np.fft.rfft(x); fq = np.fft.rfftfreq(len(x), 1 / SR)
    X *= 1 / np.sqrt(1 + ((fc / np.maximum(fq, 1e-3)) if hi else (fq / fc)) ** (2 * order))
    return np.fft.irfft(X, len(x))
lp = lambda x, fc, o=2: filt(x, fc, False, o)
hp = lambda x, fc, o=2: filt(x, fc, True, o)
def smooth(a, b, x):
    s = np.clip((x - a) / (b - a), 0, 1); return s * s * (3 - 2 * s)
L = np.zeros(n); R = np.zeros(n)
def place(buf, x, f, g=1.0):
    i = at(f); m = min(len(x), len(buf) - i)
    if m > 0: buf[i:i + m] += x[:m] * g
def both(x, f, g=1.0, pan=0.0):
    place(L, x, f, g * (1 - max(0, pan))); place(R, x, f, g * (1 + min(0, pan)))

KICKS = [8, 23, 38, 53, 68, 83, 98]

# ---- kicks ----
def kick(dur, f0, f1, sweep, decay, drive, click=0.3):
    tt = np.arange(int(dur * SR)) / SR
    f = f1 + (f0 - f1) * np.exp(-tt / sweep)
    body = np.tanh(np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt / decay) * drive) / np.tanh(drive)
    c = hp(rng.standard_normal(len(tt)) * np.exp(-tt / 0.003), 2500) * click
    return (body + c) * np.minimum(1, tt / 0.0015)
k = kick(0.6, 170, 47, 0.032, 0.17, 2.2)
kb = kick(1.6, 150, 40, 0.05, 0.5, 3.0, click=0.45)
for f in KICKS:
    both(kb if f == 53 else k, f, 0.95 if f == 53 else 0.75)
# sub under the lock
tt = np.arange(int(2.0 * SR)) / SR
sub = np.sin(2 * np.pi * 41.2 * tt) * np.exp(-tt / 0.7) * np.minimum(1, tt / 0.01)
both(np.tanh(sub * 1.4) * 0.4, 53)

# ---- dark stab per laser cue: A minor add9, saw stack, closing filter, a short dub tail ----
def stab(dur, root_mul=1.0, bright=1.0):
    tt = np.arange(int(dur * SR)) / SR
    x = np.zeros(len(tt))
    for hz, a in [(110, 1), (130.81, 0.8), (164.81, 0.7), (246.94, 0.45), (55, 0.6)]:
        for det in (-0.12, 0.12):
            ph = (hz * root_mul * (1 + det / 100) * tt + rng.random()) % 1
            x += a * (2 * ph - 1)
    env = np.exp(-tt / 0.22) * np.minimum(1, tt / 0.004)
    # filter sweep: approximate with a crossfade of two lowpassed copies
    hi_ = lp(x, 2600 * bright); lo_ = lp(x, 420)
    m = np.exp(-tt / 0.07)
    y = (hi_ * m + lo_ * (1 - m)) * env
    return y / np.max(np.abs(y))
def tail(x, f, g, delay=0.375, fb=0.38, taps=4):
    for i in range(taps):
        pan = 0.5 if i % 2 else -0.5
        both(lp(x, 1800 - i * 300) * (fb ** i), f + i * delay * FPS, g, pan if i else 0)
for f, g, b in [(8, 0.32, 0.8), (23, 0.3, 0.9), (38, 0.32, 1.0), (53, 0.42, 1.2), (68, 0.28, 0.9), (83, 0.3, 1.0), (98, 0.24, 0.8)]:
    tail(stab(0.9, 1.0, b), f, g)

# ---- drone: detuned saws on A, the filter opens as the show builds ----
dr = np.zeros(n)
for hz, a in [(55, 1), (55.3, 0.9), (82.4, 0.5), (110.2, 0.25)]:
    dr += a * (2 * ((hz * t + rng.random()) % 1) - 1)
open_ = 160 + 900 * smooth(8, 53, fr)
dr = lp(dr, 260) * (1 - smooth(20, 53, fr)) + lp(dr, 700) * smooth(20, 53, fr)
dr *= 0.07 * smooth(0, 12, fr) * (1 - smooth(110, 126, fr))
L += dr; R += dr

# ---- haze machine: a hiss burst at the open, a bed after ----
hz_ = lp(hp(rng.standard_normal(n), 1800), 7000)
hz2 = lp(hp(rng.standard_normal(n), 1800), 7000)
gate = 0.05 * smooth(0, 2, fr) * (1 - smooth(4, 12, fr)) + 0.012 * smooth(4, 12, fr) * (1 - smooth(118, 130, fr))
L += hz_ * gate; R += hz2 * gate

# ---- projector: relay click on arm, fan hum from then on ----
tt = np.arange(int(0.4 * SR)) / SR
clk = hp(rng.standard_normal(len(tt)), 3000) * np.exp(-tt / 0.003) * 0.6 + np.sin(2 * np.pi * 70 * tt) * np.exp(-tt / 0.04) * 0.3
both(clk, 5, 0.5)
fan = sum(a * np.sin(2 * np.pi * h * 120 * t) for h, a in [(1, 1), (2, 0.4), (3, 0.2)])
fan = fan * 0.012 * smooth(5, 8, fr) * (1 - smooth(113, 118, fr))
L += fan; R += fan

# ---- the galvo signal: x on L, y on R ----
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
P = (np.array(pts) - [500, 333]) / 500.0
P[:, 1] *= -1
def trace(phase):
    u = (phase % 1) * len(P); i = np.floor(u).astype(int); f_ = u - i
    a = P[i % len(P)]; b = P[(i + 1) % len(P)]
    return a + (b - a) * f_[:, None]

# single beam: a servo whine with the swing speed
swing_v = np.abs(np.cos(np.pi * (fr - 8) / 15)) * ((fr >= 8) & (fr < 23))
servo = np.sin(2 * np.pi * np.cumsum(500 + 700 * swing_v) / SR) * swing_v * 0.03
L += servo; R += servo * 0.8

# fan: seven steps (discrete beams) at 33 Hz, filling to a triangle sweep (the sheet) at 66 Hz
fanw = ((fr >= 23) & (fr < 38)).astype(float)
sheet = smooth(29, 36, fr)
ph33 = (33 * t) % 1
steps = np.floor(ph33 * 7) / 3 - 1
tri = 2 * np.abs(2 * ((66 * t) % 1) - 1) - 1
xf = (1 - sheet) * steps + sheet * tri
# cone / tunnel: a circle, pure quadrature tone, rising as it opens and spins
cone = smooth(38, 40, fr) * (1 - smooth(47, 53, fr))
cf = 82 + 30 * smooth(40, 47, fr)
phc = np.cumsum(cf) / SR
xc, yc = np.cos(2 * np.pi * phc), np.sin(2 * np.pi * phc) * smooth(38, 42, fr)
# logo: the outline trace at 55 Hz; the title lengthens the scan (pitch drops); the spin narrows x
logo = smooth(47, 53, fr)
lf = 55 - 11 * smooth(72, 84, fr)
lo = trace(np.cumsum(lf) / SR)
th6 = 2 * np.pi * smooth(83, 97, fr)
lo[:, 0] *= np.cos(th6)
pull = np.where(fr >= 68, np.exp(-np.maximum(fr - 71, 0) / 4), 0) * smooth(68, 71, fr)
lo[:, 0] += 0.25 * pull * np.sign(lo[:, 0])
# exit: fold y to zero, stretch x, then the scan glides down and blanks
fold = smooth(106, 110, fr)
lo[:, 1] *= 1 - fold
lo[:, 0] *= 1 + 0.8 * smooth(109, 113, fr)
x = fanw * xf + cone * xc + logo * lo[:, 0]
y = cone * yc + logo * lo[:, 1]
glide = smooth(113, 124, fr)
lvl = 0.1 * (fr >= 23) * (1 - glide) * (1 + 0.5 * np.exp(-np.maximum(fr - 53, 0) / 5) * (fr >= 53))
L += lp(x * lvl, 3200); R += lp(y * lvl, 3200)

# the title being written: a thin vector buzz
w = smooth(72, 73, fr) * (1 - smooth(83, 85, fr))
wf = 240 + 80 * np.sin(2 * np.pi * 9 * t)
saw = 2 * ((np.cumsum(wf) / SR) % 1) - 1
buzz = lp(saw, 2000) * w * 0.035
L += buzz; R += buzz * 0.8

# ---- exit: the sheet rushes at the lens, the boom as it passes, a long dark tail ----
nz = hp(rng.standard_normal(n), 300)
op = smooth(110, 121, fr)
rush = (lp(nz, 500) * (1 - op) + lp(nz, 5000) * op) * smooth(108, 121, fr) ** 2 * (1 - smooth(121, 123, fr)) * 0.22
L += rush; R += rush
kx = kick(2.2, 120, 34, 0.08, 0.7, 3.5, click=0.6)
tt = np.arange(len(kx)) / SR
kx += lp(rng.standard_normal(len(kx)), 500) * np.exp(-tt / 0.5) * 0.4
both(kx, 121, 0.8)
tail(stab(1.4, 0.5, 0.6), 121, 0.14, delay=0.5, fb=0.4, taps=3)

S = np.stack([L, R], 1)
S = S / np.max(np.abs(S))
# level to about -13 dB RMS, then a soft limiter keeps the kicks under -1.5 dB peak
S *= 10 ** (-13 / 20) / np.sqrt(np.mean(S ** 2))
ceil = 10 ** (-1.5 / 20)
S = np.where(np.abs(S) > 0.6 * ceil, np.sign(S) * (0.6 * ceil + 0.4 * ceil * np.tanh((np.abs(S) - 0.6 * ceil) / (0.4 * ceil))), S)
with wave.open(os.path.join(OUT, "bed.wav"), "wb") as wv:
    wv.setnchannels(2); wv.setsampwidth(2); wv.setframerate(SR)
    wv.writeframes((S * 32767).astype(np.int16).tobytes())
print("bed.wav", S.shape, "peak dB", round(20 * np.log10(np.max(np.abs(S))), 1), "rms dB", round(20 * np.log10(np.sqrt(np.mean(S ** 2))), 1))
