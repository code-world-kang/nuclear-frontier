#!/usr/bin/env python3
"""
从可选同步中转层拉取公开收藏快照。

未设置 FAVORITE_SYNC_EXPORT_URL 时安全跳过。同步端点后续部署时，
只需返回 JSON 数组；仓库密钥绝不进入浏览器。
"""

from __future__ import annotations

import json
import os
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / "data" / "personal" / "favorites.json"
FAVORITE_FIELDS = (
    "id", "doi", "arxiv_id", "title", "url", "categories", "tags", "keywords",
    "added_at",
)


def clean_favorites(payload: list[object]) -> list[object]:
    """仅保留公开收藏允许的字段，包括用户设定的关键词。"""
    cleaned: list[object] = []
    for item in payload:
        if isinstance(item, str):
            cleaned.append(item)
        elif isinstance(item, dict) and item.get("id"):
            cleaned.append({
                key: item.get(key) for key in FAVORITE_FIELDS
                if item.get(key) not in (None, "")
            })
    return cleaned


def main() -> None:
    url = os.environ.get("FAVORITE_SYNC_EXPORT_URL", "").strip()
    if not url:
        print("未配置收藏同步端点，跳过云端收藏拉取。")
        return
    headers = {"Accept": "application/json", "User-Agent": "NuclearFrontierPortal/1.0"}
    token = os.environ.get("FAVORITE_SYNC_READ_TOKEN", "").strip()
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=25) as response:
            payload = json.loads(response.read())
        if isinstance(payload, dict):
            payload = payload.get("favorites")
        if not isinstance(payload, list):
            raise ValueError("收藏同步端点必须返回数组或 {favorites: []}")
    except Exception as exc:  # noqa: BLE001 - 收藏同步不得阻断论文更新与整站发布
        print(f"警告：公开收藏同步失败，保留上次快照：{type(exc).__name__}")
        return
    cleaned = clean_favorites(payload)
    TARGET.write_text(json.dumps(cleaned, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"已同步 {len(cleaned)} 条公开收藏。")


if __name__ == "__main__":
    main()
