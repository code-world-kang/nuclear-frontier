#!/usr/bin/env python3
"""下载固定版本的开放模型和官方推理程序，校验 SHA-256；不安装系统服务。"""
from __future__ import annotations

import hashlib
import json
import os
import platform
import tarfile
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CACHE = Path(os.getenv("TRANSLATION_MODEL_DIR", ROOT / "output/llama-model"))
REVISION = "a06e946bb6b655725eafa393f4a9745d460374c9"
MODEL_URL = f"https://huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF/resolve/{REVISION}/Qwen3-4B-Instruct-2507-Q4_K_M.gguf"
MODEL_SHA256 = "3605803b982cb64aead44f6c1b2ae36e3acdb41d8e46c8a94c6533bc4c67e597"
RELEASE = "b10516"
RUNTIMES = {
    ("Linux", "x86_64"): ("ubuntu-x64", "f263a91280471b4c33c4999d7c76259c0f3a0a53a0b3e692b2c0b84380137a35"),
    ("Darwin", "arm64"): ("macos-arm64", "ee3324327d621026ae80c24031670e65fa62a0b23a3a027dbe2f65f240affd30"),
}


def sha256(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def download(url: str, path: Path, digest: str, maximum: int) -> None:
    if path.exists() and sha256(path) == digest:
        return
    temporary = path.with_suffix(".download")
    try:
        request = urllib.request.Request(url, headers={"User-Agent": "nuclear-frontier/1.0"})
        for attempt in range(3):
            try:
                started = time.monotonic()
                with urllib.request.urlopen(request, timeout=90) as response, temporary.open("wb") as output:
                    size = 0
                    while chunk := response.read(1024 * 1024):
                        size += len(chunk)
                        if size > maximum:
                            raise ValueError("下载大小超过预期")
                        if time.monotonic() - started > 900:
                            raise TimeoutError("模型下载超过 15 分钟预算")
                        output.write(chunk)
                break
            except OSError:
                if attempt == 2:
                    raise
                time.sleep(2 ** attempt)
        if sha256(temporary) != digest:
            raise ValueError("下载文件校验失败，拒绝运行")
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def setup() -> Path:
    CACHE.mkdir(parents=True, exist_ok=True)
    system = (platform.system(), platform.machine())
    if system not in RUNTIMES:
        raise ValueError("当前平台未配置可信运行程序")
    name, digest = RUNTIMES[system]
    archive = CACHE / f"llama-{RELEASE}-{name}.tar.gz"
    download(f"https://github.com/ggml-org/llama.cpp/releases/download/{RELEASE}/llama-{RELEASE}-bin-{name}.tar.gz", archive, digest, 80 * 1024**2)
    runtime = CACHE / "runtime"
    runtime.mkdir(exist_ok=True)
    with tarfile.open(archive, "r:gz") as package:
        package.extractall(runtime, filter="data")
    binaries = list(runtime.rglob("llama-server"))
    if len(binaries) != 1:
        raise ValueError("推理程序归档结构异常")
    download(MODEL_URL, CACHE / "qwen.gguf", MODEL_SHA256, 2600 * 1024**2)
    print("开放翻译模型与运行程序已验证。", flush=True)
    return binaries[0]


if __name__ == "__main__":
    setup()
