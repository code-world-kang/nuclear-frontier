#!/usr/bin/env python3
"""将经过验证的数据复制到 GitHub Pages 发布目录。"""

from __future__ import annotations

import json
import shutil
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
CONFIG = ROOT / "config"
PUBLIC_DATA = ROOT / "site" / "data"


def load(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> None:
    PUBLIC_DATA.mkdir(parents=True, exist_ok=True)
    for name in ("papers.json", "news.json", "notices.json", "featured.json", "status.json"):
        shutil.copy2(DATA / name, PUBLIC_DATA / name)
    favorites = DATA / "personal" / "favorites.json"
    shutil.copy2(favorites, PUBLIC_DATA / "public-favorites.json")

    topics = load(CONFIG / "topics.json")
    runtime = load(CONFIG / "runtime.json")
    status = load(DATA / "status.json")
    meta = {
        "site": runtime,
        "categories": topics["categories"],
        "status": status,
        "notice": "本站汇总官方公开元数据，不代表数据源机构背书。请以原始页面为准。",
    }
    (PUBLIC_DATA / "meta.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    (ROOT / "site" / ".nojekyll").touch()
    print(f"站点数据已构建：{PUBLIC_DATA}")


if __name__ == "__main__":
    main()
