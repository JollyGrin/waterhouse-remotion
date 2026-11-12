# /// script
# requires-python = ">=3.10"
# dependencies = ["numpy", "pillow"]
# ///
# SPECTRO: the mark is written in the spectrogram of the sound.
# This script is the single source of truth for timing. It
#   1) synthesises the mix (hiss + mains hum, kicks, a sine sweep, the logo as an additive
#      bank of partials whose amplitudes follow the rasterised mark, a Dm9 tail, an exit
#      low-pass that closes the spectrum),
#   2) runs a real multi-resolution STFT on that exact mix,
#   3) writes the waterfall "tape" (public/ident/spectro/tape.png), the live spectrum per video
#      frame and the scroll curve (src/ident/spectro/data.ts), and the audio (public/ident/audio/spectro/mix.wav).
# The picture is what you hear: nothing in the waterfall is drawn by hand.
import numpy as np, wave, os, zlib, struct
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..", "..", "..")
SR, FPS, FRAMES = 48000, 30, 140
rng = np.random.default_rng(7)
TILT = 0.35  # audio leans dark by 6.02*TILT dB/oct over pink; the display undoes exactly that

# ---- display (shared with src/ident/Spectro.tsx through data.ts) ----
NCOL, CW = 180, 6               # 180 columns x 6 px = 1080
FMIN, FMAX = 40.0, 16000.0       # log axis
RATIO = FMAX / FMIN
LC0, LC1 = 24, 156               # logo columns -> x 144..936
LOGO_W_PX = (LC1 - LC0) * CW     # 792
ROW_PX = 4                       # one tape row = 4 px
LOGO_ROWS = int(round(LOGO_W_PX * 666 / 1000 / ROW_PX))  # 132 rows = 528 px
LOGO_H_PX = LOGO_ROWS * ROW_PX

def col_of(f):
    return NCOL * np.log(np.maximum(f, 1e-6) / FMIN) / np.log(RATIO)

def f_of(c):
    return FMIN * RATIO ** (np.asarray(c) / NCOL)

# ---- timeline (frames; 120 bpm, beat = 15 f, downbeats at 10 + 15k) ----
V = 15.0                         # scroll, px per frame
KICKS = [10, 25, 55, 70, 100]
BIG = [40, 85]                   # logo starts on 40; title lands on 85
BOOM = 115                       # exit: the spectrum closes from the top down
SWEEP = (28.0, 40.0)
F_LOGO = 40.0
F_LOGO_END = F_LOGO + LOGO_H_PX / V          # 75.2
FB, FS = F_LOGO_END, F_LOGO_END + 13.8       # brake
EXIT0, EXIT1 = 115.0, 126.0
PRE = 3.7                                     # seconds of history before frame 0

def P(tf):
    """Scroll position in px at time tf (frames). Monotone, stops at FS."""
    tf = np.asarray(tf, dtype=float)
    out = V * tf
    D = FS - FB
    u = np.clip(tf - FB, 0, D)
    brake = V * FB + V * (u / 2 + D / (2 * np.pi) * np.sin(np.pi * u / D))
    out = np.where(tf >= FB, brake, out)
    return out

def vel(tf):
    tf = np.asarray(tf, dtype=float)
    D = FS - FB
    u = np.clip((tf - FB) / D, 0, 1)
    return np.where(tf < FB, V, V * (1 + np.cos(np.pi * u)) / 2)

def c_cut(tf):
    s = np.clip((np.asarray(tf, dtype=float) - EXIT0) / (EXIT1 - EXIT0), 0, 1)
    return NCOL * (1 - s ** 1.7) + 3 * (s < 1)  # 183 -> 0, accelerating

# ---- signal clock ----
T0 = -PRE
DUR = PRE + FRAMES / FPS + 0.35
n = int(DUR * SR)
t = np.arange(n) / SR + T0          # seconds relative to frame 0
tf = t * FPS                        # frames
mix = np.zeros(n)

def idx(frame):
    return int(round((frame / FPS - T0) * SR))

def place(x, frame, g=1.0):
    i = idx(frame)
    m = min(len(x), n - i)
    if m > 0:
        mix[i:i + m] += x[:m] * g

def fft_filter(x, fn):
    X = np.fft.rfft(x)
    fq = np.fft.rfftfreq(len(x), 1 / SR)
    return np.fft.irfft(X * fn(fq), len(x))

# hiss (pink) + mains hum
white = rng.standard_normal(n)
pink = fft_filter(white, lambda fq: 1 / np.sqrt(np.maximum(fq, 20)))
pink /= np.std(pink)
mix += pink * 10 ** (-66 / 20)
for k, db in [(1, -36), (2, -44), (3, -47), (4, -53), (6, -58)]:
    mix += np.sin(2 * np.pi * 50 * k * t + k) * 10 ** (db / 20)

# kicks
def kick(big=False, click_g=0.5, thud=False):
    L = int((0.9 if big else 0.45) * SR)
    tt = np.arange(L) / SR
    f = (43 if thud else 46) + (16 if thud else 150 if big else 120) * np.exp(-tt / 0.035)
    ph = 2 * np.pi * np.cumsum(f) / SR
    body = np.sin(ph) * np.exp(-tt / (0.32 if big else 0.16))
    click = rng.standard_normal(L) * np.exp(-tt / 0.0025)
    click = fft_filter(click, lambda fq: (fq > 900) * 1.0) * click_g
    env = np.minimum(1, tt / 0.0015)
    return (body + click) * env

for k in KICKS:
    # kicks inside the mark keep their body only, so they don't cut bars through it
    inside = F_LOGO < k < F_LOGO_END
    place(kick(click_g=0.0 if inside else 0.5, thud=inside), k, 0.55)
for k in BIG:
    place(kick(True), k, 0.8)
place(kick(True), BOOM, 0.95)
# closed hats on the 8ths: short dashes in the top octave, right of the mark
def hat(open_=False):
    L = int((0.09 if open_ else 0.035) * SR)
    tt = np.arange(L) / SR
    x = rng.standard_normal(L) * np.exp(-tt / (0.03 if open_ else 0.009))
    return fft_filter(x, lambda fq: np.clip((fq - 8500) / 1500, 0, 1) * (fq < 15500))
hf = 10.0
while hf < 84:
    place(hat(open_=(round((hf - 10) / 7.5) % 2 == 1)), hf, 10 ** (-31 / 20) * (1.0 if round((hf - 10) / 7.5) % 2 else 0.6))
    hf += 7.5

sub = np.sin(2 * np.pi * 36.7 * np.arange(int(1.2 * SR)) / SR) * np.exp(-np.arange(int(1.2 * SR)) / SR / 0.5)
place(sub, BOOM, 0.35)

# sine sweep 70 Hz -> 12 kHz over SWEEP (a straight diagonal on the log axis)
s0, s1 = SWEEP
i0, i1 = idx(s0), idx(s1)
tt = np.arange(i1 - i0) / (i1 - i0)
fsw = 70 * (12000 / 70) ** tt
amp = (fsw / 500) ** -TILT * np.minimum(1, tt / 0.08) * np.minimum(1, (1 - tt) / 0.04)
mix[i0:i1] += np.sin(2 * np.pi * np.cumsum(fsw) / SR) * amp * 0.16

# ---- the mark, rasterised: (rows from the top, columns LC0..LC1) ----
POLY = {
    "house": [(348, 3), (0, 283), (0, 665), (348, 665)],
    "slatA": [(379.6, 48.7), (685.2, 149), (685.2, 287.5), (379.6, 204.4)],
    "slatB": [(722.2, 161), (1000, 252.3), (1000, 372.9), (722.2, 297.6)],
    "door": [(596.6, 398), (775.1, 438.8), (775.1, 665.9), (596.6, 665.9)],
}
SS = 8
img = Image.new("L", ((LC1 - LC0) * SS, LOGO_ROWS * SS), 0)
dr = ImageDraw.Draw(img)
sx, sy = (LC1 - LC0) * SS / 1000, LOGO_ROWS * SS / 666
for poly in POLY.values():
    dr.polygon([(x * sx, y * sy) for x, y in poly], fill=255)
mask = np.asarray(img.resize((LC1 - LC0, LOGO_ROWS), Image.BOX), dtype=float) / 255  # [row, col]

# logo row as a function of time: bottom row first (the waterfall pushes it downward)
P_L0 = float(P(F_LOGO))
d = P(tf) - P_L0                         # px emitted so far
yl = LOGO_H_PX - d                       # px from the logo top
logo_on = (d >= 0) & (d < LOGO_H_PX)
rowf = np.clip(yl / ROW_PX - 0.5, 0, LOGO_ROWS - 1)

# chord: D minor 9 across the range; partials that land near a chord tone lock to it
CHORD = [73.42, 110.0, 174.61, 261.63, 329.63, 440.0, 587.33, 698.46, 1046.5, 1318.5, 1760.0, 2349.3]
seg = np.where(logo_on)[0]
a, b = seg[0] - int(0.01 * SR), seg[-1] + int(0.01 * SR)
ts = t[a:b]
r_seg = rowf[a:b]
on_seg = logo_on[a:b].astype(float)
# 4 ms ramps at the logo's top and bottom edges
ramp = np.convolve(on_seg, np.ones(192) / 192, mode="same")
r0 = np.floor(r_seg).astype(int)
r1 = np.minimum(r0 + 1, LOGO_ROWS - 1)
fr = r_seg - r0
logo_sig = np.zeros(b - a)
# Partials: one steady sine per display column where the column is wide enough for the analyser
# to resolve it, a 12 Hz grid below that. Steady, resolved partials read as clean bright cells
# instead of noise speckle, and the cluster sounds like a shimmering chord.
STEP = 12.0
cw_hz = lambda f: f * (RATIO ** (1 / NCOL) - 1)
parts = []
f = float(f_of(LC0))
while f < f_of(LC1):
    w = cw_hz(f)
    sp = max(STEP, w)
    parts.append((f, sp, w))
    f += sp
parts = np.array(parts)
# chord tones: snap the nearest partial to each, a little louder
gain = np.ones(len(parts))
fr_p = parts[:, 0].copy()
for ch in CHORD:
    if f_of(LC0) <= ch < f_of(LC1):
        j = int(np.argmin(np.abs(fr_p - ch)))
        fr_p[j] = ch; gain[j] = 1.8
# small random detune inside the band for an organic texture
fr_p *= np.exp(rng.uniform(-0.25, 0.25, len(parts)) * np.log(RATIO) / NCOL * (parts[:, 1] <= parts[:, 2] * 1.01))
colp = col_of(fr_p) - LC0 - 0.5
for j in range(len(parts)):
    fq_, sp, w = fr_p[j], parts[j, 1], parts[j, 2]
    cpos = np.clip(colp[j], 0, LC1 - LC0 - 1)
    c0 = int(np.floor(cpos)); c1 = min(c0 + 1, LC1 - LC0 - 1); fc_ = cpos - c0
    env = ((mask[r0, c0] * (1 - fc_) + mask[r0, c1] * fc_) * (1 - fr) + (mask[r1, c0] * (1 - fc_) + mask[r1, c1] * fc_) * fr) * ramp
    if env.max() < 1e-4:
        continue
    dens = np.sqrt(sp / w)                 # sparse grid lines carry the power of the columns between them
    tilt = (fq_ / 400) ** -TILT
    flut = 1 + 0.08 * np.sin(2 * np.pi * rng.uniform(2, 5) * ts + rng.uniform(0, 6.3))
    logo_sig += np.sin(2 * np.pi * fq_ * ts + rng.uniform(0, 6.3)) * env * dens * tilt * gain[j] * flut * rng.uniform(0.8, 1.0)
print("logo partials", len(parts))
logo_sig /= np.sqrt(np.mean(logo_sig[on_seg > 0] ** 2))
mix[a:b] += logo_sig * 10 ** (-17 / 20)

# Dm9 tail: the chord rings on after the mark (thin vertical lines above it while the scroll brakes)
i0 = idx(F_LOGO_END - 1)
L = n - i0
tt = np.arange(L) / SR
tail = np.zeros(L)
for k, ch in enumerate(CHORD[1:9]):
    tail += np.sin(2 * np.pi * ch * tt + k) * (ch / 400) ** -TILT * (1 + 0.15 * np.sin(2 * np.pi * (0.7 + 0.13 * k) * tt))
tail *= np.minimum(1, tt / 0.02) * np.exp(-tt / 1.1)
mix[i0:] += tail * 10 ** (-27 / 20)

# exit whoosh: broadband air that the closing filter eats
L = int(0.8 * SR)
tt = np.arange(L) / SR
air = fft_filter(rng.standard_normal(L), lambda fq: 1 / np.sqrt(np.maximum(fq, 40)))
air = air / np.std(air) * np.exp(-tt / 0.25) * np.minimum(1, tt / 0.06)
place(air, BOOM - 2, 10 ** (-24 / 20))

# ---- exit: STFT low-pass that follows the closing columns ----
N_, H_ = 2048, 256
win = np.hanning(N_ + 1)[:-1]
pad = np.concatenate([np.zeros(N_), mix, np.zeros(N_)])
nfr = (len(pad) - N_) // H_ + 1
out = np.zeros(len(pad)); wsum = np.zeros(len(pad))
fq = np.fft.rfftfreq(N_, 1 / SR)
cf = col_of(np.maximum(fq, 1))
for i in range(nfr):
    s = i * H_
    centre_t = (s + N_ / 2 - N_) / SR + T0
    X = np.fft.rfft(pad[s:s + N_] * win)
    cc = float(c_cut(centre_t * FPS))
    if cc < NCOL + 2:
        X *= np.clip((cc - cf) / 2 + 0.5, 0, 1)
    out[s:s + N_] += np.fft.irfft(X, N_) * win
    wsum[s:s + N_] += win ** 2
mix = (out / np.maximum(wsum, 1e-6))[N_:N_ + n]

mix *= 10 ** (-1.5 / 20) / np.max(np.abs(mix))

# ---- write audio from frame 0 ----
z = idx(0)
pcm = (np.clip(mix[z:], -1, 1) * 32767).astype(np.int16)
os.makedirs(os.path.join(ROOT, "public", "ident", "audio", "spectro"), exist_ok=True)
with wave.open(os.path.join(ROOT, "public", "ident", "audio", "spectro", "mix.wav"), "wb") as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes(np.repeat(pcm, 2).tobytes())
seg_ = mix[z:]
print("peak dB %.1f  rms dB %.1f" % (20 * np.log10(np.max(np.abs(seg_))), 20 * np.log10(np.sqrt(np.mean(seg_ ** 2)))))

# ---- analysis: multi-resolution STFT (min across window sizes) on the exact mix ----
HOP = 200                                  # 240 analysis rows per second (8 per video frame)
edges = f_of(np.arange(NCOL + 1))
centres = np.sqrt(edges[:-1] * edges[1:])
bw = edges[1:] - edges[:-1]
times = np.arange(0, n, HOP)
def psd_cols(N):
    w = np.hanning(N + 1)[:-1]
    norm = 1 / (SR * np.sum(w ** 2))
    p = np.concatenate([np.zeros(N // 2), mix, np.zeros(N // 2)])
    f = np.fft.rfftfreq(N, 1 / SR)
    outc = np.zeros((len(times), NCOL))
    for j, s in enumerate(times):
        X = np.fft.rfft(p[s:s + N] * w)
        psd = (np.abs(X) ** 2) * norm * 2
        cs = np.concatenate([[0], np.cumsum(psd)]) * (f[1] - f[0])
        # band power = integral of PSD over each column band (linear interp of the cumulative sum)
        e = np.interp(edges, np.concatenate([f - (f[1] - f[0]) / 2, [f[-1] + (f[1] - f[0]) / 2]]), cs)
        outc[j] = np.maximum(np.diff(e), 1e-20)
    return outc
# Multi-resolution: each column is read with the shortest window that still resolves it
# (window ~ 2 bins per column width), clamped to 1024..8192.
NS = [1024, 2048, 4096, 8192]
PS = [psd_cols(N_) for N_ in NS]
need = np.log2(np.clip(2 * SR / bw, NS[0], NS[-1]))   # ideal log2 N per column
lg = np.log(np.stack(PS))                               # [k, rows, cols]
pos = need - np.log2(NS[0])                             # 0..3
k0 = np.clip(np.floor(pos).astype(int), 0, 2); fk = (pos - k0)[None, :]
cols_ = np.arange(NCOL)
pw = np.exp(lg[k0, :, cols_].T * (1 - fk) + lg[k0 + 1, :, cols_].T * fk)
db = 10 * np.log10(pw) + 6.02 * TILT * np.log2(centres / 400)[None, :]  # undo the audio tilt
row_t = times / SR + T0                     # seconds

# calibrate: the mark sits near white, the noise floor near black
on_rows = (row_t * FPS > F_LOGO + 3) & (row_t * FPS < F_LOGO_END - 3)
ref = np.percentile(db[on_rows][:, LC0:LC1], 97)
CEIL, FLOOR = ref + 2, ref - 54
lum = np.clip((db - FLOOR) / (CEIL - FLOOR), 0, 1) ** 1.6

# ---- the tape: rows indexed by scroll position ----
row_f = row_t * FPS
Prow = P(row_f) - P(T0 * FPS)
moving = vel(row_f) > 0.25
ridx = np.floor(Prow / ROW_PX).astype(int)
R = int(ridx[moving].max()) + 1
acc = np.zeros((R, NCOL)); cnt = np.zeros(R)
for j in np.where(moving)[0]:
    acc[ridx[j]] += lum[j]; cnt[ridx[j]] += 1
tape = acc / np.maximum(cnt, 1)[:, None]
# fill any row no hop landed in (never happens at these speeds, but be safe)
for r in range(1, R):
    if cnt[r] == 0:
        tape[r] = tape[r - 1]
png = (np.clip(tape[::-1], 0, 1) * 255).astype(np.uint8)   # newest row on top
os.makedirs(os.path.join(ROOT, "public", "ident", "spectro"), exist_ok=True)
Image.fromarray(png, "L").save(os.path.join(ROOT, "public", "ident", "spectro", "tape.png"))

# ---- live spectrum per video frame (max over the frame's analysis rows) ----
ALPH = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_"
spec = []
for fidx in range(FRAMES):
    sel = (row_f >= fidx - 0.5) & (row_f < fidx + 0.5)
    v = lum[sel].max(axis=0) if sel.any() else np.zeros(NCOL)
    spec.append("".join(ALPH[int(round(x * 63))] for x in v))
Pf = [round(float(P(fi) - P(T0 * FPS)), 2) for fi in range(FRAMES)]

ts_out = f"""// GENERATED by src/ident/spectro/gen-audio.py — do not edit by hand.
export const NCOL = {NCOL};
export const CW = {CW};
export const FMIN = {FMIN};
export const FMAX = {FMAX};
export const LC0 = {LC0};
export const LC1 = {LC1};
export const ROW_PX = {ROW_PX};
export const LOGO_H_PX = {LOGO_H_PX};
export const TAPE_ROWS = {R};
export const V = {V};
export const KICKS = {KICKS};
export const BIG = {BIG};
export const BOOM = {BOOM};
export const F_LOGO = {F_LOGO};
export const F_LOGO_END = {F_LOGO_END:.3f};
export const FB = {FB:.3f};
export const FS = {FS:.3f};
export const EXIT0 = {EXIT0};
export const EXIT1 = {EXIT1};
/** tape position (px from the tape's first row) at the write head, per video frame */
export const PF: number[] = {Pf};
/** tape px of the logo's top row once it is fully written */
export const P_LOGO_TOP = {float(P(F_LOGO) - P(T0 * FPS)) + LOGO_H_PX:.2f};
export const ALPH = "{ALPH}";
/** live spectrum per frame: NCOL chars, value = ALPH.indexOf(ch) / 63 */
export const SPEC: string[] = {spec};
"""
with open(os.path.join(HERE, "data.ts"), "w") as fh:
    fh.write(ts_out)
print("tape rows", R, "logo end", F_LOGO_END, "FS", FS)
