# /// script
# requires-python = ">=3.10"
# dependencies = ["numpy"]
# ///
"""Synthesise the PINSCREEN sound kit (48 kHz mono 16-bit) into public/ident/audio/pinscreen/.
Usage: uv run src/ident/pinscreen/gen-audio.py"""
import os, sys, wave
import numpy as np

SR = 48000
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "public", "ident", "audio", "pinscreen")
rng = np.random.default_rng(11)


def lp1(x, fc):
    a = np.exp(-2 * np.pi * fc / SR)
    y = np.empty_like(x)
    acc = 0.0
    for i in range(len(x)):
        acc = (1 - a) * x[i] + a * acc
        y[i] = acc
    return y


def lp(x, fc, n=2):
    for _ in range(n):
        x = lp1(x, fc)
    return x


def hp(x, fc):
    return x - lp(x, fc, 1)


def bp(x, lo, hi):
    return lp(hp(x, lo), hi, 2)


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


def fade(x, a=0.004, r=0.02):
    n = len(x)
    e = np.ones(n)
    na, nr = int(a * SR), int(r * SR)
    e[:na] = np.linspace(0, 1, na)
    e[n - nr:] = np.linspace(1, 0, nr)
    return x * e


# ---- boom: sub with a pitch drop and a dull steel transient ----
t = t_(1.9)
f = 34 + 46 * np.exp(-t * 15)
ph = 2 * np.pi * np.cumsum(f) / SR
boom = np.sin(ph) * np.exp(-t * 2.4) * (1 - np.exp(-t * 500))
boom += 0.22 * np.sin(2 * ph) * np.exp(-t * 7)
click = lp(rng.standard_normal(len(t)) * np.exp(-t * 160), 1100)
boom += 0.35 * click / (np.max(np.abs(click)) + 1e-9)
write("boom.wav", norm(np.tanh(boom * 1.5), -2))

# ---- drone: two low partials beating, air on top, 5 s ----
t = t_(5.0)
dr = np.sin(2 * np.pi * 41 * t) + 0.55 * np.sin(2 * np.pi * 61.7 * t + 1) + 0.25 * np.sin(2 * np.pi * 82.3 * t)
dr *= 0.8 + 0.2 * np.sin(2 * np.pi * 0.4 * t)
air = lp(hp(rng.standard_normal(len(t)), 60), 300, 2)
dr = dr / np.max(np.abs(dr)) + 0.5 * air / np.max(np.abs(air))
env = np.minimum(1, t / 0.6) * np.minimum(1, (5.0 - t) / 0.5)
write("drone.wav", norm(dr * env, -9))

# ---- servo: geared motor whir gliding up then settling, with a hydraulic hiss, 1.3 s ----
t = t_(1.3)
fr = 110 + 210 * np.sin(np.pi * np.minimum(1, t / 1.1)) ** 0.7
ph = 2 * np.pi * np.cumsum(fr) / SR
saw = 2 * ((ph / (2 * np.pi)) % 1) - 1
gear = np.sign(np.sin(ph * 7.0)) * 0.25  # gear teeth buzz
whir = lp(saw + gear, 1400, 2)
hiss = bp(rng.standard_normal(len(t)), 900, 4000) * 0.5
env = np.sin(np.pi * np.minimum(1, t / 1.3)) ** 0.8
servo = (whir / np.max(np.abs(whir)) + hiss / np.max(np.abs(hiss)) * 0.45) * env
write("servo.wav", norm(fade(servo), -8))


# ---- one pin click (helper) ----
def pin_click(pitch, dur=0.035):
    tt = t_(dur)
    n = rng.standard_normal(len(tt)) * np.exp(-tt * 260)
    ring = np.sin(2 * np.pi * pitch * tt + rng.uniform(0, 6)) * np.exp(-tt * 140)
    return n * 0.6 + ring


# ---- step: pneumatic mechanical clunk (low thud + metal click + short hiss) ----
t = t_(0.7)
thud = np.sin(2 * np.pi * (58 + 40 * np.exp(-t * 40)) * t) * np.exp(-t * 14)
k = np.zeros(len(t))
c = pin_click(2300, 0.05)
k[: len(c)] += c
c2 = pin_click(1700, 0.05)
k[int(0.008 * SR): int(0.008 * SR) + len(c2)] += c2 * 0.7
hs = bp(rng.standard_normal(len(t)), 2000, 7000) * np.exp(-t * 18) * 0.25
step = thud + 0.5 * k / np.max(np.abs(k)) + hs
write("step.wav", norm(fade(step, 0.001), -4))

# ---- clatter: hundreds of pins locking, density rising, last hard lock at 0.50 s ----
L = 0.62
t = t_(L)
cl = np.zeros(len(t))
N = 420
for i in range(N):
    u = rng.uniform(0, 1) ** 0.55  # density skewed toward the end
    at = u * 0.47
    c = pin_click(rng.uniform(1400, 4200), 0.03) * rng.uniform(0.3, 1.0)
    s = int(at * SR)
    cl[s: s + len(c)] += c[: len(cl) - s]
lock = pin_click(1900, 0.08) * 4 + np.concatenate([np.sin(2 * np.pi * 90 * t_(0.12)) * np.exp(-t_(0.12) * 30) * 3])[: int(0.08 * SR)]
s = int(0.50 * SR)
cl[s: s + len(lock)] += lock[: len(cl) - s]
cl = hp(cl, 300)
write("clatter.wav", norm(fade(cl, 0.002, 0.05), -3))

# ---- retract: pneumatic dump (hiss down) + soft mass of pins settling ----
t = t_(0.9)
hs = bp(rng.standard_normal(len(t)), 600, 5000) * np.exp(-t * 6)
fall = np.zeros(len(t))
for i in range(90):
    at = rng.uniform(0.02, 0.2)
    c = pin_click(rng.uniform(900, 2200), 0.03) * rng.uniform(0.2, 0.6)
    s = int(at * SR)
    fall[s: s + len(c)] += c
thud = np.sin(2 * np.pi * 50 * t) * np.exp(-t * 9) * (t > 0.15) * 0.8
retract = hs / np.max(np.abs(hs)) * 0.5 + fall / np.max(np.abs(fall)) * 0.6 + thud
write("retract.wav", norm(fade(retract, 0.003, 0.1), -6))

# ---- drop: the array emptying, clicks sweeping down in pitch, 0.7 s ----
t = t_(0.75)
dp = np.zeros(len(t))
for i in range(260):
    u = rng.uniform(0, 1)
    at = u * 0.5
    c = pin_click(2600 - 1700 * u + rng.uniform(-200, 200), 0.03) * rng.uniform(0.3, 0.9) * (1 - 0.5 * u)
    s = int(at * SR)
    dp[s: s + len(c)] += c
dp = hp(dp, 250)
write("drop.wav", norm(fade(dp, 0.002, 0.08), -5))
print("ok")
