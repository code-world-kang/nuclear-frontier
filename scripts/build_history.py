#!/usr/bin/env python3
"""生成按月论文分片、按年搜索索引和月度统计。"""

from __future__ import annotations

import json
import shutil
import unicodedata
from collections import Counter
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
PUBLIC = ROOT / "site" / "data" / "history"


def load(path: Path, default: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def write_compact(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    temporary.replace(path)


def record_key(item: dict[str, Any]) -> str:
    doi = str(item.get("doi", "")).lower().strip()
    return f"doi:{doi}" if doi else f"id:{item.get('id', '')}"


def all_history_records() -> list[dict[str, Any]]:
    values: dict[str, dict[str, Any]] = {}
    for item in load(DATA / "papers.json", []):
        if str(item.get("published", ""))[:4].isdigit() and int(str(item["published"])[:4]) >= 2001:
            values[record_key(item)] = item
    for path in sorted((DATA / "history" / "papers").glob("*/*.json")):
        for item in load(path, []):
            key = record_key(item)
            current = values.get(key)
            if not current or (not current.get("abstract") and item.get("abstract")):
                values[key] = item
    return list(values.values())


def search_text(item: dict[str, Any]) -> str:
    value = " ".join(str(part or "") for part in [
        item.get("title"), item.get("abstract"), item.get("summary"), item.get("source"), item.get("source_short"),
        item.get("doi"), item.get("arxiv_id"), " ".join(item.get("authors") or []),
        " ".join(item.get("tags") or []), " ".join(item.get("categories") or []),
    ])
    return " ".join(unicodedata.normalize("NFKC", value).casefold().split())


def consecutive_coverage(completed: set[str], start: str) -> str:
    year, month = (int(value) for value in start.split("-"))
    last = ""
    while True:
        key = f"{year:04d}-{month:02d}"
        if key not in completed:
            return last
        last = key
        year, month = (year + 1, 1) if month == 12 else (year, month + 1)


def build_history_site() -> dict[str, Any]:
    if PUBLIC.exists():
        shutil.rmtree(PUBLIC)
    records = all_history_records()
    by_month: dict[str, list[dict[str, Any]]] = {}
    for item in records:
        month = str(item.get("published", ""))[:7]
        if len(month) == 7 and month[4] == "-":
            by_month.setdefault(month, []).append(item)

    history_status = load(DATA / "history" / "status.json", {"months": {}, "configured_start": "2001-01"})
    completed = {
        month for month, value in history_status.get("months", {}).items()
        if value.get("complete")
    }
    year_summaries: dict[str, dict[str, Any]] = {}
    for month, items in sorted(by_month.items()):
        year, month_number = month.split("-")
        items.sort(key=lambda item: (item.get("published", ""), item.get("importance", 0), item.get("title", "")), reverse=True)
        write_compact(PUBLIC / "papers" / year / f"{month_number}.json", items)
        categories = Counter(category for item in items for category in item.get("categories", []))
        sources = Counter(item.get("source_short") or item.get("source") or "未知来源" for item in items)
        month_summary = {
            "month": month,
            "count": len(items),
            "nuclear_count": sum(any(category not in {"frontiers", "ai-science"} for category in item.get("categories", [])) for item in items),
            "journal_count": sum(item.get("source_type") == "journal" for item in items),
            "preprint_count": sum(item.get("source_type") == "preprint" for item in items),
            "abstract_count": sum(bool(item.get("abstract")) for item in items),
            "featured_count": sum(int(item.get("importance", 0)) >= 60 for item in items),
            "categories": dict(categories),
            "sources": dict(sources.most_common()),
            "backfill_complete": month in completed,
        }
        summary = year_summaries.setdefault(year, {"year": int(year), "count": 0, "months": []})
        summary["count"] += len(items)
        summary["months"].append(month_summary)

    yearly_search: dict[str, list[dict[str, Any]]] = {}
    for item in records:
        year = str(item.get("published", ""))[:4]
        month = str(item.get("published", ""))[:7]
        if not year.isdigit() or len(month) != 7:
            continue
        yearly_search.setdefault(year, []).append({
            "id": item.get("id", ""),
            "month": month,
            "published": item.get("published", ""),
            "title": item.get("title", ""),
            "source": item.get("source", ""),
            "source_short": item.get("source_short", ""),
            "categories": item.get("categories", []),
            "importance": item.get("importance", 0),
            "search_text": search_text(item),
        })
    for year, items in yearly_search.items():
        items.sort(key=lambda item: (item.get("published", ""), item.get("importance", 0)), reverse=True)
        write_compact(PUBLIC / "search" / f"{year}.json", {"year": int(year), "count": len(items), "items": items})
    for year, summary in year_summaries.items():
        write_compact(PUBLIC / "stats" / f"{year}.json", summary)

    months = sorted(by_month)
    configured_start = history_status.get("configured_start", "2001-01")
    manifest = {
        "version": 1,
        "start_month": configured_start,
        "earliest_indexed_month": months[0] if months else "",
        "latest_indexed_month": months[-1] if months else "",
        "backfill_complete_through": consecutive_coverage(completed, configured_start),
        "indexed_papers": len(records),
        "indexed_months": len(months),
        "completed_backfill_months": len(completed),
        "years": [
            {"year": int(year), "count": summary["count"], "months": len(summary["months"])}
            for year, summary in sorted(year_summaries.items())
        ],
    }
    write_compact(PUBLIC / "manifest.json", manifest)
    return manifest


def main() -> None:
    manifest = build_history_site()
    print(f"历史索引已构建：{manifest['indexed_papers']} 篇，{manifest['indexed_months']} 个月份")


if __name__ == "__main__":
    main()
