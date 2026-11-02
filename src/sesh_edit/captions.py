"""Karaoke captions: line grouping, SRT, and Pillow rendering of the overlay strip.

Style (matched to reference/*.jpg, Dean's Descript output):
  single line, ~6-8 words, centred, Inter Bold, soft drop shadow, no outline;
  spoken words white, current word white on a rounded #00AEFF box,
  upcoming words ~50% white.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

FONT_PATH = Path(__file__).parent / "fonts" / "Inter-Bold.ttf"


@dataclass
class Style:
    font_px_1080: float = 68.0    # font size at 1080p (calibrated to reference text width); scaled by frame height
    center_y: float = 0.845       # vertical centre of the line, fraction of frame height
    max_words: int = 7
    max_width: float = 0.88       # fraction of frame width
    box_color: tuple = (0, 174, 255)
    upcoming_alpha: float = 0.5
    shadow_alpha: float = 0.6
    line_gap_hold: float = 0.6    # keep a line up through pauses shorter than this


def clean_word(w: str) -> str:
    return re.sub(r"\[[A-Z]+\]", "", w).strip()


def group_lines(words: list[dict], frame_w: int, font: ImageFont.FreeTypeFont, st: Style) -> list[dict]:
    """words: [{word, start, end}] in OUTPUT time. Returns [{words:[...], start, end}]."""
    space = font.getlength(" ")
    lines, cur, cur_w = [], [], 0.0
    maxw = frame_w * st.max_width

    def flush():
        nonlocal cur, cur_w
        if cur:
            lines.append({"words": cur, "start": cur[0]["start"], "end": cur[-1]["end"]})
        cur, cur_w = [], 0.0

    for w in words:
        text = clean_word(w["word"])
        if not text:
            continue
        ww = font.getlength(text)
        if cur:
            gap = w["start"] - cur[-1]["end"]
            max_gap = 2.0 if len(cur) < 3 else 1.0  # don't strand 1-2 word lines over a short pause
            if len(cur) >= st.max_words or cur_w + space + ww > maxw or gap > max_gap:
                flush()
            elif re.search(r"[.?!]$", cur[-1]["text"]) and len(cur) >= 3:
                flush()
            elif re.search(r"[,;:]$", cur[-1]["text"]) and len(cur) >= 5:
                flush()
        cur.append({"text": text, "start": w["start"], "end": w["end"]})
        cur_w += (space if len(cur) > 1 else 0) + ww
    flush()
    # display windows: hold through short pauses, otherwise linger briefly
    for i, ln in enumerate(lines):
        nxt = lines[i + 1]["start"] if i + 1 < len(lines) else None
        if nxt is not None and nxt - ln["end"] < st.line_gap_hold:
            ln["show_end"] = nxt
        else:
            ln["show_end"] = ln["end"] + 0.3 if nxt is None else min(ln["end"] + 0.3, nxt)
    return lines


def _ts(t: float) -> str:
    ms = int(round(t * 1000))
    h, ms = divmod(ms, 3600000)
    m, ms = divmod(ms, 60000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def write_srt(lines: list[dict], path: Path) -> None:
    out = []
    for i, ln in enumerate(lines, 1):
        out.append(f"{i}\n{_ts(ln['start'])} --> {_ts(ln['show_end'])}\n{' '.join(w['text'] for w in ln['words'])}\n")
    path.write_text("\n".join(out))


class Renderer:
    """Renders RGBA caption strips; cached per (line, current word) state."""

    def __init__(self, frame_w: int, frame_h: int, st: Style):
        self.W, self.H, self.st = frame_w, frame_h, st
        self.fs = max(10, round(st.font_px_1080 * frame_h / 1080))
        self.font = ImageFont.truetype(str(FONT_PATH), self.fs)
        self.strip_h = int(self.fs * 2.0)
        self.y0 = int(round(frame_h * st.center_y - self.strip_h / 2))
        self.y0 = min(max(0, self.y0), frame_h - self.strip_h)
        self._cache: dict = {}

    def strip(self, line: dict, cur: int) -> np.ndarray:
        key = (id(line), cur)
        if key in self._cache:
            return self._cache[key]
        arr = self._render(line, cur)
        if len(self._cache) > 64:
            self._cache.clear()
        self._cache[key] = arr
        return arr

    def _render(self, line: dict, cur: int) -> np.ndarray:
        fs, font, st = self.fs, self.font, self.st
        texts = [w["text"] for w in line["words"]]
        space = font.getlength(" ")
        widths = [font.getlength(t) for t in texts]
        total = sum(widths) + space * (len(texts) - 1)
        x = (self.W - total) / 2
        asc, desc = font.getmetrics()
        cy = self.strip_h / 2
        # vertically centre on cap-height-ish: put baseline so x-height middle sits at cy
        baseline = cy + fs * 0.36
        top = baseline - asc

        size = (self.W, self.strip_h)
        pad_x, pad_y = fs * 0.14, fs * 0.13
        xs = []
        for w in widths:
            xs.append(x)
            x += w + space
        # 1) soft drop shadow (black, blurred, offset down-right)
        off = max(1, round(fs * 0.045))
        sh = Image.new("L", size, 0)
        sd = ImageDraw.Draw(sh)
        for i, t in enumerate(texts):
            a = 255 if i <= cur else int(255 * st.upcoming_alpha)
            sd.text((xs[i] + off, top + off), t, font=font, fill=int(a * st.shadow_alpha))
        sh = sh.filter(ImageFilter.GaussianBlur(max(1.0, fs * 0.07)))
        img = Image.new("RGBA", size, (0, 0, 0, 0))
        img.putalpha(sh)
        # 2) highlight box behind the current word
        if 0 <= cur < len(texts):
            box = Image.new("RGBA", size, (0, 0, 0, 0))
            bx0 = xs[cur] - pad_x
            bx1 = xs[cur] + widths[cur] + pad_x
            by0 = baseline - fs * 0.80 - pad_y
            by1 = baseline + fs * 0.22 + pad_y
            ImageDraw.Draw(box).rounded_rectangle([bx0, by0, bx1, by1], radius=fs * 0.12, fill=st.box_color + (255,))
            img = Image.alpha_composite(img, box)
        # 3) text: spoken/current = white, upcoming = translucent white
        for full in (True, False):
            mask = Image.new("L", size, 0)
            md = ImageDraw.Draw(mask)
            for i, t in enumerate(texts):
                if (i <= cur) == full:
                    md.text((xs[i], top), t, font=font, fill=255)
            if not full:
                mask = mask.point(lambda v: int(v * st.upcoming_alpha))
            layer = Image.new("RGBA", size, (255, 255, 255, 0))
            layer.putalpha(mask)
            img = Image.alpha_composite(img, layer)
        return np.asarray(img).copy()

    def composite(self, frame: np.ndarray, strip: np.ndarray) -> None:
        """Alpha-blend strip (RGBA) onto frame (RGB, modified in place)."""
        region = frame[self.y0 : self.y0 + self.strip_h]
        a = strip[:, :, 3:4].astype(np.float32) / 255.0
        region[:] = (strip[:, :, :3] * a + region * (1 - a)).astype(np.uint8)


def state_at(lines: list[dict], t: float, hint: int = 0):
    """Return (line, current_word_index, new_hint) for output time t, or (None, -1, hint)."""
    i = hint
    while i < len(lines) and lines[i]["show_end"] <= t:
        i += 1
    if i >= len(lines) or lines[i]["start"] > t:
        return None, -1, i
    ln = lines[i]
    cur = 0
    for k, w in enumerate(ln["words"]):
        if w["start"] <= t:
            cur = k
    return ln, cur, i
