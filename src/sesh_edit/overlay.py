"""sesh-overlay: burn captions + title-card text from a decisions.json onto a clean cut at its
own resolution (typically the 1080p output of sesh-upscale).

    sesh-overlay session.decisions.json session.clean.1080p.mp4 -o session.edited.1080p.mp4

The video must be the clean cut of the same decisions (frame n = output frame n), at any
resolution. Audio is copied through untouched."""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

import numpy as np

from .captions import Style, write_srt
from .media import probe
from .plan import TimeMap
from .render import Compositor, _encoder, caption_lines


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="sesh-overlay", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("decisions", help="<name>.decisions.json the clean cut was rendered from")
    ap.add_argument("video", help="clean cut (no captions), e.g. <name>.clean.1080p.mp4")
    ap.add_argument("-o", "--output", help="output mp4 (default: <video stem>.captioned.mp4)")
    ap.add_argument("--crf", type=int, default=16, help="x264 CRF (default 16)")
    ap.add_argument("--preset", default="slow", help="x264 preset (default slow)")
    ap.add_argument("--partial", action="store_true",
                    help="the video is only the start of the clean cut (e.g. a sesh-upscale --preview)")
    ap.add_argument("--font-px", type=float, help="caption size at 1080p (default: from decisions)")
    args = ap.parse_args(argv)

    t0 = time.time()
    dec = json.loads(Path(args.decisions).expanduser().read_text())
    vid = Path(args.video).expanduser().resolve()
    out = Path(args.output).expanduser().resolve() if args.output else vid.with_name(vid.stem + ".captioned.mp4")
    info = probe(str(vid))
    W, H, fps = info["width"], info["height"], info["fps"]
    if abs(fps - dec["input_info"]["fps"]) > 0.01:
        print(f"error: video is {fps} fps, decisions were rendered at {dec['input_info']['fps']} fps", file=sys.stderr)
        return 2
    st = Style(**dec.get("style", {}))
    if args.font_px:
        st.font_px_1080 = args.font_px
    tm = TimeMap(dec["keep_segments"], dec.get("inserts", []))
    n_expect = int(round(tm.total * fps))
    n_have = int(round(info["duration"] * fps))
    if args.partial and n_have <= n_expect + max(3, fps):
        print(f"partial: {n_have} of {n_expect} frames ({n_have / fps:.1f}s of {tm.total:.1f}s)")
    elif abs(n_have - n_expect) > max(3, fps):  # allow small aac/container rounding
        print(f"error: video has ~{n_have} frames but the decisions timeline has {n_expect}; "
              "is this the clean cut of these decisions? (a shorter preview needs --partial)", file=sys.stderr)
        return 2
    lines, rend = caption_lines(dec["caption_words"], tm, W, H, st)
    write_srt([ln for ln in lines if ln["start"] < n_have / fps], out.with_suffix(".srt"))
    comp = Compositor(tm, lines, rend, W, H, fps)
    print(f"sesh-overlay: {vid.name} {W}x{H} @{fps:g}fps, {n_have} frames, {len(lines)} caption lines -> {out.name}", flush=True)

    dec_proc = subprocess.Popen(["ffmpeg", "-v", "error", "-i", str(vid), "-an", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
                                stdout=subprocess.PIPE)
    enc = _encoder(out, W, H, fps, vid, crf=args.crf, preset=args.preset, audio_copy=True)
    fsz = W * H * 3
    n = 0
    try:
        while True:
            b = dec_proc.stdout.read(fsz)
            if len(b) < fsz:
                break
            frame = np.frombuffer(b, np.uint8).reshape(H, W, 3)
            enc.stdin.write(comp.overlay(n, frame).tobytes())
            n += 1
            if n % int(fps * 60) == 0:
                el = time.time() - t0
                print(f"  {n / fps / 60:5.1f}/{n_have / fps / 60:.1f} min  ({n / el:.1f} fps, eta {(n_have - n) / (n / el) / 60:.0f} min)", flush=True)
    finally:
        enc.stdin.close()
        enc.wait()
        dec_proc.stdout.close()
        dec_proc.wait()
    if enc.returncode != 0:
        print("error: ffmpeg encode failed", file=sys.stderr)
        return 1
    print(f"done: {out} ({n} frames, {time.time() - t0:.0f}s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
