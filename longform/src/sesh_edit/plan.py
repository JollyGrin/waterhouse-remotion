"""Turn transcript + detections into cut decisions (keep segments in video time)."""
from __future__ import annotations

import re
from dataclasses import dataclass, field

import numpy as np

DEFAULT_FILLERS = ["um", "umm", "uh", "uhh", "uhm", "ehm", "euh", "erm", "eh", "hmm", "hm"]


@dataclass
class Params:
    fillers: list[str] = field(default_factory=lambda: list(DEFAULT_FILLERS))
    silence_max: float = 0.6       # gaps longer than this get tightened
    silence_target: float = 0.2    # ...down to this
    silence_cover: float = 0.7     # fraction of the gap silencedetect must confirm
    silence_db: float | None = None  # silencedetect threshold; None = auto (noise floor + margin)
    silence_margin_db: float = 10.0
    noise_floor_db: float | None = None   # 10th pct of 100ms RMS; set automatically
    filler_expand_margin_db: float = 5.0  # "voiced" = 20ms level above noise floor + this
    filler_loud_margin_db: float = 21.0   # fallback loudness ceiling (floor + this) if neighbours have no audio
    filler_loud_over_words_db: float = 6.0  # filler-gap audio this much louder than the adjacent words = laugh/other, flag
    filler_max: float = 1.2               # more voiced audio than this in a filler gap = flagged, not cut
    filler_max_extra: float = 0.5         # ...plus this per additional filler in the same gap
    pretake_pad: float = 0.25      # keep this much before the first word of the take
    snap_window: float = 0.025     # move cut points to the quietest spot within +/- this
    fade_ms: float = 10.0
    min_keep: float = 0.08         # drop keep-slivers shorter than this if they hold no word


def norm(word: str) -> str:
    return re.sub(r"[^a-z]", "", word.lower())


def is_filler(word: str, fillers: set[str]) -> bool:
    return norm(word) in fillers


def _covered(a: float, b: float, sil: list[tuple[float, float]]) -> float:
    if b <= a:
        return 1.0
    tot = 0.0
    for s, e in sil:
        lo, hi = max(a, s), min(b, e)
        if hi > lo:
            tot += hi - lo
    return tot / (b - a)


def _rms_ms(audio16k: np.ndarray) -> np.ndarray:
    """5ms-window RMS sampled every 1ms."""
    sr = 16000
    sq = np.concatenate([[0.0], np.cumsum(audio16k.astype(np.float64) ** 2)])
    hop, win = sr // 1000, sr // 200
    idx = np.arange(0, len(audio16k) - win, hop)
    return np.sqrt((sq[idx + win] - sq[idx]) / win)


def build_plan(words_v: list[dict], take_start_v: float, duration: float, silences_v: list[tuple[float, float]],
               audio16k_v: np.ndarray, p: Params) -> dict:
    """words_v / silences_v / audio16k_v are already in VIDEO time (A/V offset applied)."""
    fset = set(p.fillers)
    rms = _rms_ms(audio16k_v)

    def snap(t: float, lo: float, hi: float) -> float:
        a = max(lo, t - p.snap_window)
        b = min(hi, t + p.snap_window)
        if b - a < 0.002:
            return t
        i0, i1 = int(a * 1000), int(b * 1000)
        i1 = min(i1, len(rms) - 1)
        if i1 <= i0:
            return t
        return (i0 + int(np.argmin(rms[i0:i1]))) / 1000.0

    take_words = [w for w in words_v if w["start"] >= take_start_v - 0.05]
    kept = [w for w in take_words if not is_filler(w["word"], fset)]
    fillers = [w for w in take_words if is_filler(w["word"], fset)]
    first_start = kept[0]["start"] if kept else take_start_v
    cut_start = max(0.0, min(take_start_v, first_start) - p.pretake_pad)

    # 20ms-smoothed level in dB at 1ms resolution
    sm = 20 * np.log10(np.convolve(rms, np.ones(20) / 20, mode="same") + 1e-9)
    floor = p.noise_floor_db if p.noise_floor_db is not None else (p.silence_db or -50.0) - p.silence_margin_db
    voiced_thr = floor + p.filler_expand_margin_db
    loud_ceiling = floor + p.filler_loud_margin_db

    def voiced_runs(lo: float, hi: float) -> list[list[float]]:
        i0, i1 = int(lo * 1000), min(int(hi * 1000), len(sm))
        if i1 <= i0:
            return []
        v = sm[i0:i1] > voiced_thr
        runs, st = [], None
        for k, on in enumerate(np.append(v, False)):
            if on and st is None:
                st = k
            elif not on and st is not None:
                runs.append([(i0 + st) / 1000, (i0 + k) / 1000])
                st = None
        merged_r: list[list[float]] = []
        for r in runs:
            if merged_r and r[0] - merged_r[-1][1] < 0.06:
                merged_r[-1][1] = r[1]
            else:
                merged_r.append(r)
        merged_r = [r for r in merged_r if r[1] - r[0] >= 0.03]
        # short runs glued to a neighbouring word are that word's tail/onset (CTC ends are peaky)
        if len(merged_r) > 1 and merged_r[0][0] <= lo + 0.005 and merged_r[0][1] - merged_r[0][0] < 0.15 \
                and merged_r[1][0] - merged_r[0][1] >= 0.08:
            merged_r.pop(0)
        if len(merged_r) > 1 and merged_r[-1][1] >= hi - 0.005 and merged_r[-1][1] - merged_r[-1][0] < 0.15 \
                and merged_r[-1][0] - merged_r[-2][1] >= 0.08:
            merged_r.pop()
        return merged_r

    cuts: list[dict] = []
    if cut_start > 0:
        cuts.append({"start": 0.0, "end": cut_start, "kind": "pretake"})
    skipped_gaps = []
    suspects: list[dict] = []
    fi = 0
    for i in range(len(kept) - 1):
        a, b = kept[i]["end"], kept[i + 1]["start"]
        gf = []
        while fi < len(fillers) and fillers[fi]["start"] < b:
            if fillers[fi]["start"] >= a - 0.01:
                gf.append(fillers[fi])
            fi += 1
        if b <= a:
            continue
        if gf:
            # The transcript says this gap holds only fillers, so ALL voiced audio in it is
            # the filler(s). (The aligner's own filler spans are unreliable: often 40-80ms,
            # sometimes parked in the silence next to the actual "uhhh".)
            runs = voiced_runs(a + 0.03, b - 0.03)
            if runs:
                fs_, fe_ = runs[0][0], runs[-1][1]
                voiced = sum(r[1] - r[0] for r in runs)
                peak = float(np.percentile(sm[int(fs_ * 1000) : int(fe_ * 1000)], 95))
                nb = np.concatenate([sm[int(w["start"] * 1000) : max(int(w["end"] * 1000), int(w["start"] * 1000) + 1)]
                                     for w in (kept[i], kept[i + 1])])
                nb_peak = float(np.percentile(nb, 95)) if len(nb) else loud_ceiling
                allow = p.filler_max + p.filler_max_extra * (len(gf) - 1)
                if voiced > allow or peak > nb_peak + p.filler_loud_over_words_db:
                    # too long / too loud for an "uh": the ASR probably missed real words here
                    suspects.append({"start": fs_, "end": fe_, "word": " ".join(f["word"] for f in gf),
                                     "voiced_s": round(voiced, 2), "peak_db": round(peak, 1)})
                    gf = []
            else:
                fs_, fe_ = min(f["start"] for f in gf), max(f["end"] for f in gf)
        if gf:
            nonfill = max(0.0, (b - a) - (fe_ - fs_))  # outside [fs_, fe_] the gap is below voiced_thr
            keep_total = nonfill if nonfill <= p.silence_max else p.silence_target
            lead = min(keep_total / 2, max(0.0, fs_ - a))
            trail = min(keep_total - lead, max(0.0, b - fe_))
            cs, ce = a + lead, b - trail
            if ce - cs > 0.02:
                cuts.append({"start": snap(cs, a, fs_), "end": snap(ce, fe_, b), "kind": "filler",
                             "words": [f["word"] for f in gf], "filler_s": round(fe_ - fs_, 3),
                             "context": f"{kept[i]['word']} [{' '.join(f['word'] for f in gf)}] {kept[i + 1]['word']}"})
        elif b - a > p.silence_max:
            cover = _covered(a + 0.1, b - 0.1, silences_v)
            if cover >= p.silence_cover:
                cs, ce = a + p.silence_target / 2, b - p.silence_target / 2
                cuts.append({"start": snap(cs, a, b), "end": snap(ce, a, b), "kind": "silence", "gap": round(b - a, 3)})
            else:
                # gap holds untranscribed sound (crosstalk, laughs, missed words): only remove
                # the dead-air stretches silencedetect confirms, never the sound itself.
                part = 0
                for s_, e_ in silences_v:
                    lo, hi = max(s_, a), min(e_, b)
                    if hi - lo > p.silence_max:
                        cuts.append({"start": snap(lo + p.silence_target / 2, lo, hi), "end": snap(hi - p.silence_target / 2, lo, hi),
                                     "kind": "silence", "gap": round(b - a, 3), "partial": True})
                        part += 1
                skipped_gaps.append({"start": round(a, 3), "end": round(b, 3), "silence_coverage": round(cover, 2),
                                     "silent_parts_cut": part, "after": kept[i]["word"], "before": kept[i + 1]["word"]})
    # tail: tighten trailing silence after last word
    if kept and duration - kept[-1]["end"] > p.silence_max:
        cuts.append({"start": kept[-1]["end"] + 0.5, "end": duration, "kind": "tail"})

    cuts.sort(key=lambda c: c["start"])
    # merge overlapping cuts / tiny keeps that contain no word
    merged: list[dict] = []
    for c in cuts:
        if merged and c["start"] - merged[-1]["end"] < p.min_keep:
            between = [w for w in kept if w["start"] < c["start"] and w["end"] > merged[-1]["end"]]
            if not between:
                m = merged[-1]
                m["end"] = max(m["end"], c["end"])
                m.setdefault("merged", []).append(c["kind"])
                continue
        merged.append(dict(c))
    # keep segments = complement
    keeps, t = [], 0.0
    for c in merged:
        if c["start"] > t:
            keeps.append([round(t, 4), round(c["start"], 4)])
        t = max(t, c["end"])
    if t < duration:
        keeps.append([round(t, 4), round(duration, 4)])
    keeps = [k for k in keeps if k[1] - k[0] > 0.01]
    for c in merged:
        c["start"], c["end"] = round(c["start"], 4), round(c["end"], 4)

    # caption words: kept words with their (video-time) spans
    cap_words = [{"word": w["word"], "start": round(w["start"], 3), "end": round(w["end"], 3)} for w in kept]
    flagged = [dict(f, start=round(f["start"], 3), end=round(f["end"], 3)) for f in suspects]
    return {"take_start_v": take_start_v, "flagged_fillers": flagged, "cuts": merged, "keep_segments": keeps, "caption_words": cap_words, "skipped_gaps": skipped_gaps}


# ------------------------------------------------------------ time mapping

class TimeMap:
    """Maps source (video) time <-> output time through the edit timeline.

    The timeline is the keep segments, played in list order (not necessarily
    chronological, e.g. an intro recorded at the end and moved to the front), plus
    optional inserts (clips from other files, title cards) placed before a given keep
    segment. Insert items have NaN source times, so they never match a source time."""

    def __init__(self, keeps: list[list[float]], inserts: list[dict] | None = None):
        items: list[dict] = []
        ins = sorted(inserts or [], key=lambda x: (x["before"], 0 if x["kind"] == "clip" else 1))
        j = 0
        for i in range(len(keeps) + 1):
            while j < len(ins) and ins[j]["before"] <= i:
                items.append(dict(ins[j], dur=float(ins[j]["dur_s"])))
                j += 1
            if i < len(keeps):
                items.append({"kind": "main", "start": keeps[i][0], "end": keeps[i][1], "dur": keeps[i][1] - keeps[i][0]})
        self.items = items
        self.s = np.array([it["start"] if it["kind"] == "main" else np.nan for it in items])
        self.e = np.array([it["end"] if it["kind"] == "main" else np.nan for it in items])
        self.cum = np.concatenate([[0.0], np.cumsum([it["dur"] for it in items])])
        self.total = float(self.cum[-1])

    def item_at(self, t_out: float) -> int:
        i = int(np.searchsorted(self.cum, t_out, side="right")) - 1
        return min(max(i, 0), len(self.items) - 1)

    def segment_of(self, t: float, tol: float = 0.0) -> int | None:
        hit = np.nonzero((self.s - tol <= t) & (t <= self.e + tol))[0]
        return int(hit[0]) if len(hit) else None

    def to_out(self, t: float, tol: float = 0.0) -> float | None:
        """Output time of source time t, or None if t is cut."""
        i = self.segment_of(t, tol)
        if i is None:
            return None
        return float(self.cum[i] + min(max(t, self.s[i]), self.e[i]) - self.s[i])

    def to_src(self, t_out: float) -> float:
        """Source time for output time t_out (NaN inside an insert)."""
        i = self.item_at(t_out)
        return float(self.s[i] + (t_out - self.cum[i]))


# ------------------------------------------------------------ manual rearrangement

def _quiet_boundary(t: float, words_v: list[dict], audio16k_v: np.ndarray) -> float:
    """Move t into the nearest gap between words, at its quietest millisecond."""
    ws = sorted(words_v, key=lambda w: w["start"])
    gaps = [(0.0, ws[0]["start"])] + [(a["end"], b["start"]) for a, b in zip(ws, ws[1:]) if b["start"] > a["end"]] \
        + [(ws[-1]["end"], len(audio16k_v) / 16000)]
    lo, hi = min(gaps, key=lambda g: 0.0 if g[0] <= t <= g[1] else min(abs(t - g[0]), abs(t - g[1])))
    rms = _rms_ms(audio16k_v)
    a, b = int((lo + 0.02) * 1000), int((hi - 0.02) * 1000)
    b = min(b, len(rms) - 1)
    if b <= a:
        return round((lo + hi) / 2, 4)
    return round((a + int(np.argmin(rms[a:b]))) / 1000, 4)


def rearrange(keeps: list[list[float]], cut: list[tuple[float, float]], front: list[tuple[float, float]],
              words_v: list[dict], audio16k_v: np.ndarray) -> tuple[list[list[float]], dict]:
    """Remove `cut` ranges, then move `front` ranges to the start (in the given order).
    All ranges are video time; their edges are snapped to quiet points between words."""
    snap = lambda r: (_quiet_boundary(r[0], words_v, audio16k_v), _quiet_boundary(r[1], words_v, audio16k_v))
    cut, front = [snap(r) for r in cut], [snap(r) for r in front]
    segs = [list(k) for k in keeps]
    for cs, ce in cut:
        nxt = []
        for s, e in segs:
            if e <= cs or s >= ce:
                nxt.append([s, e])
                continue
            if s < cs:
                nxt.append([s, cs])
            if e > ce:
                nxt.append([ce, e])
        segs = nxt
    head = []
    for fs, fe in front:
        rest = []
        for s, e in segs:
            if s < fe and e > fs:
                head.append([max(s, fs), min(e, fe)])
                if s < fs:
                    rest.append([s, fs])
                if e > fe:
                    rest.append([fe, e])
            else:
                rest.append([s, e])
        segs = rest
    out = [[round(s, 4), round(e, 4)] for s, e in head + segs if e - s > 0.01]
    return out, {"cut_v": [list(r) for r in cut], "move_to_front_v": [list(r) for r in front]}
