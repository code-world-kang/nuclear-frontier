#!/usr/bin/env python3
"""按月回填 2001 年以来的核心核物理期刊元数据。

每月独立落盘并记录进度，中断后可继续；不下载或镜像论文全文。
"""

from __future__ import annotations

import argparse
import concurrent.futures
import datetime as dt
import json
import sys
from pathlib import Path
from typing import Any, Iterable


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from update_content import (  # noqa: E402
    Classifier,
    enrich_missing_abstracts_from_openalex,
    fetch_crossref,
    merge_records,
    read_json,
    update_abstract_availability,
    write_json,
)


DATA = ROOT / "data" / "history"
PAPERS = DATA / "papers"
STATUS = DATA / "status.json"


def parse_month(value: str) -> tuple[int, int]:
    try:
        year_text, month_text = value.split("-", 1)
        year, month = int(year_text), int(month_text)
    except (ValueError, AttributeError) as exc:
        raise argparse.ArgumentTypeError("月份必须为 YYYY-MM") from exc
    if year < 1900 or not 1 <= month <= 12:
        raise argparse.ArgumentTypeError("月份必须为 YYYY-MM")
    return year, month


def month_key(value: tuple[int, int]) -> str:
    return f"{value[0]:04d}-{value[1]:02d}"


def next_month(value: tuple[int, int]) -> tuple[int, int]:
    year, month = value
    return (year + 1, 1) if month == 12 else (year, month + 1)


def month_range(start: tuple[int, int], end: tuple[int, int]) -> Iterable[tuple[int, int]]:
    current = start
    while current <= end:
        yield current
        current = next_month(current)


def month_bounds(value: tuple[int, int]) -> tuple[str, str]:
    year, month = value
    start = dt.date(year, month, 1)
    following = dt.date(year + 1, 1, 1) if month == 12 else dt.date(year, month + 1, 1)
    end = following - dt.timedelta(days=1)
    return start.isoformat(), end.isoformat()


def month_path(value: tuple[int, int]) -> Path:
    year, month = value
    return PAPERS / f"{year:04d}" / f"{month:02d}.json"


def backfill_month(
    value: tuple[int, int], sources: list[dict[str, Any]], classifier: Classifier,
    *, max_workers: int, enrich_abstracts: bool,
) -> dict[str, Any]:
    start, end = month_bounds(value)
    run_at = dt.datetime.now(dt.timezone.utc).astimezone().isoformat(timespec="seconds")
    records: list[dict[str, Any]] = []
    source_results = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, min(max_workers, 6))) as pool:
        futures = {
            pool.submit(fetch_crossref, source, classifier, start, end): source
            for source in sources
        }
        for future in concurrent.futures.as_completed(futures):
            incoming, result = future.result()
            source_results.append(result)
            for item in incoming:
                item.setdefault("first_seen", run_at)
                item["last_seen"] = run_at
                item["history_month"] = month_key(value)
            records.extend(incoming)
            state = "OK" if result.ok else "FAIL"
            print(f"[{state:4}] {month_key(value)} {result.name}: {result.count} {result.message}")

    path = month_path(value)
    existing = read_json(path, [])
    merged = merge_records(existing, records, 20_000)
    # 先保存基础元数据，即使后续摘要源限流也不会丢失本月结果。
    write_json(path, merged)
    openalex_stats = {"checked": 0, "enriched": 0, "not_found": 0, "failed_batches": 0, "deferred": 0, "remaining": 0}
    if enrich_abstracts:
        openalex_stats = enrich_missing_abstracts_from_openalex(
            merged, run_at, limit=5_000, batch_size=40
        )
    for paper in merged:
        update_abstract_availability(paper)
    merged.sort(key=lambda item: (item.get("published", ""), item.get("source", ""), item.get("title", "")), reverse=True)
    write_json(path, merged)
    return {
        "month": month_key(value),
        "updated_at": run_at,
        "count": len(merged),
        "new_or_refetched": len(records),
        "abstracts": sum(bool(item.get("abstract")) for item in merged),
        "openalex": openalex_stats,
        "sources": [result.__dict__ for result in sorted(source_results, key=lambda item: item.name)],
        "complete": all(result.ok for result in source_results),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="按月回填历史核物理论文")
    parser.add_argument("--from-month", type=parse_month, help="开始月份 YYYY-MM")
    parser.add_argument("--to-month", type=parse_month, help="结束月份 YYYY-MM")
    parser.add_argument("--next", type=int, default=0, help="从最早未完成月份起回填 N 个月")
    parser.add_argument("--max-workers", type=int, default=4)
    parser.add_argument("--enrich-abstracts", action="store_true", help="同步尝试 OpenAlex 摘要（速度较慢）")
    args = parser.parse_args()

    history_config = read_json(ROOT / "config" / "history_sources.json", {})
    topic_config = read_json(ROOT / "config" / "topics.json", {})
    sources = history_config.get("sources", [])
    if not sources:
        raise SystemExit("历史期刊配置为空")
    status = read_json(STATUS, {"version": 1, "months": {}})
    status.setdefault("months", {})
    configured_start = parse_month(history_config.get("start_month", "2001-01"))
    today = dt.date.today()
    last_closed_month = (today.year - 1, 12) if today.month == 1 else (today.year, today.month - 1)

    if args.next:
        pending = [
            value for value in month_range(configured_start, last_closed_month)
            if not status["months"].get(month_key(value), {}).get("complete")
        ]
        selected = pending[:max(0, args.next)]
    else:
        if not args.from_month or not args.to_month:
            parser.error("请同时提供 --from-month 和 --to-month，或使用 --next")
        if args.from_month > args.to_month:
            parser.error("开始月份不能晚于结束月份")
        selected = list(month_range(args.from_month, args.to_month))

    classifier = Classifier(topic_config)
    for value in selected:
        result = backfill_month(
            value, sources, classifier, max_workers=args.max_workers,
            enrich_abstracts=args.enrich_abstracts,
        )
        status["months"][result["month"]] = result
        status["last_success"] = result["updated_at"]
        status["configured_start"] = month_key(configured_start)
        status["source_count"] = len(sources)
        write_json(STATUS, status)
        print(json.dumps({key: result[key] for key in ("month", "count", "abstracts", "complete")}, ensure_ascii=False))
    if not selected:
        print("没有待回填月份")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
