"""Small LLM calls through the `claude` CLI in headless mode (no API key needed).

Responses are cached in the work dir keyed by prompt (+ image bytes) hash.
"""
from __future__ import annotations

import hashlib
import json
import re
import subprocess
from pathlib import Path


def _extract_json(text: str):
    m = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.S)
    if m:
        return json.loads(m.group(1))
    i, j = text.find("{"), text.rfind("}")
    if i >= 0 and j > i:
        return json.loads(text[i : j + 1])
    raise ValueError(f"no JSON object in LLM reply: {text[:300]}")


def ask_json(prompt: str, cache_dir: Path, model: str = "sonnet", image: Path | None = None, timeout: int = 300) -> dict:
    h = hashlib.sha256((model + prompt).encode())
    if image:
        h.update(image.read_bytes())
    cache = cache_dir / f"llm_{h.hexdigest()[:16]}.json"
    if cache.exists():
        return json.loads(cache.read_text())
    cmd = ["claude", "-p", "--output-format", "json", "--model", model]
    cwd = None
    if image:
        # The CLI reads the image with its Read tool; scope it to the image's folder.
        cmd += ["--allowedTools", "Read", "--add-dir", str(image.parent)]
        cwd = str(image.parent)
        prompt = f"First, use the Read tool to view the image at {image.resolve()}.\n\n" + prompt
    p = subprocess.run(cmd, input=prompt, capture_output=True, text=True, timeout=timeout, cwd=cwd)
    if p.returncode != 0:
        raise RuntimeError(f"claude CLI failed ({p.returncode}): {p.stderr[-500:]} {p.stdout[-500:]}")
    env = json.loads(p.stdout)
    if env.get("is_error"):
        raise RuntimeError(f"claude CLI error: {env.get('result')}")
    data = _extract_json(env["result"])
    out = {"response": data, "raw": env["result"], "cost_usd": env.get("total_cost_usd")}
    cache.write_text(json.dumps(out, indent=1))
    return out
