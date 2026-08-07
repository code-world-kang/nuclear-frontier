#!/usr/bin/env python3
"""将经过验证的数据复制到 GitHub Pages 发布目录。"""

from __future__ import annotations

import json
import shutil
from collections import Counter
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
    papers = load(DATA / "papers.json")
    latest_day = max((item.get("published", "")[:10] for item in papers), default="")
    latest_papers = [item for item in papers if item.get("published", "")[:10] == latest_day]
    source_counts = Counter(item.get("source", "未知来源") for item in papers)
    category_counts = Counter(category for item in papers for category in item.get("categories", []))
    daily_counts = Counter(item.get("published", "")[:10] for item in papers if item.get("published"))
    insights = {
        "latest_day": latest_day,
        "latest_count": len(latest_papers),
        "journal_count": sum(item.get("source_type") == "journal" for item in papers),
        "preprint_count": sum(item.get("source_type") == "preprint" for item in papers),
        "source_counts": [{"name": name, "count": count} for name, count in source_counts.most_common()],
        "category_counts": dict(category_counts),
        "daily_counts": [
            {"date": day, "count": count} for day, count in sorted(daily_counts.items(), reverse=True)[:30]
        ],
    }
    meta = {
        "site": runtime,
        "categories": topics["categories"],
        "status": status,
        "insights": insights,
        "notice": "本站汇总官方公开元数据，不代表数据源机构背书。请以原始页面为准。",
    }
    (PUBLIC_DATA / "meta.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    (ROOT / "site" / ".nojekyll").touch()
    print(f"站点数据已构建：{PUBLIC_DATA}")


if __name__ == "__main__":
    main()
