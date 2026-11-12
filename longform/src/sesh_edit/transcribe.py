"""Verbatim transcription (keeps fillers) + CTC forced alignment for word timings.

Step A: CrisperWhisper (a Whisper large-v3 fine-tune trained to transcribe
verbatim: it emits fillers as [UH]/[UM] instead of dropping them). Runs on MPS.
Its word timestamps under stock `transformers` are contiguous (no gaps), so:

Step B: wav2vec2 CTC forced alignment (Viterbi over the character trellis,
same algorithm as torchaudio's tutorial / WhisperX) gives each word a real
start/end with true pauses between words, at 20ms resolution.
"""
from __future__ import annotations

import re
import time

import numpy as np

ASR_MODEL = "nyrahealth/CrisperWhisper"
ALIGN_MODEL = "facebook/wav2vec2-base-960h"
SR = 16000


def _device():
    import torch

    return "mps" if torch.backends.mps.is_available() else "cpu"


def split_chunks(audio: np.ndarray, max_s: float = 28.0, min_s: float = 8.0) -> list[tuple[int, int]]:
    """Split at the quietest 100ms point between min_s and max_s into each chunk."""
    hop = SR // 100
    n = len(audio) // hop
    rms = np.sqrt(np.mean(audio[: n * hop].reshape(n, hop) ** 2, axis=1) + 1e-12)
    # smooth over 100ms
    rms = np.convolve(rms, np.ones(10) / 10, mode="same")
    chunks, s = [], 0
    while s < n:
        if n - s <= max_s * 100:
            chunks.append((s * hop, len(audio)))
            break
        lo, hi = s + int(min_s * 100), s + int(max_s * 100)
        cut = lo + int(np.argmin(rms[lo:hi]))
        chunks.append((s * hop, cut * hop))
        s = cut
    return chunks


def _looping(text: str) -> bool:
    """Whisper's compression-ratio heuristic + long identical-word runs."""
    import zlib

    if not text:
        return False
    b = text.encode()
    if len(b) > 60 and len(b) / len(zlib.compress(b)) > 2.4:
        return True
    toks = re.findall(r"[a-z']+", text.lower())
    run = 1
    for i in range(1, len(toks)):
        run = run + 1 if toks[i] == toks[i - 1] else 1
        if run >= 8:
            return True
    return False


def _collapse_repeats(text: str, keep: int = 3) -> str:
    out, prev, run = [], None, 0
    for t in text.split():
        k = re.sub(r"[^a-z']", "", t.lower())
        run = run + 1 if k == prev else 1
        prev = k
        if run <= keep:
            out.append(t)
    return " ".join(out)


def asr(audio: np.ndarray, log=print) -> list[dict]:
    """Return [{start, end, text}] per chunk from CrisperWhisper (text only)."""
    import torch
    from transformers import AutoModelForSpeechSeq2Seq, AutoProcessor

    dev = _device()
    dtype = torch.float16 if dev == "mps" else torch.float32
    model = AutoModelForSpeechSeq2Seq.from_pretrained(ASR_MODEL, torch_dtype=dtype, low_cpu_mem_usage=True).to(dev).eval()
    proc = AutoProcessor.from_pretrained(ASR_MODEL)
    chunks = split_chunks(audio)

    def gen(segs, beams=1):
        feats = proc(segs, sampling_rate=SR, return_tensors="pt").input_features.to(dev, dtype)
        with torch.inference_mode():
            ids = model.generate(feats, language="en", task="transcribe", num_beams=beams, max_new_tokens=440)
        return [t.strip() for t in proc.batch_decode(ids, skip_special_tokens=True)]

    def robust(seg, s0, depth=0):
        """Re-decode a looping chunk with beam search; if still looping, split it in half."""
        txt = gen([seg], beams=5)[0]
        if not _looping(txt) or depth >= 2 or len(seg) < SR * 4:
            if _looping(txt):
                log(f"    asr: chunk @{s0 / SR:.1f}s still looks like a hallucination loop; dropping repeats")
                txt = _collapse_repeats(txt)
            return [(s0, s0 + len(seg), txt)]
        sub = split_chunks(seg, max_s=len(seg) / SR / 2 + 2, min_s=len(seg) / SR / 2 - 4)
        res = []
        for a, b in sub:
            res += robust(seg[a:b], s0 + a, depth + 1)
        return res

    out = []
    bs = 4
    t0 = time.time()
    retried = 0
    for b in range(0, len(chunks), bs):
        batch = chunks[b : b + bs]
        segs = [audio[s:e] for s, e in batch]
        texts = gen(segs)
        for (s, e), txt, seg in zip(batch, texts, segs):
            if np.sqrt(np.mean(seg**2)) < 1e-4:  # digital silence -> drop hallucinations
                out.append({"start": s / SR, "end": e / SR, "text": ""})
                continue
            if _looping(txt):
                retried += 1
                for a, z, t in robust(seg, s):
                    out.append({"start": a / SR, "end": z / SR, "text": t})
            else:
                out.append({"start": s / SR, "end": e / SR, "text": txt})
        done = batch[-1][1] / SR
        log(f"    asr {done / 60:5.1f}/{len(audio) / SR / 60:.1f} min  ({time.time() - t0:.0f}s)")
    if retried:
        log(f"    asr: {retried} chunk(s) re-decoded after loop detection")
    del model
    if dev == "mps":
        torch.mps.empty_cache()
    return out


# ---------------------------------------------------------------- alignment

def _spell_numbers(word: str) -> str:
    from num2words import num2words

    def rep(m):
        n = int(m.group(0))
        try:
            return " " + num2words(n, to="year" if 1100 <= n <= 2099 and len(m.group(0)) == 4 else "cardinal") + " "
        except Exception:
            return m.group(0)

    return re.sub(r"\d+", rep, word.replace(",", "") if re.search(r"\d,\d", word) else word)


def _norm_chars(word: str) -> str:
    w = _spell_numbers(word).upper().replace("[UH]", "UH").replace("[UM]", "UM")
    return re.sub(r"[^A-Z']", "", w)


def _viterbi(emission: np.ndarray, tokens: list[int], blank: int = 0):
    """Return list of (token_index, frame) path. emission: (T, C) log-probs."""
    T, N = emission.shape[0], len(tokens)
    trellis = np.full((T + 1, N + 1), -np.inf, dtype=np.float32)
    trellis[0, 0] = 0
    trellis[1:, 0] = np.cumsum(emission[:, blank])
    tok = np.array(tokens)
    for t in range(T):
        stay = trellis[t, 1:] + emission[t, blank]
        change = trellis[t, :-1] + emission[t, tok]
        trellis[t + 1, 1:] = np.maximum(stay, change)
    # backtrack
    t, j = T, N
    if not np.isfinite(trellis[T, N]):
        return None
    path = []
    while j > 0 and t > 0:
        stay = trellis[t - 1, j] + emission[t - 1, blank]
        change = trellis[t - 1, j - 1] + emission[t - 1, tokens[j - 1]]
        if change >= stay:
            path.append((j - 1, t - 1))
            j -= 1
        t -= 1
    if j > 0:
        return None
    return path[::-1]  # one (token, frame) per token: frame where token emitted first


def _split_words(text: str) -> list[str]:
    # CrisperWhisper writes fillers as [UH]/[UM]; make sure they are separate tokens.
    text = re.sub(r"(\[[A-Z]+\])", r" \1 ", text)
    return [t for t in text.split() if t]


def align(audio: np.ndarray, chunks: list[dict], log=print) -> list[dict]:
    """Force-align each chunk's text to its audio. Returns words with start/end."""
    import torch
    from transformers import Wav2Vec2ForCTC, Wav2Vec2Processor

    dev = _device()
    proc = Wav2Vec2Processor.from_pretrained(ALIGN_MODEL)
    model = Wav2Vec2ForCTC.from_pretrained(ALIGN_MODEL).to(dev).eval()
    vocab = proc.tokenizer.get_vocab()
    blank = vocab["<pad>"]
    frame_s = 0.02
    words: list[dict] = []
    failed = 0
    for ch in chunks:
        toks_words = _split_words(ch["text"])
        if not toks_words:
            continue
        seg = audio[int(ch["start"] * SR) : int(ch["end"] * SR)]
        with torch.inference_mode():
            x = torch.from_numpy(seg).float()[None].to(dev)
            x = (x - x.mean()) / (x.std() + 1e-7)
            em = torch.log_softmax(model(x).logits[0].float(), dim=-1).cpu().numpy()
        toks, owner = [], []
        for k, wd in enumerate(toks_words):
            for c in _norm_chars(wd):
                if c in vocab:
                    toks.append(vocab[c])
                    owner.append(k)
        path = _viterbi(em, toks, blank) if toks and len(toks) <= em.shape[0] else None
        cw = [{"word": wd, "start": None, "end": None, "aligned": False} for wd in toks_words]
        if path is None:
            failed += 1
            # spread words evenly over the chunk as a fallback
            dur = ch["end"] - ch["start"]
            for k, w in enumerate(cw):
                w["start"] = ch["start"] + dur * k / len(cw)
                w["end"] = ch["start"] + dur * (k + 1) / len(cw)
        else:
            first: dict[int, int] = {}
            last: dict[int, tuple[int, int]] = {}
            for ti, fr in path:
                k = owner[ti]
                first.setdefault(k, fr)
                last[k] = (fr, toks[ti])
            for k in first:
                f_end, tok = last[k]
                # CTC is peaky: extend through following frames still dominated by that char
                while f_end + 1 < em.shape[0] and int(np.argmax(em[f_end + 1])) == tok:
                    f_end += 1
                cw[k]["start"] = ch["start"] + first[k] * frame_s
                cw[k]["end"] = ch["start"] + (f_end + 1) * frame_s
                cw[k]["aligned"] = True
            # words with no alignable chars (digits, symbols): squeeze between neighbours
            for k, w in enumerate(cw):
                if w["start"] is None:
                    prev_e = cw[k - 1]["end"] if k and cw[k - 1]["end"] is not None else ch["start"]
                    nxt = next((cw[m]["start"] for m in range(k + 1, len(cw)) if cw[m]["start"] is not None), prev_e)
                    w["start"], w["end"] = prev_e, max(prev_e, nxt)
        words.extend(cw)
    for k in range(1, len(words)):
        if words[k]["start"] < words[k - 1]["end"]:
            words[k]["start"] = words[k - 1]["end"]
            words[k]["end"] = max(words[k]["end"], words[k]["start"])
    if failed:
        log(f"    align: {failed} chunk(s) failed to align (even-spread fallback)")
    del model
    return words


def transcribe(audio: np.ndarray, log=print) -> list[dict]:
    t0 = time.time()
    chunks = asr(audio, log)
    log(f"    asr done: {len(chunks)} chunks in {time.time() - t0:.0f}s; aligning…")
    t1 = time.time()
    words = align(audio, chunks, log)
    log(f"    align done: {len(words)} words in {time.time() - t1:.0f}s")
    for w in words:
        w["start"] = round(w["start"], 3)
        w["end"] = round(w["end"], 3)
    return words
