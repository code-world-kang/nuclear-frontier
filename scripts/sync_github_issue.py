#!/usr/bin/env python3
"""Validate a repository-owner Issue and publish its personal-data snapshot."""

from __future__ import annotations

import argparse
import base64
import gzip
import json
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / "data" / "personal" / "state.json"
MARKER = "<!-- nuclear-frontier-personal-state:v1 -->"
TITLE_PREFIX = "[个人数据同步]"

PERSONAL_OBJECT_FIELDS = (
    "favorites", "readStatus", "notes", "translationFavorites",
)
PERSONAL_LIST_FIELDS = (
    "keywords", "translationGlossary", "codeItems", "resources", "hiddenPublicFavorites", "ignoredItems",
)
LAYOUT_LIST_FIELDS = ("categoryOrder", "hiddenCategories", "moduleOrder")


def clean_state(payload: Any) -> dict[str, Any]:
    """Keep only the public schema understood by the website."""
    if not isinstance(payload, dict):
        raise ValueError("个人数据必须是 JSON 对象")
    personal_raw = payload.get("personal")
    layout_raw = payload.get("paperLayout")
    if not isinstance(personal_raw, dict):
        personal_raw = {}
    if not isinstance(layout_raw, dict):
        layout_raw = {}
    personal: dict[str, Any] = {
        key: value if isinstance((value := personal_raw.get(key)), dict) else {}
        for key in PERSONAL_OBJECT_FIELDS
    }
    personal.update({
        key: value if isinstance((value := personal_raw.get(key)), list) else []
        for key in PERSONAL_LIST_FIELDS
    })
    layout = {
        key: [str(value) for value in values]
        for key in LAYOUT_LIST_FIELDS
        if isinstance((values := layout_raw.get(key)), list)
    }
    google = payload.get("googleTranslations")
    if not isinstance(google, dict):
        google = {}
    return {
        "version": 1,
        "updated_at": str(payload.get("updated_at") or ""),
        "personal": personal,
        "paperLayout": layout,
        "googleTranslations": google,
    }


def extract_state(body: str) -> dict[str, Any]:
    """Extract and decode the single fenced snapshot following the version marker."""
    if MARKER not in body:
        raise ValueError("同步 Issue 缺少版本标记")
    marked = body.split(MARKER, 1)[1]
    encoding_prefix = "<!-- nuclear-frontier-encoding:"
    encoding_start = marked.find(encoding_prefix)
    if encoding_start < 0:
        raise ValueError("同步 Issue 缺少编码标记")
    encoding_end = marked.find(" -->", encoding_start)
    if encoding_end < 0:
        raise ValueError("同步 Issue 编码标记未闭合")
    encoding = marked[encoding_start + len(encoding_prefix):encoding_end].strip()
    fence_start = marked.find("```text", encoding_end)
    if fence_start < 0:
        raise ValueError("同步 Issue 缺少数据代码块")
    data_start = fence_start + len("```text")
    fence_end = marked.find("```", data_start)
    if fence_end < 0:
        raise ValueError("同步 Issue 的数据代码块未闭合")
    raw = base64.b64decode(marked[data_start:fence_end].strip(), validate=True)
    if encoding == "gzip-base64":
        raw = gzip.decompress(raw)
    elif encoding != "base64":
        raise ValueError(f"不支持的同步编码：{encoding}")
    return clean_state(json.loads(raw.decode("utf-8")))


def state_from_event(event: dict[str, Any], repository_owner: str) -> dict[str, Any]:
    issue = event.get("issue")
    if not isinstance(issue, dict):
        raise ValueError("事件中没有 Issue 数据")
    author = str((issue.get("user") or {}).get("login") or "")
    if author.casefold() != repository_owner.casefold():
        raise PermissionError("只允许仓库所有者提交个人数据")
    title = str(issue.get("title") or "")
    if not title.startswith(TITLE_PREFIX):
        raise ValueError("不是个人数据同步 Issue")
    return extract_state(str(issue.get("body") or ""))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--event", required=True, type=Path)
    parser.add_argument("--repository-owner", required=True)
    args = parser.parse_args()
    event = json.loads(args.event.read_text(encoding="utf-8"))
    cleaned = state_from_event(event, args.repository_owner)
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    TARGET.write_text(json.dumps(cleaned, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(
        "已验证 GitHub Issue 并更新公开个人数据："
        f"{len(cleaned['personal']['notes'])} 篇笔记，"
        f"{len(cleaned['personal']['favorites'])} 篇收藏。"
    )


if __name__ == "__main__":
    main()
