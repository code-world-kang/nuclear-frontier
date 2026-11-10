"""Append-only public translation batches; canonical translations remain the baseline."""
import hashlib
import json
import re
from pathlib import Path

MANIFEST = "data/translation-feed/manifest.json"


def batch_path(digest):
    if not re.fullmatch(r"[0-9a-f]{64}", digest):
        raise ValueError("Invalid translation batch digest")
    return f"data/translation-feed/batches/{digest}.json"


def apply_batch(payload, batch):
    items = payload.setdefault("items", {})
    for key, value in batch["items"].items():
        current = items.get(key)
        # Preserve subsequent manual edits and already incorporated batches.
        if current == value or current != batch["previous"].get(key):
            continue
        if current and current.get("source_hash") and current["source_hash"] != value.get("source_hash"):
            payload.setdefault("versions", {}).setdefault(key, {})[current["source_hash"]] = current
        items[key] = value
    return payload


def load_translations(data):
    data = Path(data)
    payload = json.loads((data / "translations.zh-CN.json").read_text())
    manifest = data / "translation-feed/manifest.json"
    if manifest.exists():
        for digest in json.loads(manifest.read_text())["batches"]:
            raw = (data.parent / batch_path(digest)).read_bytes()
            if hashlib.sha256(raw).hexdigest() != digest:
                raise ValueError("Translation batch checksum mismatch")
            apply_batch(payload, json.loads(raw))
    return payload
