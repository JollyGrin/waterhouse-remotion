"""sesh-upscale: resumable, chunked video upscaling (Real-ESRGAN ncnn-vulkan or plain Lanczos).

    sesh-upscale IN.mp4 -o OUT.mp4 --work DIR [--method x4plus] [--height 1080] [--tile 512 --jobs 1:1:2]
    sesh-upscale --status DIR          # print progress / ETA / GPU stats of a (running) job
    sesh-upscale --preview DIR         # stitch the chunks finished so far into <output>.preview.mp4
    sesh-upscale ... --stop-after 120  # pause after the first 2:00 (writes the preview); drop the flag to continue

Pipeline: extract all source frames once (PNG) -> per chunk: Real-ESRGAN 4x -> Lanczos down to
--height -> x264 chunk -> delete the 4x PNGs. Finally concat the chunks (stream copy) and mux the
input's audio. Re-running the same command resumes: finished chunks are skipped, and frames
already upscaled inside an interrupted chunk are not redone.

Monitoring: DIR/status.json (rewritten every few seconds) and DIR/upscale.log. With an NVIDIA
GPU, nvidia-smi is sampled every 2 s into DIR/gpu.csv and summarised in status.json.

Standard library only and Python >= 3.9, so it runs without the sesh-edit environment, e.g. on
Windows:  uv run --no-project python -I src\\sesh_edit\\upscale.py ...
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import threading
import time
from pathlib import Path

PNG_4X_MB = 4.0   # ~3.7 MB per 2560x1440 x4plus PNG (measured on 640x360 sources)


def now() -> str:
    return time.strftime("%Y-%m-%d %H:%M:%S")


class Job:
    def __init__(self, work: Path):
        self.work = work
        self.status_p = work / "status.json"
        self.log_p = work / "upscale.log"
        self.status: dict = json.loads(self.status_p.read_text()) if self.status_p.exists() else {}
        self.lock = threading.Lock()

    def log(self, msg: str) -> None:
        line = f"[{now()}] {msg}"
        print(line, flush=True)
        with open(self.log_p, "a", encoding="utf-8") as f:
            f.write(line + "\n")

    def save(self, **kw) -> None:
        with self.lock:
            self.status.update(kw)
            self.status["updated"] = now()
            tmp = self.status_p.with_suffix(".tmp")
            tmp.write_text(json.dumps(self.status, indent=1))
            os.replace(tmp, self.status_p)


# ---------------------------------------------------------------- GPU sampling

class GpuSampler(threading.Thread):
    """Polls nvidia-smi every `every` s; keeps running stats while `active` is set (i.e. during
    upscaling, so idle/encode time doesn't dilute the averages)."""

    FIELDS = "utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw,clocks.sm"

    def __init__(self, job: Job, every: float = 2.0):
        super().__init__(daemon=True)
        self.job, self.every = job, every
        self.ok = shutil.which("nvidia-smi") is not None
        self.active = threading.Event()
        self.stop = threading.Event()
        self.n = 0
        self.sum_util = self.sum_pow = 0.0
        self.max_mem = self.max_temp = 0.0
        self.last: dict = {}

    def run(self) -> None:
        if not self.ok:
            return
        csv = self.job.work / "gpu.csv"
        new = not csv.exists()
        with open(csv, "a", encoding="utf-8") as f:
            if new:
                f.write("time,util_pct,mem_mib,mem_total_mib,temp_c,power_w,sm_mhz,upscaling\n")
            while not self.stop.is_set():
                try:
                    out = subprocess.run(["nvidia-smi", f"--query-gpu={self.FIELDS}", "--format=csv,noheader,nounits"],
                                         capture_output=True, text=True, timeout=10).stdout.strip().splitlines()[0]
                    v = [float(x) for x in out.split(",")]
                    self.last = {"util_pct": v[0], "mem_mib": v[1], "mem_total_mib": v[2], "temp_c": v[3],
                                 "power_w": v[4], "sm_mhz": v[5]}
                    up = self.active.is_set()
                    f.write(f"{now()},{','.join(f'{x:g}' for x in v)},{int(up)}\n")
                    f.flush()
                    if up:
                        self.n += 1
                        self.sum_util += v[0]
                        self.sum_pow += v[4]
                        self.max_mem = max(self.max_mem, v[1])
                        self.max_temp = max(self.max_temp, v[3])
                except Exception:
                    pass
                self.stop.wait(self.every)

    def summary(self) -> dict | None:
        if not self.ok:
            return None
        s = {"last": self.last}
        if self.n:
            s.update(util_avg_pct=round(self.sum_util / self.n), power_avg_w=round(self.sum_pow / self.n),
                     mem_max_mib=int(self.max_mem), temp_max_c=int(self.max_temp), samples=self.n)
        return s


# ---------------------------------------------------------------- helpers

def probe(path: str) -> dict:
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                          "stream=width,height,r_frame_rate:format=duration", "-of", "json", path],
                         capture_output=True, text=True, check=True).stdout
    j = json.loads(out)
    st = j["streams"][0]
    num, den = st["r_frame_rate"].split("/")
    return {"width": int(st["width"]), "height": int(st["height"]), "fps_str": st["r_frame_rate"],
            "fps": int(num) / int(den), "duration": float(j["format"]["duration"])}


def absp(p: str) -> Path:
    return Path(os.path.abspath(os.path.expanduser(p)))


def free_gb(path: Path) -> float:
    return shutil.disk_usage(str(path)).free / 1e9


def find_realesrgan(arg: str | None) -> Path:
    cands = [arg, os.environ.get("SESH_REALESRGAN")]
    for c in cands:
        if not c:
            continue
        p = Path(c).expanduser()
        if p.is_dir():
            for name in ("realesrgan-ncnn-vulkan.exe", "realesrgan-ncnn-vulkan"):
                if (p / name).exists():
                    return p / name
        elif p.exists():
            return p
    w = shutil.which("realesrgan-ncnn-vulkan")
    if w:
        return Path(w)
    sys.exit("error: realesrgan-ncnn-vulkan not found (use --realesrgan PATH or set SESH_REALESRGAN)")


def link_or_copy(src: Path, dst: Path) -> None:
    try:
        os.link(src, dst)
    except OSError:
        shutil.copy2(src, dst)


def fmt_dur(s: float) -> str:
    s = int(max(0, s))
    return f"{s // 3600}h{s % 3600 // 60:02d}m" if s >= 3600 else f"{s // 60}m{s % 60:02d}s"


# ---------------------------------------------------------------- preview

def write_preview(job: Job) -> Path | None:
    """Concat the finished chunks from the start (stop at the first gap) + the matching audio."""
    st = job.status["settings"]
    cdir = job.work / "chunks"
    n_done = 0
    while (cdir / f"{n_done:04d}.done").exists():
        n_done += 1
    if not n_done:
        job.log("preview: no finished chunks yet")
        return None
    inp, out = Path(st["input"]), Path(st["output"])
    fps_str = probe(str(inp))["fps_str"]
    num, den = fps_str.split("/")
    total = job.status.get("total_frames") or 0
    frames = min(n_done * st["chunk"], total) if total else n_done * st["chunk"]
    dur = frames * int(den) / int(num)
    lst = job.work / "preview.txt"
    lst.write_text("".join(f"file '{(cdir / f'{i:04d}.mp4').as_posix()}'\n" for i in range(n_done)))
    trim = ["-ss", f"{st['start']:.3f}"] if st.get("start") is not None else []
    prev = out.with_name(out.stem + ".preview.mp4")
    tmp = out.with_name(out.stem + ".preview.partial.mp4")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", str(lst), *trim, "-t", f"{dur:.3f}",
                    "-i", str(inp), "-map", "0:v", "-map", "1:a?", "-c", "copy", "-shortest", "-movflags", "+faststart",
                    str(tmp)], check=True)
    os.replace(tmp, prev)
    job.save(preview={"path": str(prev), "chunks": n_done, "frames": frames, "duration": fmt_dur(dur)})
    job.log(f"preview: {prev} ({n_done} chunks, {fmt_dur(dur)})")
    return prev


# ---------------------------------------------------------------- status printer

def print_status(work: Path) -> int:
    p = work / "status.json"
    if not p.exists():
        print(f"no status.json in {work}")
        return 1
    s = json.loads(p.read_text())
    print(json.dumps(s, indent=1))
    log = work / "upscale.log"
    if log.exists():
        print("--- last log lines ---")
        print("\n".join(log.read_text(encoding="utf-8").splitlines()[-8:]))
    return 0


# ---------------------------------------------------------------- main job

def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="sesh-upscale", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("input", nargs="?", help="input video (the clean cut: no burned-in captions)")
    ap.add_argument("-o", "--output", help="output mp4 (default: <input stem>.<height>p.mp4)")
    ap.add_argument("--work", help="work dir (default: <output>.upscale-work); re-run with the same dir to resume")
    ap.add_argument("--status", metavar="WORK", help="print status of a job and exit")
    ap.add_argument("--preview", metavar="WORK", help="write <output>.preview.mp4 from the chunks finished so far "
                    "(safe while the job runs) and exit")
    ap.add_argument("--stop-after", type=float, metavar="S",
                    help="pause once the first S seconds are done (writes the preview); re-run without it to continue")
    ap.add_argument("--method", choices=["x4plus", "lanczos"], default="x4plus")
    ap.add_argument("--model", default="realesrgan-x4plus", help="ncnn model name (default realesrgan-x4plus)")
    ap.add_argument("--height", type=int, default=1080, help="output height; width keeps the aspect ratio (default 1080)")
    ap.add_argument("--realesrgan", help="path to realesrgan-ncnn-vulkan(.exe) or its folder (models/ beside it)")
    ap.add_argument("--gpu", default="auto", help="ncnn -g gpu id (default auto)")
    ap.add_argument("--tile", type=int, default=0, help="ncnn -t tile size (0 = auto). RTX 3070: 512")
    ap.add_argument("--jobs", default="", help="ncnn -j load:proc:save (default: ncnn's). RTX 3070: 1:1:2")
    ap.add_argument("--chunk", type=int, default=1000, help="frames per chunk (default 1000, ~4 GB of 4x PNGs)")
    ap.add_argument("--start", type=float, help="only process from this input time (s), e.g. for a sample")
    ap.add_argument("--duration", type=float, help="only process this many seconds")
    ap.add_argument("--crf", type=int, default=16, help="x264 CRF (default 16)")
    ap.add_argument("--preset", default="slow", help="x264 preset (default slow)")
    ap.add_argument("--encoder", default="libx264",
                    help="video encoder (default libx264; h264_nvenc needs a driver matching the ffmpeg build)")
    ap.add_argument("--keep-frames", action="store_true", help="keep the extracted source frames when done")
    args = ap.parse_args(argv)

    if args.status:
        return print_status(absp(args.status))
    if args.preview:
        job = Job(absp(args.preview))
        if not job.status.get("settings"):
            sys.exit(f"no job in {args.preview}")
        return 0 if write_preview(job) else 1
    if not args.input:
        ap.error("input is required (or --status WORK)")

    inp = absp(args.input)
    out = absp(args.output) if args.output else inp.with_name(f"{inp.stem}.{args.height}p.mp4")
    work = absp(args.work) if args.work else out.with_name(out.stem + ".upscale-work")
    work.mkdir(parents=True, exist_ok=True)
    job = Job(work)
    info = probe(str(inp))
    H = args.height
    W = int(round(info["width"] * H / info["height"] / 2)) * 2
    settings = {"input": str(inp), "output": str(out), "method": args.method, "model": args.model,
                "size": f"{W}x{H}", "tile": args.tile, "jobs": args.jobs, "gpu": args.gpu, "chunk": args.chunk,
                "start": args.start, "duration": args.duration, "crf": args.crf, "preset": args.preset,
                "encoder": args.encoder}
    prev = job.status.get("settings")
    if prev and {k: prev.get(k) for k in ("input", "method", "model", "size", "chunk", "start", "duration")} != \
            {k: settings[k] for k in ("input", "method", "model", "size", "chunk", "start", "duration")}:
        sys.exit(f"error: {work} holds a job with different settings ({prev}); use another --work dir")
    job.save(settings=settings, state="starting", pid=os.getpid(), error=None)
    job.log(f"start: {inp.name} {info['width']}x{info['height']} @{info['fps_str']} -> {W}x{H} via {args.method} "
            f"(tile={args.tile or 'auto'} jobs={args.jobs or 'default'} chunk={args.chunk})")

    gpu = GpuSampler(job)
    gpu.start()
    try:
        return run(job, gpu, args, inp, out, work, info, W, H)
    except KeyboardInterrupt:
        job.save(state="interrupted")
        job.log("interrupted; re-run the same command to resume")
        return 130
    except Exception as e:  # noqa: BLE001
        job.save(state="failed", error=str(e))
        job.log(f"FAILED: {e}")
        return 1
    finally:
        gpu.stop.set()


def run(job: Job, gpu: GpuSampler, args, inp: Path, out: Path, work: Path, info: dict, W: int, H: int) -> int:
    trim = []
    if args.start is not None:
        trim += ["-ss", f"{args.start:.3f}"]
    if args.duration is not None:
        trim += ["-t", f"{args.duration:.3f}"]

    enc = ["-c:v", args.encoder]
    enc += ["-preset", args.preset, "-crf", str(args.crf)] if args.encoder == "libx264" else \
           ["-preset", "p7", "-tune", "hq", "-rc", "vbr", "-cq", str(args.crf), "-b:v", "0"]

    if args.method == "lanczos":  # no frames on disk: one ffmpeg pass (minutes, not hours)
        job.save(state="encoding")
        tmp = out.with_name(out.stem + ".partial.mp4")
        subprocess.run(["ffmpeg", "-v", "error", "-y", *trim, "-i", str(inp), "-map", "0:v", "-map", "0:a?",
                        "-vf", f"scale={W}:{H}:flags=lanczos,format=yuv420p", *enc, "-c:a", "copy",
                        "-movflags", "+faststart", str(tmp)], check=True)
        os.replace(tmp, out)
        o = probe(str(out))
        job.save(state="done", pct=100.0, result={"output": str(out), "size": f"{o['width']}x{o['height']}",
                                                  "duration_s": round(o["duration"], 3)})
        job.log(f"done: {out} ({o['width']}x{o['height']}, {o['duration']:.1f}s)")
        return 0

    # ---- 1. extract all source frames once
    frames = work / "frames"
    marker = frames / ".complete"
    if not marker.exists():
        job.save(state="extracting")
        job.log("extracting source frames")
        if frames.exists():
            shutil.rmtree(frames)
        frames.mkdir()
        subprocess.run(["ffmpeg", "-v", "error", "-y", *trim, "-i", str(inp), "-an", "-fps_mode", "passthrough",
                        "-start_number", "1", str(frames / "%06d.png")], check=True)
        n = len(list(frames.glob("*.png")))
        marker.write_text(str(n))
    total = int(marker.read_text())
    chunks = [(a, min(a + args.chunk, total + 1)) for a in range(1, total + 1, args.chunk)]  # [first, end)
    job.log(f"{total} frames in {len(chunks)} chunks")

    cdir = work / "chunks"
    cdir.mkdir(exist_ok=True)
    done_frames = sum(b - a for i, (a, b) in enumerate(chunks) if (cdir / f"{i:04d}.done").exists())
    job.save(state="upscaling", total_frames=total, chunks_total=len(chunks), done_frames=done_frames)
    rate_hist: list[tuple[float, int]] = []  # (time, frames done) for a rolling s/frame

    def progress(done: int, chunk_i: int) -> None:
        t = time.time()
        rate_hist.append((t, done))
        while len(rate_hist) > 2 and t - rate_hist[0][0] > 300:
            rate_hist.pop(0)
        spf = None
        if len(rate_hist) >= 2 and rate_hist[-1][1] > rate_hist[0][1]:
            spf = (rate_hist[-1][0] - rate_hist[0][0]) / (rate_hist[-1][1] - rate_hist[0][1])
        job.save(done_frames=done, chunk=chunk_i, pct=round(100 * done / total, 1),
                 s_per_frame=round(spf, 3) if spf else None,
                 eta=fmt_dur((total - done) * spf) if spf else None, gpu=gpu.summary(),
                 disk_free_gb=round(free_gb(work), 1))

    esr = find_realesrgan(args.realesrgan)
    stop_frame = int(round(args.stop_after * info["fps"])) if args.stop_after else None
    if stop_frame and stop_frame % args.chunk:
        job.log(f"note: --stop-after {args.stop_after}s = frame {stop_frame}, not a multiple of --chunk {args.chunk}; "
                f"stopping at the end of the chunk that reaches it")
    for i, (a, b) in enumerate(chunks):
        done_p, mp4 = cdir / f"{i:04d}.done", cdir / f"{i:04d}.mp4"
        if stop_frame is not None and a > stop_frame:
            prev = write_preview(job)
            job.save(state="paused", eta=None, gpu=gpu.summary())
            job.log(f"paused after {fmt_dur((a - 1) / info['fps'])} (--stop-after); preview: {prev}. "
                    f"Re-run without --stop-after to continue")
            return 0
        if done_p.exists():
            continue
        n = b - a
        need = n * PNG_4X_MB / 1000 + 2
        if free_gb(work) < need:
            raise RuntimeError(f"only {free_gb(work):.1f} GB free, chunk needs ~{need:.0f} GB")
        cin, cup = work / f"in_{i:04d}", work / f"up_{i:04d}"
        cup.mkdir(exist_ok=True)
        # resume inside a chunk: drop the newest 4x file (may be half-written), skip the rest
        ups = sorted(cup.glob("*.png"), key=lambda p: p.stat().st_mtime)
        if ups:
            ups[-1].unlink()
        have = {p.name for p in cup.glob("*.png")}
        if cin.exists():
            shutil.rmtree(cin)
        cin.mkdir()
        todo = [f"{k:06d}.png" for k in range(a, b) if f"{k:06d}.png" not in have]
        for name in todo:
            link_or_copy(frames / name, cin / name)
        job.log(f"chunk {i + 1}/{len(chunks)}: frames {a}-{b - 1}, {len(todo)} to upscale")
        if todo:
            cmd = [str(esr), "-i", str(cin), "-o", str(cup), "-n", args.model, "-m", str(esr.parent / "models"),
                   "-f", "png", "-s", "4"]
            if args.gpu != "auto":
                cmd += ["-g", args.gpu]
            if args.tile:
                cmd += ["-t", str(args.tile)]
            if args.jobs:
                cmd += ["-j", args.jobs]
            elog = work / "logs"
            elog.mkdir(exist_ok=True)
            lp = elog / f"esrgan_{i:04d}.log"
            gpu.active.set()
            with open(lp, "w", encoding="utf-8") as lf:
                proc = subprocess.Popen(cmd, stdout=lf, stderr=subprocess.STDOUT)
                while proc.poll() is None:
                    time.sleep(5)
                    progress(done_frames + len(list(cup.glob("*.png"))), i + 1)
            gpu.active.clear()
            txt = lp.read_text(encoding="utf-8", errors="replace")
            if i == 0 or not job.status.get("gpu_name"):
                names = sorted({ln.split("]")[0].strip("[") for ln in txt.splitlines() if ln.startswith("[")})
                job.save(gpu_name=names)
                job.log(f"ncnn devices: {names}")
            bad = [ln for ln in txt.splitlines() if "fail" in ln.lower() or "error" in ln.lower()]
            got = len(list(cup.glob("*.png")))
            if proc.returncode != 0 or bad or got != n:
                raise RuntimeError(f"chunk {i}: realesrgan exit {proc.returncode}, {got}/{n} frames, "
                                   f"errors: {bad[:3]} (see {lp}); for out-of-memory try a smaller --tile")
        shutil.rmtree(cin)

        # ---- encode the chunk at the target size
        job.save(state="encoding", chunk=i + 1)
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-framerate", info["fps_str"], "-start_number", str(a),
                        "-i", str(cup / "%06d.png"), "-frames:v", str(n),
                        "-vf", f"scale={W}:{H}:flags=lanczos,format=yuv420p", *enc, str(mp4)], check=True)
        shutil.rmtree(cup)
        done_p.write_text(now())
        done_frames += n
        job.save(state="upscaling")
        progress(done_frames, i + 1)

    # ---- concat + audio
    job.save(state="muxing")
    lst = work / "chunks.txt"
    lst.write_text("".join(f"file '{(cdir / f'{i:04d}.mp4').as_posix()}'\n" for i in range(len(chunks))))
    tmp = out.with_name(out.stem + ".partial.mp4")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", str(lst), *trim, "-i", str(inp),
                    "-map", "0:v", "-map", "1:a?", "-c", "copy", "-shortest", "-movflags", "+faststart", str(tmp)],
                   check=True)
    os.replace(tmp, out)
    if not args.keep_frames:
        shutil.rmtree(frames)
    o = probe(str(out))
    job.save(state="done", done_frames=total, pct=100.0, gpu=gpu.summary(), eta=None,
             result={"output": str(out), "size": f"{o['width']}x{o['height']}", "duration_s": round(o["duration"], 3)})
    job.log(f"done: {out} ({o['width']}x{o['height']}, {o['duration']:.1f}s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
