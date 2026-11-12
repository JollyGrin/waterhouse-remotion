# /// script
# requires-python = ">=3.10"
# dependencies = ["numpy"]
# ///
"""Synthesise the XEROX bumper sounds: 48 kHz mono 16-bit WAVs into public/ident/audio/xerox/."""
import numpy as np, wave, os
SR = 48000
OUT = os.path.join(os.path.dirname(__file__), "..", "..", "..", "public", "ident", "audio", "xerox")
rng = np.random.default_rng(7)

def lp(x, fc):  # one-pole low-pass, applied twice
    a = np.exp(-2 * np.pi * fc / SR)
    for _ in range(2):
        y = np.empty_like(x); z = 0.0
        for i in range(len(x)):
            z = (1 - a) * x[i] + a * z; y[i] = z
        x = y
    return x

def hp(x, fc):
    return x - lp(x, fc)

def save(name, x, peak_db):
    x = x / (np.max(np.abs(x)) + 1e-9) * 10 ** (peak_db / 20)
    with wave.open(os.path.join(OUT, name), "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((x * 32767).astype(np.int16).tobytes())

# scan: photocopier carriage. Motor fundamental ~110 Hz rising to 140, stepper ticks, whirring band noise. 0.55 s.
d = 0.55; t = np.arange(int(SR * d)) / SR
f = 110 + 30 * (1 - np.exp(-t / 0.06))
ph = 2 * np.pi * np.cumsum(f) / SR
motor = np.sign(np.sin(ph)) * 0.35 + np.sin(2 * ph) * 0.3 + np.sin(3 * ph) * 0.15
motor = lp(motor, 900)
whir = lp(hp(rng.standard_normal(len(t)), 700), 2600) * (0.55 + 0.45 * np.sin(2 * np.pi * 37 * t))
step = np.zeros(len(t))
for k in range(int(d * 46)):
    i = int(k * SR / 46)
    n = min(240, len(t) - i)
    step[i:i + n] += np.exp(-np.arange(n) / 40) * rng.standard_normal(n)
step = hp(step, 1500) * 0.5
env = np.minimum(1, t / 0.02) * np.minimum(1, (d - t) / 0.06)
save("scan.wav", (motor * 0.8 + whir * 0.35 + step * 0.4) * env, -9)

# lamp: relay click of the exposure lamp. Sharp transient + tiny low knock. 0.18 s.
d = 0.18; t = np.arange(int(SR * d)) / SR
click = hp(rng.standard_normal(len(t)), 2500) * np.exp(-t / 0.004)
knock = np.sin(2 * np.pi * 180 * t) * np.exp(-t / 0.02) * 0.6
save("lamp.wav", click + knock, -8)

# boom: sub drop for the final layout landing. 58 -> 36 Hz, soft saturation, 1.4 s.
d = 1.4; t = np.arange(int(SR * d)) / SR
f = 36 + 22 * np.exp(-t / 0.12)
ph = 2 * np.pi * np.cumsum(f) / SR
b = np.sin(ph) * np.exp(-t / 0.45)
b = np.tanh(b * 2.2)
b += lp(rng.standard_normal(len(t)), 300) * np.exp(-t / 0.03) * 0.5  # transient body
b *= np.minimum(1, t / 0.003)
save("boom.wav", b, -4)

# hum: mains/fluorescent room bed, 50 Hz + harmonics, slow beating, faint hiss. 4.5 s.
d = 4.5; t = np.arange(int(SR * d)) / SR
h = sum(np.sin(2 * np.pi * 50 * k * t + k) / k ** 1.3 for k in range(1, 8))
h *= 0.8 + 0.2 * np.sin(2 * np.pi * 0.7 * t)
h += lp(hp(rng.standard_normal(len(t)), 300), 4000) * 0.15
h *= np.minimum(1, t / 0.05) * np.minimum(1, (d - t) / 0.3)
save("hum.wav", h, -20)

# cut: hard edit hit between passes, dull mechanical clack + a low thud. 0.35 s.
d = 0.35; t = np.arange(int(SR * d)) / SR
c = lp(rng.standard_normal(len(t)), 1800) * np.exp(-t / 0.012)
th = np.sin(2 * np.pi * (70 + 60 * np.exp(-t / 0.02)) * t) * np.exp(-t / 0.09)
save("cut.wav", c * 0.8 + th, -6)
print("ok")
