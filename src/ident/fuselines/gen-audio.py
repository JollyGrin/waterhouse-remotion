# /// script
# requires-python = ">=3.10"
# dependencies = ["numpy"]
# ///
# SPLICE: Scope's first half, hard-cut on the big kick into Platter's second half.
#
# Writes:
#   src/ident/splice/motion.ts          record angle theta(f) in degrees, 8 samples per frame, indexed by SPLICE frames
#   public/ident/audio/splice/mix.wav   48 kHz stereo: the Scope XY bed (L = beam x, R = beam y) up to the cut,
#                                 then the Platter decks (centre), sample-locked to the record's rotation
#
# Timeline (Splice frames, 30 fps, 120 bpm, beat = 15 f):
#   Scope time s = sOf(f): the power-on is compressed into f 0-6 (s 1-11), then s = f + 5.
#     Scope kicks s 15/30/45 -> f 10/25/40; Scope's lock s 60 -> f 55 = CUT.
#   Platter time p = f - 10: Platter's catch-on-the-drop p 45 -> f 55 = CUT.
#     scratches p 45-75 (f 55-85), title on the hold p 75 (f 85), release p 90 (f 100),
#     brake p 97 (f 107), rings p 106 (f 116), stylus lift p 127 (f 137), clear p 130 (f 140).
import numpy as np, wave, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scratchkit"))
import kit  # real-vocal scratch kit: Denzo "Waterhouse", friction, fader clicks
# FUSE-LINES: same hand, same record motion as Splice/Fuse; only the pressing changes.
# argv[1] = semitones DOWN: Denzo is pressed slowed tape-style (pitch and time together), so every
# stroke reads him lower at the identical hand speed. motion.ts is NOT rewritten (theta is unchanged).
PITCH = float(sys.argv[1]) if len(sys.argv) > 1 else 0.0

SR = 48000
FPS = 30
FRAMES = 150
CUT = 55
P_OFF = 10
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "..", "..", "public", "ident", "audio", "fuselines")
os.makedirs(OUT, exist_ok=True)
rng = np.random.default_rng(55)

DUR = FRAMES / FPS + 0.3
N = int(DUR * SR)
ts = np.arange(N) / SR
fr = ts * FPS  # splice frame clock


def s_of(f):
    f = np.asarray(f, dtype=float)
    return np.where(f < 6, 1 + f * 10 / 6, f + 5)


def smooth(a, b, x):
    s = np.clip((x - a) / (b - a), 0, 1)
    return s * s * (3 - 2 * s)


def smooth01(x):
    x = np.clip(x, 0, 1)
    return x * x * (3 - 2 * x)


def lp(x, fc, order=2):  # FFT low-pass (Scope's)
    X = np.fft.rfft(x)
    fq = np.fft.rfftfreq(len(x), 1 / SR)
    X *= 1 / np.sqrt(1 + (fq / fc) ** (2 * order))
    return np.fft.irfft(X, len(x))


def hpf(x, fc, order=2):
    X = np.fft.rfft(x)
    fq = np.fft.rfftfreq(len(x), 1 / SR)
    X *= 1 / np.sqrt(1 + (fc / np.maximum(fq, 1e-3)) ** (2 * order))
    return np.fft.irfft(X, len(x))


def onepole_lp(x, fc):  # Platter's (time-varying cutoff)
    fc = np.broadcast_to(np.asarray(fc, dtype=float), x.shape)
    a = 1 - np.exp(-2 * np.pi * np.minimum(fc, SR * 0.45) / SR)
    y = np.empty_like(x)
    s = 0.0
    for i in range(len(x)):
        s += a[i] * (x[i] - s)
        y[i] = s
    return y


def hp(x, fc):
    return x - onepole_lp(x, fc)


def place(buf, x, frame, gain=1.0):
    i0 = int(round(frame / FPS * SR))
    n = min(len(x), len(buf) - i0)
    if n > 0:
        buf[i0:i0 + n] += x[:n] * gain


def kick(dur, f0, f1, sweep, decay, drive, click=0.3):
    t = np.arange(int(dur * SR)) / SR
    f = f1 + (f0 - f1) * np.exp(-t / sweep)
    ph = 2 * np.pi * np.cumsum(f) / SR
    body = np.tanh(np.sin(ph) * np.exp(-t / decay) * drive) / np.tanh(drive)
    c = hpf(rng.standard_normal(len(t)) * np.exp(-t / 0.003), 2500) * click
    return (body + c) * np.minimum(1, t / 0.0015)


# the cut: everything Scope dies on the exact sample of the kick (2 ms edge)
cut_i = int(round(CUT / FPS * SR))
scope_gate = np.ones(N)
edge = int(0.002 * SR)
scope_gate[cut_i:] = 0
scope_gate[cut_i - edge:cut_i] = np.linspace(1, 0, edge)

# =========================== SCOPE STEM (stereo) ===========================
frs = s_of(fr)  # scope frame clock
SL = np.zeros(N); SRt = np.zeros(N)


def both(x, f, g=1.0):
    place(SL, x, f, g); place(SRt, x, f, g)


k = kick(0.6, 165, 48, 0.035, 0.17, 2.0)
for s in (15, 30, 45):
    both(k, s - 5, 0.8)

hum = sum(a * np.sin(2 * np.pi * 50 * h * ts) for h, a in [(1, 1), (2, 0.5), (3, 0.35), (5, 0.12), (7, 0.06)])
hum = np.tanh(hum * 1.5) * 0.06 * smooth(2, 6, frs)
SL += hum; SRt += hum

d = 0.9; tt = np.arange(int(d * SR)) / SR
thoom = np.sin(2 * np.pi * np.cumsum(38 + 40 * np.exp(-tt / 0.08)) / SR) * np.exp(-tt / 0.25)
thoom += lp(rng.standard_normal(len(tt)), 400) * np.exp(-tt / 0.12) * 0.8
tick = hpf(rng.standard_normal(len(tt)), 3000) * np.exp(-tt / 0.002) * 0.6
both(thoom * 0.5 + tick, (2 - 1) * 6 / 10, 0.6)

# XY: the Lissajous, then the mark (relative to its centre, the record's spindle)
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
P = (np.array(pts) - [500, 333]) * 0.6 / np.array([400, 300])
P[:, 1] *= -1


def trace(phase):
    u = (phase % 1) * len(P)
    i = np.floor(u).astype(int); fr_ = u - i
    a = P[i % len(P)]; b = P[(i + 1) % len(P)]
    return a + (b - a) * fr_[:, None]


base = 55.0
phase = np.cumsum(np.full(N, base)) / SR
logo = trace(phase)
phi = (frs - 33) * 0.16
lisx = np.sin(2 * np.pi * 3 * base * ts + phi)
lisy = np.sin(2 * np.pi * 2 * base * ts)
fold = smooth(33, 47, frs)
morph = smooth(45, 58, frs)
smear = 4 * morph * (1 - morph)
x = (1 - morph) * lisx + morph * logo[:, 0] + smear * 0.12 * np.sin(2 * np.pi * 23 * base * ts)
y = (1 - morph) * lisy + morph * logo[:, 1] + smear * 0.12 * np.cos(2 * np.pi * 17 * base * ts)
lvl = 0.16 * fold * (1 + 0.35 * smooth(52, 59.5, frs))  # the beam heats up into the lock
SL += lp(x * lvl, 2600); SRt += lp(y * lvl, 2600)

room = lp(rng.standard_normal(N), 300) * 0.05 * smooth(0, 10, frs)
SL += room; SRt += room

# a 2-frame swell into the cut, so the hit lands on a rising edge (reverse air)
sw_n = int(0.12 * SR)
sw = lp(rng.standard_normal(sw_n), 2000) * (np.arange(sw_n) / sw_n) ** 3 * 0.35
place(SL, sw, CUT - 0.12 * FPS); place(SRt, sw, CUT - 0.12 * FPS)

SL *= scope_gate; SRt *= scope_gate
S = np.stack([SL, SRt], 1)
S = np.tanh(S * 1.2) / 1.2
S = S / np.max(np.abs(S)) * 10 ** (-1.5 / 20)

# =========================== PLATTER STEM (mono) ===========================
# rotation, Platter time p (0..140); the record is caught dead upright at LOCK and only seen from there
LOCK = 45
HOLD = 75
RELEASE = 90
REL_D = 4
BRAKE = 97
BRAKE_D = 27
RINGS = 106
LIFT = 127
PFR = 140
V0 = 200.0 / FPS
STROKES = [
    # the catch holds dead for an 8th (f 55-62) so the match cut lands, then baby scratches
    (52.5, 56.25, 0, 48), (56.25, 60.0, 48, 0),
    (60.0, 65.0, 0, 72), (65.0, 67.5, 72, 0),
    (67.5, 69.375, 0, 36), (69.375, 71.25, 36, 0), (71.25, 73.125, 0, 36), (73.125, 75.0, 36, 0),
]
FADER_CLOSED = []
u = 60.0
i = 0
while u < 65.0 - 1e-6:
    if i % 2 == 1:
        FADER_CLOSED.append((u, u + 1.875))
    u += 1.875
    i += 1
FADER_CLOSED += [(69.375, 71.25), (73.125, 75.0)]
STROKES = kit.scale_strokes(STROKES)

STEP = 1.0 / 400
uu = np.arange(0, PFR + 1 + STEP / 2, STEP)
v = np.zeros_like(uu)
for (a, b, p0, q0) in STROKES:
    m = (uu >= a) & (uu < b)
    v[m] = (q0 - p0) * (np.pi / 2) / (b - a) * np.sin(np.pi * (uu[m] - a) / (b - a))
m = (uu >= RELEASE) & (uu < RELEASE + REL_D)
v[m] = V0 * smooth01((uu[m] - RELEASE) / REL_D)
m = (uu >= RELEASE + REL_D) & (uu < BRAKE)
v[m] = V0
m = (uu >= BRAKE) & (uu < BRAKE + BRAKE_D)
v[m] = V0 * (1 - (uu[m] - BRAKE) / BRAKE_D) ** 1.6
theta = np.concatenate([[0], np.cumsum(v[:-1]) * STEP])  # 0 (upright) up to and at LOCK
print("theta(LOCK) = %.4f, theta(end) = %.2f" % (theta[int(round(LOCK / STEP))], theta[-1]))

# export, indexed by SPLICE frame f = p + P_OFF (held at 0 before the cut)
SUB = 8
fs = np.arange(0, FRAMES * SUB + 1) / SUB
pp = np.clip(fs - P_OFF, 0, PFR)
samples = np.interp(pp, uu, theta)
with open(os.devnull, "w") as fh:
    fh.write("// GENERATED by src/ident/splice/gen-audio.py: do not edit. Record angle in degrees, 8 samples per SPLICE frame.\n")
    fh.write("export const THETA_SUB = %d;\n" % SUB)
    fh.write("export const THETA: number[] = [%s];\n" % ",".join("%.3f" % x for x in samples))

pu = fr - P_OFF  # platter frame time of each sample

# ---- the pressed record R(tau): Platter's "ahh" at tau 0, then the dub chord the brake drags down ----
RDUR = 3.4
RN = int(RDUR * SR)
rt = np.arange(RN) / SR
rec = np.zeros(RN)


def saw(f, t):
    return 2 * ((f * t) % 1) - 1


def formant_ahh(dur, f0=132.0):
    t = np.arange(int(dur * SR)) / SR
    vib = 1 + 0.012 * np.sin(2 * np.pi * 5.5 * t)
    ph = np.cumsum(f0 * vib * (1 - 0.06 * t / dur)) / SR
    src = 2 * (ph % 1) - 1 + 0.15 * rng.standard_normal(len(t))
    out = np.zeros_like(t)
    for fc, bw, g in [(730, 90, 1.0), (1090, 110, 0.55), (2440, 170, 0.28), (3400, 250, 0.12)]:
        r = np.exp(-np.pi * bw / SR)
        th = 2 * np.pi * fc / SR
        a1, a2 = -2 * r * np.cos(th), r * r
        yy = np.zeros_like(src)
        y1 = y2 = 0.0
        for i in range(len(src)):
            y0 = src[i] - a1 * y1 - a2 * y2
            yy[i] = y0
            y2, y1 = y1, y0
        out += g * yy / np.max(np.abs(yy))
    env = np.minimum(1, t / 0.006) * np.exp(-np.maximum(0, t - 0.16) / 0.07)
    return np.tanh(out * env * 1.6)


def chord(dur, root, decay, cutoff):
    t = np.arange(int(dur * SR)) / SR
    xx = np.zeros_like(t)
    for semi in (0, 3, 7, 10, 14):
        f = root * 2 ** (semi / 12)
        for det in (-0.004, 0.004):
            xx += saw(f * (1 + det), t + rng.random())
    env = np.minimum(1, t / 0.004) * np.exp(-t / decay)
    fc = 180 + cutoff * np.exp(-t / (decay * 0.5))
    return onepole_lp(onepole_lp(xx * env, fc), fc * 1.3) * 0.25


voc = kit.vocal()
k_slow = 2 ** (PITCH / 12)
voc = np.interp(np.arange(0, len(voc) - 1, 1 / k_slow), np.arange(len(voc)), voc)
rec[: len(voc)] += voc * 1.0
ch = chord(1.1, 98.0, 0.55, 2400)
i0 = int(max(0.58, len(voc) / SR + 0.05) * SR)
rec[i0:i0 + len(ch)] += ch[: RN - i0] * 1.3
pad_t = rt[int(0.4 * SR):]
pad = sum(np.sin(2 * np.pi * f * pad_t + p) for f, p in [(49.0, 0), (98.0, 1), (146.8, 2), (196.0, 0.5)])
pad = onepole_lp(pad * 0.12 + rng.standard_normal(len(pad_t)) * 0.03, 900)
rec[int(0.4 * SR):] += pad
rec += hp(onepole_lp(rng.standard_normal(RN), 5000), 900) * 0.025
for _ in range(int(RDUR * 34)):
    j = int(rng.random() * (RN - 200))
    amp = (rng.random() ** 3) * 0.55 + 0.04
    w = int(2 + rng.random() * 18)
    rec[j:j + w] += rng.standard_normal(w) * np.hanning(w) * amp

# ---- deck A: the stylus follows theta ----
th_a = np.interp(np.clip(pu, 0, PFR), uu, theta)
vel = np.interp(np.clip(pu, 0, PFR), uu, v)
tau_c = np.clip(th_a / 200.0, 0, RDUR - 0.001)
deckA = np.interp(tau_c * SR, np.arange(RN), rec)
speed = np.abs(vel) / V0
gain = np.where(speed < 1, np.power(np.maximum(speed, 0), 0.75), 1 + 0.18 * np.log(np.maximum(speed, 1)))
fc = 250 + 15000 * np.minimum(1, speed) ** 1.4
fc = np.where(speed > 1, 15000 / np.sqrt(np.maximum(speed, 1)), fc)
deckA = onepole_lp(deckA * gain, fc)
deckA = hp(deckA, 25)
on = (pu >= LOCK).astype(float) * np.clip((LIFT - pu) * 4, 0, 1)
fader = np.ones(N)
for (a, b) in FADER_CLOSED:
    fader[(pu >= a) & (pu < b)] = 0
fader = onepole_lp(fader, 400)
deckA = (deckA + kit.friction(pu, speed, STROKES, rng)) * on * fader  # the rub is heard through the stylus
deckA += kit.fader_clicks(pu, FADER_CLOSED) * on
lift = hp(rng.standard_normal(int(0.04 * SR)), 2000) * np.exp(-np.arange(int(0.04 * SR)) / SR / 0.005) * 0.35

# ---- deck B: the beat ----
deckB = np.zeros(N)
k_small = kick(0.5, 150, 46, 0.03, 0.15, 2.4)
k_big = kick(1.3, 135, 41, 0.045, 0.38, 3.2, click=0.4)
tk = np.arange(len(k_big)) / SR
k_big = k_big + onepole_lp(rng.standard_normal(len(k_big)), 700) * np.exp(-tk / 0.3) * 0.25
for p in (90,):  # no kick under the scratch
    place(deckB, k_small, p + P_OFF, 0.85)
for p in (LOCK, HOLD):
    place(deckB, k_big, p + P_OFF, 1.0)
for p in (82.5,):
    n = int(0.06 * SR)
    hat = hp(rng.standard_normal(n), 7000) * np.exp(-np.arange(n) / SR / 0.018) * 0.22
    place(deckB, hat, p + P_OFF)
sub = np.sin(2 * np.pi * 41.2 * ts) + 0.25 * np.sin(2 * np.pi * 82.4 * ts)
duck = np.ones(N)
for p in (45, 75, 90):
    tt = (pu - p) / FPS
    mm = tt >= 0
    duck[mm] *= 1 - 0.85 * np.exp(-tt[mm] / 0.09)
subenv = (pu >= LOCK) * np.clip((RELEASE + 1 - pu) * 1.5, 0, 1)
subenv = subenv * (1 - kit.scratch_gate(pu, STROKES, smooth))
deckB += sub * subenv * duck * 0.14

# booth air: arrives with the cut, dies with the power
roomP = onepole_lp(rng.standard_normal(N), 300) * 0.6 + 0.25 * np.sin(2 * np.pi * 55 * ts)
bed = roomP * (pu >= LOCK) * np.clip((132 - pu) / 20, 0, 1) * 0.08

thump = kick(1.2, 80, 34, 0.06, 0.4, 1.6, click=0.05)
air_n = int(0.8 * SR)
ta = np.arange(air_n) / SR
air = onepole_lp(rng.standard_normal(air_n), 300 + 2500 * (ta / 0.8)) * np.sin(np.pi * ta / 0.8) ** 2 * 0.25

mix = deckA * 0.9 + deckB + bed
place(mix, lift, LIFT + P_OFF, 0.7)
place(mix, thump, RINGS + P_OFF, 0.55)
place(mix, air, RINGS - 4 + P_OFF, 0.6)
mix *= np.clip((DUR - ts) / 0.15, 0, 1)
mix = np.tanh(mix / np.max(np.abs(mix)) * 1.4) / np.tanh(1.4)
mix = mix * 10 ** (-1.5 / 20)

# =========================== OUT ===========================
out = S + mix[:, None]
pk = np.max(np.abs(out))
if pk > 10 ** (-1.0 / 20):
    out = out / pk * 10 ** (-1.5 / 20)
with wave.open(os.path.join(OUT, "mix-%g.wav" % PITCH), "wb") as wv:
    wv.setnchannels(2); wv.setsampwidth(2); wv.setframerate(SR)
    wv.writeframes((out * 32767).astype(np.int16).tobytes())
spf = SR // FPS
def seg_db(a, b):
    x = out[int(a / FPS * SR):int(b / FPS * SR)]
    return 20 * np.log10(np.sqrt(np.mean(x ** 2)) + 1e-9)
print("mix.wav", out.shape, "peak dB %.1f" % (20 * np.log10(np.max(np.abs(out)))),
      "rms scope %.1f / scratch %.1f / hold %.1f / brake %.1f" % (seg_db(8, 55), seg_db(55, 85), seg_db(85, 100), seg_db(100, 140)))
