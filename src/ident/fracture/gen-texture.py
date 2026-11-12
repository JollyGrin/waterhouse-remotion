# /// script
# requires-python = ">=3.10"
# dependencies = ["numpy", "pillow"]
# ///
"""FRACTURE: board-formed cast concrete, raking light baked in. -> public/ident/fracture/concrete.png
Block is 1000x951 px on screen; texture rendered at 1.5x."""
import os, sys
import numpy as np
from PIL import Image

OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "public", "ident", "fracture")
TW, TH = 1500, 1427
rng = np.random.default_rng(11)


def up(a, w=TW, h=TH):
    return np.asarray(Image.fromarray(a.astype(np.float32), mode="F").resize((w, h), Image.BICUBIC))


def fbm(oct_sizes, amps, aniso=(1, 1)):
    out = np.zeros((TH, TW), np.float32)
    for s, a in zip(oct_sizes, amps):
        gw = max(2, int(TW / s / aniso[0]))
        gh = max(2, int(TH / s / aniso[1]))
        out += a * up(rng.standard_normal((gh, gw)))
    return out


yy, xx = np.mgrid[0:TH, 0:TW].astype(np.float32)

# --- height ---
h = fbm([300, 120, 48, 18, 6, 2.5], [6, 3, 1.6, 0.9, 0.5, 0.35])
# board-formed: horizontal boards ~165 tex px tall, each with a slight step and wood grain
BOARD = 168
board = (yy // BOARD).astype(int)
offs = rng.uniform(-1.6, 1.6, board.max() + 2)
h += offs[board]
grain = fbm([60, 22, 9], [1.4, 0.9, 0.5], aniso=(6, 0.5))  # long horizontal streaks
h += grain * 0.9
# joints: thin grooves with a tiny fin
jy = yy % BOARD
h -= 4.0 * np.exp(-((jy - 1.5) ** 2) / 2.0)
h += 1.2 * np.exp(-((jy - 4.5) ** 2) / 1.5)
# tie holes (Ando grid)
for ty in range(int(BOARD * 1.5), TH, BOARD * 3):
    for tx in range(180, TW, 380):
        cx = tx + rng.uniform(-3, 3)
        cy = ty + rng.uniform(-3, 3)
        r = np.hypot(xx - cx, yy - cy)
        h -= 9.0 * np.clip((15 - r) / 3, 0, 1)
        h += 0.8 * np.exp(-((r - 17) ** 2) / 4)
# bug holes (air pits)
pits = np.zeros((TH, TW), np.float32)
for _ in range(900):
    cx, cy = rng.uniform(0, TW), rng.uniform(0, TH)
    rr = rng.uniform(1.2, 4.5) * (1.6 if rng.random() < 0.08 else 1)
    x0, x1 = int(max(0, cx - rr - 2)), int(min(TW, cx + rr + 3))
    y0, y1 = int(max(0, cy - rr - 2)), int(min(TH, cy + rr + 3))
    d = np.hypot(xx[y0:y1, x0:x1] - cx, yy[y0:y1, x0:x1] - cy)
    pits[y0:y1, x0:x1] = np.minimum(pits[y0:y1, x0:x1], -5 * np.clip((rr - d) / 1.2, 0, 1))
h += pits

# --- shade: raking light from the upper left ---
gy, gx = np.gradient(h)
L = np.array([-0.78, -0.42, 0.46])
L /= np.linalg.norm(L)
n = np.stack([-gx * 0.55, -gy * 0.55, np.ones_like(h)])
n /= np.linalg.norm(n, axis=0)
lam = np.clip(n[0] * L[0] + n[1] * L[1] + n[2] * L[2], 0, None) / L[2]
lam = 0.25 + 0.75 * lam

# albedo: stains, run-off streaks, lighter laitance patches
alb = 0.5 + 0.06 * fbm([420, 160], [1, 0.6]) / 6
streak = fbm([40, 14], [1, 0.5], aniso=(0.15, 8))
alb -= 0.03 * np.clip(streak, 0, None)
alb += 0.025 * fbm([8, 3], [1, 1]) / 2
alb = np.clip(alb, 0.25, 0.75)

# light falloff across the slab (work light upper left)
u, v = xx / TW, yy / TH
fall = 1.18 - 0.5 * u - 0.22 * v + 0.18 * np.exp(-(((u - 0.12) / 0.35) ** 2 + ((v - 0.1) / 0.4) ** 2))
val = alb * lam * fall
val = val / np.percentile(val, 50) * 0.40  # median ~ 102/255
val = np.clip(val, 0, 1)
rgb = np.stack([val * 1.0, val * 0.975, val * 0.935], -1)
Image.fromarray((rgb * 255).astype(np.uint8)).save(f"{OUT}/concrete.png", optimize=True)
print("ok", val.mean(), val.min(), val.max())
