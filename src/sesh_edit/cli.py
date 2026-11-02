"""sesh-edit: auto-edit longform Waterhouse Sessions interview videos."""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from dataclasses import asdict
from pathlib import Path

import numpy as np

# keep third-party chatter (mediapipe/glog, TF-lite, HF) out of the progress log
os.environ.setdefault("GLOG_minloglevel", "2")
os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "3")
os.environ.setdefault("TRANSFORMERS_VERBOSITY", "error")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

from . import media
from .captions import Style
from .plan import Params, build_plan, is_filler, rearrange

T_START = time.time()


def log(msg: str) -> None:
    print(f"[{time.time() - T_START:6.1f}s] {msg}", flush=True)


def fmt_t(s: float) -> str:
    m, s = divmod(max(0.0, s), 60)
    return f"{int(m):02d}:{s:05.2f}"


# ------------------------------------------------------------------ steps

def parse_t(x: str) -> float:
    """'1234.5', '20:29', '20:29.4' or '1:02:03' -> seconds."""
    sec = 0.0
    for part in x.strip().split(":"):
        sec = sec * 60 + float(part)
    return sec


def parse_range(x: str) -> tuple[float, float]:
    a, b = x.split("-", 1)
    return parse_t(a), parse_t(b)


def apply_replacements(words: list[dict], pairs: list[str]) -> tuple[list[dict], list[dict]]:
    """--replace trends=trance: whole-word, case-insensitive, punctuation kept."""
    import re
    done = []
    for pair in pairs:
        old, new = pair.split("=", 1)
        rx = re.compile(r"^(\W*)" + re.escape(old) + r"(\W*)$", re.I)
        for w in words:
            m = rx.match(w["word"])
            if m:
                done.append({"start": w["start"], "from": w["word"], "to": m.group(1) + new + m.group(2)})
                w["word"] = done[-1]["to"]
    return words, done


def resolve_inserts(args, keeps: list[list[float]], off: float, words_v: list[dict], audio_v: np.ndarray) -> list[dict]:
    """--insert-clip / --title-card -> inserts placed before a keep segment index.

    AT is input-file time. If a keep segment starts within 2s of AT, the insert goes
    before it; otherwise the segment holding AT is split at the quietest point between
    words (keeps is modified in place)."""
    from .plan import _quiet_boundary

    def place(at: float) -> int:
        at_v = at - off
        i = min(range(len(keeps)), key=lambda k: abs(keeps[k][0] - at_v))
        if abs(keeps[i][0] - at_v) <= 2.0:
            return i
        t = _quiet_boundary(at_v, words_v, audio_v)
        for k, (s, e) in enumerate(keeps):
            if s < t < e:
                keeps[k:k + 1] = [[s, t], [t, e]]
                return k + 1
        raise SystemExit(f"insert point {fmt_t(at)} is inside a cut; pick a time that is kept")

    raw = []
    for at, path, rng in args.insert_clip:
        a, b = parse_range(rng)
        path = str(Path(path).expanduser().resolve())
        raw.append((parse_t(at), {"kind": "clip", "path": path, "start": a, "dur_s": round(b - a, 3),
                                  "fade_s": args.clip_fade, "gain_db": args.clip_gain, "video_fade_out_s": 0.0}))
    for at, text in args.title_card:
        raw.append((parse_t(at), {"kind": "card", "text": text, "dur_s": args.card_dur, "fade_s": 0.5}))
    out = []
    for at, ins in raw:
        ins["at_input_s"] = at
        out.append(ins)
    for ins in out:
        ins["before"] = place(ins["at_input_s"])
    for ins in out:  # splits may have shifted indices: resolve again (idempotent now)
        ins["before"] = place(ins["at_input_s"])
    # a clip directly followed by a title card dips to black with its audio fade
    for ins in out:
        if ins["kind"] == "clip" and any(o["kind"] == "card" and o["before"] == ins["before"] for o in out):
            ins["video_fade_out_s"] = ins["fade_s"]
    return out


def step_transcribe(work: Path, audio16k: np.ndarray, force: bool) -> list[dict]:
    from .transcribe import ALIGN_MODEL, ASR_MODEL, transcribe

    p = work / "transcript.json"
    if p.exists() and not force:
        log("1/7 transcribe: cached")
        return json.loads(p.read_text())["words"]
    log("1/7 transcribe: CrisperWhisper (verbatim) + wav2vec2 forced alignment")
    words = transcribe(audio16k, log=lambda m: log(m))
    p.write_text(json.dumps({"asr_model": ASR_MODEL, "align_model": ALIGN_MODEL, "words": words}))
    return words


def transcript_lines(words: list[dict], max_words: int = 18, pause: float = 1.0) -> list[tuple[float, str]]:
    lines, cur, t0, prev = [], [], 0.0, 0.0
    for w in words:
        if cur and (w["start"] - prev > pause or len(cur) >= max_words):
            lines.append((t0, " ".join(cur)))
            cur = []
        if not cur:
            t0 = w["start"]
        cur.append(w["word"])
        prev = w["end"]
    if cur:
        lines.append((t0, " ".join(cur)))
    return lines


PRETAKE_PROMPT = """You are helping edit a long-form interview video ("Waterhouse Sessions": the host interviews a guest/DJ at Waterhouse Studios, Amsterdam). Below is a verbatim transcript; each line starts with its timestamp in seconds. Fillers appear as [UH]/[UM].

Task 1 - take_start_s: recordings often begin with pre-take chatter (mic checks, setup, "are we rolling?", small talk) before the real take begins, often with an intro like "Welcome to another Waterhouse Sessions". Return the timestamp of the first line of the real take. Everything BEFORE it will be cut automatically, so if the recording starts straight into interview content (even mid-conversation) return the first line's timestamp. Do not skip real interview content to reach an intro that was recorded later in the file.

Task 2 - review: list spots a human editor should look at that must NOT be auto-cut: restarts / retakes (a question or answer started over), production chatter or off-topic talk in the middle or end, intros/outros recorded out of order (e.g. the intro recorded at the end of the file), bad takes. Give start/end seconds, a kind, and a short note. Don't flag ordinary conversational stumbles or single repeated words.

Reply with ONLY a JSON object, no prose:
{{"take_start_s": number, "take_start_text": "first words of the take", "reason": "one sentence", "review": [{{"start_s": number, "end_s": number, "kind": "restart|bad_take|chatter|out_of_order|other", "note": "short"}}]}}

Transcript ({duration:.0f}s total):
{transcript}
"""


def step_pretake(work: Path, words: list[dict], duration: float, model: str) -> dict:
    from .llm import ask_json

    log("3/7 pre-take + review list: asking LLM (claude CLI)")
    lines = transcript_lines(words)
    txt = "\n".join(f"[{t:.1f}] {s}" for t, s in lines)
    r = ask_json(PRETAKE_PROMPT.format(duration=duration, transcript=txt), work, model=model)
    resp = r["response"]
    llm_t = float(resp.get("take_start_s", 0.0))
    # snap to nearest word start
    snapped = min(words, key=lambda w: abs(w["start"] - llm_t))["start"] if words else 0.0
    limit = max(120.0, 0.25 * duration)
    review = list(resp.get("review", []))
    auto = True
    if snapped > limit:
        auto = False
        review.insert(0, {"start_s": 0.0, "end_s": snapped, "kind": "other",
                          "note": f"LLM proposed take start at {snapped:.1f}s (> {limit:.0f}s safety limit) - NOT cut; check manually"})
        snapped = words[0]["start"] if words else 0.0
    return {"take_start_s": round(snapped, 3), "llm_take_start_s": llm_t, "text": resp.get("take_start_text", ""),
            "reason": resp.get("reason", ""), "auto_cut": auto, "review": review, "cost_usd": r.get("cost_usd")}


SHEET_PROMPT = """This contact sheet shows mouth close-ups from an interview video (small, low-res faces). Each row is one word that starts with a 'b' or 'p' sound: the lips close, then release at the acoustic burst. Columns are consecutive video frames at {fps:.0f}fps. The header gives each column's time relative to the word onset in the AUDIO track (thin yellow border = 0ms = audio onset).
The thick blue border marks the frame where the lips should release if the audio lags the video by {off_ms:+.0f}ms, the offset our face-tracking detector measured.

For each row, find the frame where the lips are last closed / just start to open (the release), as a time in ms from the header, or null if you can't see the mouth. Audio lag = -(release time), so a release at -100ms means audio lags video by +100ms.
Then judge: is the detected offset ({off_ms:+.0f}ms) consistent with what you see?

Reply with ONLY a JSON object:
{{"rows": [{{"row": 1, "release_ms": number or null}}], "estimated_offset_ms": number or null, "agrees_with_detected": "yes" | "no" | "unclear", "note": "one or two sentences"}}"""


def step_avsync(work: Path, src: str, info: dict, audio16k: np.ndarray, words: list[dict], take_start: float,
                model: str, force: bool, override: float | None) -> dict:
    from . import avsync
    from .llm import ask_json

    p = work / "avsync.json"
    if p.exists() and not force:
        log("5/7 A/V lag: cached")
        res = json.loads(p.read_text())
    else:
        log("5/7 A/V lag: MediaPipe mouth openness vs audio envelope, locked to b/p plosive onsets")
        mp_res, ctx = avsync.detect_offset(src, info["width"], info["height"], info["fps"], audio16k, words,
                                           take_start, info["duration"], log=lambda m: log(m))
        llm_res = None
        if ctx is not None:
            sheet = work / "plosive_contact_sheet.png"
            meta = avsync.plosive_contact_sheet(src, info["width"], info["height"], info["fps"], words, ctx,
                                                mp_res["offset_s"], sheet)
            if meta:
                log("    LLM sanity check of the plosive contact sheet")
                try:
                    r = ask_json(SHEET_PROMPT.format(fps=info["fps"], off_ms=mp_res["offset_s"] * 1000), work,
                                 model=model, image=sheet)
                    resp = r["response"]
                    rel = [x.get("release_ms") for x in resp.get("rows", []) if x.get("release_ms") is not None]
                    llm_res = {
                        "contact_sheet": str(sheet), "rows": meta, "response": resp,
                        "median_offset_from_rows_s": round(-float(np.median(rel)) / 1000, 3) if rel else None,
                        "agrees": resp.get("agrees_with_detected"), "cost_usd": r.get("cost_usd"),
                    }
                except Exception as e:  # LLM is a sanity check only; never block the edit on it
                    llm_res = {"error": str(e), "contact_sheet": str(sheet)}
        res = {"mediapipe": mp_res, "llm_check": llm_res}
        p.write_text(json.dumps(res, indent=1))
    mp_res = res["mediapipe"]
    min_conf = 0.3
    if override is not None:
        applied, why = override, "manual --av-offset override"
    elif mp_res.get("confidence", 0) >= min_conf:
        applied, why = mp_res["offset_s"], f"MediaPipe confidence {mp_res['confidence']} >= {min_conf}"
    else:
        applied, why = 0.0, f"MediaPipe confidence {mp_res.get('confidence', 0)} < {min_conf}: not applied"
    res["applied_s"] = round(float(applied), 3)
    res["applied_reason"] = why
    return res


# ------------------------------------------------------------------ main

def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="sesh-edit", description=__doc__)
    ap.add_argument("input", help="input video, or a .decisions.json with --from-decisions")
    ap.add_argument("-o", "--output", help="output mp4 (default: <input>.edited.mp4)")
    ap.add_argument("--review", action="store_true", help="plan only: print decisions, don't render")
    ap.add_argument("--from-decisions", metavar="JSON", help="render from an existing (possibly hand-edited) decisions.json")
    ap.add_argument("--work-dir", help="cache dir (default: <output stem>.work next to output)")
    ap.add_argument("--force", action="store_true", help="ignore cached transcript / A/V results")
    ap.add_argument("--llm-model", default="sonnet", help="model alias for `claude -p` (default: sonnet)")
    ap.add_argument("--av-offset", type=float, help="force A/V offset in seconds (+ = audio lags video)")
    ap.add_argument("--fillers", help="comma-separated filler words (default: %s)" % ",".join(Params().fillers))
    ap.add_argument("--silence-max", type=float, default=Params.silence_max)
    ap.add_argument("--silence-target", type=float, default=Params.silence_target)
    ap.add_argument("--silence-db", type=float, help="silencedetect threshold in dB (default: auto = noise floor + 10dB)")
    ap.add_argument("--font-px", type=float, default=Style.font_px_1080, help="caption size at 1080p")
    ap.add_argument("--replace", action="append", default=[], metavar="OLD=NEW",
                    help="fix a misheard word in the transcript/captions (whole word, repeatable)")
    ap.add_argument("--cut", action="append", default=[], metavar="START-END",
                    help="also cut this range of the input (e.g. 20:03.5-20:29.3; repeatable)")
    ap.add_argument("--move-to-front", action="append", default=[], metavar="START-END",
                    help="move this range of the input to the start of the edit, e.g. an intro recorded at the end")
    ap.add_argument("--insert-clip", action="append", nargs=3, default=[], metavar=("AT", "FILE", "START-END"),
                    help="insert FILE[START-END] into the edit just before input time AT (repeatable)")
    ap.add_argument("--clip-fade", type=float, default=0.4, help="audio fade in/out on inserted clips (s)")
    ap.add_argument("--clip-gain", type=float, default=-6.0,
                    help="inserted clip level relative to the speech, dB (default -6)")
    ap.add_argument("--title-card", action="append", nargs=2, default=[], metavar=("AT", "TEXT"),
                    help="black title card with TEXT just before input time AT (after any clip at AT; repeatable)")
    ap.add_argument("--card-dur", type=float, default=3.5, help="title card length (s)")
    ap.add_argument("--keep-stereo", action="store_true",
                    help="keep the original channels (default: mix the two mics to a centred, level-matched track)")
    ap.add_argument("--no-loudnorm", action="store_true", help="skip loudness normalisation")
    ap.add_argument("--lufs", type=float, default=-14.0, help="loudness target (default -14 LUFS, true peak -1 dBTP)")
    args = ap.parse_args(argv)

    src = str(Path(args.input).expanduser().resolve())
    decisions_in = None
    if args.from_decisions:
        decisions_in = json.loads(Path(args.from_decisions).read_text())
        src = decisions_in["input"]
    inp = Path(src)
    out_mp4 = Path(args.output).expanduser().resolve() if args.output else inp.with_name(inp.name + ".edited.mp4")
    base = out_mp4.with_suffix("")
    if base.name.endswith(".edited"):
        stem_path = base.with_name(base.name[: -len(".edited")])
    else:
        stem_path = base
    out_srt = out_mp4.with_suffix(".srt")
    out_dec = stem_path.with_name(stem_path.name + ".decisions.json")
    work = Path(args.work_dir) if args.work_dir else stem_path.with_name(stem_path.name + ".work")
    work.mkdir(parents=True, exist_ok=True)
    out_mp4.parent.mkdir(parents=True, exist_ok=True)

    info = media.probe(src)
    log(f"input: {inp.name}  {info['width']}x{info['height']} @{info['fps']:.2f}fps  {fmt_t(info['duration'])}")
    st = Style(font_px_1080=args.font_px)
    params = Params(silence_max=args.silence_max, silence_target=args.silence_target, silence_db=args.silence_db)
    if args.fillers:
        params.fillers = [f.strip().lower() for f in args.fillers.split(",") if f.strip()]

    if decisions_in is None:
        wav16 = work / "audio16k.wav"
        if not wav16.exists():
            media.extract_wav(src, wav16, 16000, 1)
        audio16k, _ = media.read_wav(wav16)
        words = step_transcribe(work, audio16k, args.force)
        fset = set(params.fillers)
        n_fill = sum(is_filler(w["word"], fset) for w in words)
        log(f"2/7 fillers in transcript: {n_fill} (of {len(words)} words)")

        pre = step_pretake(work, words, info["duration"], args.llm_model)
        log(f"    take starts at {fmt_t(pre['take_start_s'])}: \"{pre['text']}\"  (auto_cut={pre['auto_cut']})")

        # adaptive silencedetect threshold: noise floor (10th pct of 100ms RMS) + margin
        hop = 1600
        n = len(audio16k) // hop
        r = 20 * np.log10(np.sqrt((audio16k[: n * hop].reshape(n, hop) ** 2).mean(1)) + 1e-9)
        params.noise_floor_db = round(float(np.percentile(r, 10)), 1)
        if params.silence_db is None:
            params.silence_db = float(np.clip(round(np.percentile(r, 10) + params.silence_margin_db, 1), -60, -30))
        sil_p = work / f"silences_mono16k_{params.silence_db:.1f}dB.json"
        if sil_p.exists() and not args.force:
            silences = json.loads(sil_p.read_text())
        else:
            # run on the same mono mix the threshold was measured on (stereo->mono downmix gain varies)
            silences = media.silencedetect(str(wav16), noise_db=params.silence_db, min_dur=0.3)
            sil_p.write_text(json.dumps(silences))
        log(f"4/7 silencedetect @ {params.silence_db}dB: {len(silences)} silent intervals (cross-check for gap tightening)")

        av = step_avsync(work, src, info, audio16k, words, pre["take_start_s"], args.llm_model, args.force, args.av_offset)
        off = av["applied_s"]
        mp_ = av["mediapipe"]
        log(f"    A/V: detected {mp_.get('offset_s', 0) * 1000:+.0f}ms conf={mp_.get('confidence')} -> applied {off * 1000:+.0f}ms ({av['applied_reason']})")
        if av.get("llm_check"):
            lc = av["llm_check"]
            log(f"    LLM check: agrees={lc.get('agrees')} llm_estimate={lc.get('response', {}).get('estimated_offset_ms')}ms")

        # ---- shift everything into video time, then plan cuts
        from .render import shift_audio

        words, replaced = apply_replacements(words, args.replace)
        for r in replaced:
            log(f"    replaced {r['from']!r} -> {r['to']!r} at {fmt_t(r['start'])}")
        words_v = [dict(w, start=w["start"] - off, end=w["end"] - off) for w in words]
        sil_v = [(s - off, e - off) for s, e in silences]
        audio_v = shift_audio(audio16k, 16000, off)
        plan = build_plan(words_v, pre["take_start_s"] - off, info["duration"], sil_v, audio_v, params)
        cuts = plan["cuts"]
        manual = None
        if args.cut or args.move_to_front:
            # ranges are given in input-file time (as in the review list); plan is in video time
            keeps0 = plan["keep_segments"]
            plan["keep_segments"], manual = rearrange(
                keeps0, [(a - off, b - off) for a, b in map(parse_range, args.cut)],
                [(a - off, b - off) for a, b in map(parse_range, args.move_to_front)], words_v, audio_v)
            manual["cut_removed_s"] = round(sum(e - s for s, e in keeps0) - sum(e - s for s, e in plan["keep_segments"]), 2)
            for a, b in manual["cut_v"]:
                log(f"    manual cut {fmt_t(a + off)}-{fmt_t(b + off)}")
            for a, b in manual["move_to_front_v"]:
                log(f"    moved to front {fmt_t(a + off)}-{fmt_t(b + off)}")
        inserts = resolve_inserts(args, plan["keep_segments"], off, words_v, audio_v)
        for ins in inserts:
            what = f"{Path(ins['path']).name} {fmt_t(ins['start'])}-{fmt_t(ins['start'] + ins['dur_s'])}" \
                if ins["kind"] == "clip" else repr(ins["text"])
            log(f"    insert {ins['kind']} before keep segment {ins['before']}: {what}")
        kinds: dict[str, float] = {}
        counts: dict[str, int] = {}
        for c in cuts:
            kinds[c["kind"]] = kinds.get(c["kind"], 0) + c["end"] - c["start"]
            counts[c["kind"]] = counts.get(c["kind"], 0) + 1
        n_fill_cut = sum(1 for w in words_v if is_filler(w["word"], fset) and w["start"] >= plan["take_start_v"] - 0.05
                         and any(c["start"] <= w["start"] + 0.03 and c["end"] >= w["end"] - 0.03 for c in cuts))
        filler_audio = sum(c.get("filler_s", 0.0) for c in cuts if c["kind"] == "filler")
        filler_cut_total = sum(c["end"] - c["start"] for c in cuts if c["kind"] == "filler")
        silence_total = kinds.get("silence", 0.0) + (filler_cut_total - filler_audio)
        out_dur = sum(e - s for s, e in plan["keep_segments"]) + sum(i["dur_s"] for i in inserts)
        decisions = {
            "version": 1,
            "input": src,
            "input_info": info,
            "output": str(out_mp4),
            "params": asdict(params),
            "style": asdict(st),
            "transcript": {"path": str(work / "transcript.json"), "words": len(words), "fillers_found": n_fill},
            "av_offset": {"applied_s": off, "applied_reason": av["applied_reason"],
                          "mediapipe": {k: v for k, v in mp_.items() if k not in ("xcorr", "event_avg")},
                          "llm_check": av.get("llm_check"), "details": str(work / "avsync.json")},
            "pretake": {k: pre[k] for k in ("take_start_s", "llm_take_start_s", "text", "reason", "auto_cut")}
                       | {"cut_end_s": next((c["end"] for c in cuts if c["kind"] == "pretake"), 0.0)},
            "review": pre["review"] + [
                {"start_s": round(f["start"] + off, 2), "end_s": round(f["end"] + off, 2), "kind": "filler_not_cut",
                 "note": f"'{f['word']}' span is long or contains loud audio (ASR may have missed words) - left in"}
                for f in plan["flagged_fillers"]],
            "stats": {
                "input_duration_s": round(info["duration"], 3),
                "planned_output_duration_s": round(out_dur, 3),
                "fillers_cut": n_fill_cut,
                "fillers_flagged_not_cut": len(plan["flagged_fillers"]),
                "filler_audio_removed_s": round(filler_audio, 2),
                "silence_removed_s": round(silence_total, 2),
                "seconds_removed_by_kind": {k: round(v, 2) for k, v in kinds.items()},
                "cuts_by_kind": counts,
                "gaps_skipped_not_silent": len(plan["skipped_gaps"]),
                "manual_cut_removed_s": manual["cut_removed_s"] if manual else 0.0,
            },
            "replacements": replaced,
            "manual_edits": manual,
            "cuts": cuts,
            "skipped_gaps": plan["skipped_gaps"],
            "keep_segments": plan["keep_segments"],
            "inserts": inserts,
            "audio": {"mix": "original" if args.keep_stereo else "centred",
                      "loudnorm": None if args.no_loudnorm else {"i": args.lufs, "tp": -1.0}},
            "caption_words": plan["caption_words"],
        }
        out_dec.write_text(json.dumps(decisions, indent=1))
        log(f"6/7 plan written: {out_dec}")
    else:
        decisions = decisions_in
        log(f"loaded decisions from {args.from_decisions}")

    s = decisions["stats"]
    print("\n=== PLAN ===")
    print(f"input {fmt_t(s['input_duration_s'])} -> output {fmt_t(s['planned_output_duration_s'])}")
    print(f"fillers cut: {s['fillers_cut']} ({s.get('filler_audio_removed_s')}s of filler audio)   silence removed: {s.get('silence_removed_s')}s")
    print(f"removed by cut kind: {s['seconds_removed_by_kind']}  (filler cuts include the pause around the filler)")
    pt = decisions["pretake"]
    print(f"take start: {fmt_t(pt['take_start_s'])} \"{pt['text']}\"  (cut 0 -> {fmt_t(pt['cut_end_s'])}; auto_cut={pt['auto_cut']})")
    print(f"A/V offset applied: {decisions['av_offset']['applied_s'] * 1000:+.0f}ms ({decisions['av_offset']['applied_reason']})")
    print("review list (NOT cut):")
    for r in decisions["review"]:
        print(f"  {fmt_t(r.get('start_s', 0))}-{fmt_t(r.get('end_s', 0))} [{r.get('kind')}] {r.get('note')}")
    print(f"decisions: {out_dec}\n")
    if args.review:
        log("--review: stopping before render")
        return 0

    from .render import render

    log("7/7 render: one pass, h264 + aac, burned karaoke captions")
    st = Style(**decisions.get("style", asdict(st)))
    res = render(src, info, decisions, out_mp4, out_srt, work, st, fade_ms=decisions["params"]["fade_ms"], log=lambda m: log(m))
    decisions["render"] = {k: v for k, v in res.items() if k in ("audio_mix", "loudness", "inserts")}
    out_dec.write_text(json.dumps(decisions, indent=1))
    log(f"done: {out_mp4} ({fmt_t(res['output_duration_s'])}), {out_srt}, {res['caption_lines']} caption lines")
    log(f"total runtime {time.time() - T_START:.0f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
