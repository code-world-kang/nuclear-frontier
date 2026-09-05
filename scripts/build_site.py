#!/usr/bin/env python3
"""将经过验证的数据复制到 GitHub Pages 发布目录。"""

from __future__ import annotations

import json
import shutil
from collections import Counter
from pathlib import Path

from build_history import build_history_site
from build_wechat_digest import build_digest
from translate_content import collect_candidates, queue_payload


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
CONFIG = ROOT / "config"
PUBLIC_DATA = ROOT / "site" / "data"
MINIPROGRAM_PREVIEW = ROOT / "miniprogram" / "preview"
PUBLIC_MINIPROGRAM_PREVIEW = ROOT / "site" / "miniprogram-preview"


def load(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> None:
    PUBLIC_DATA.mkdir(parents=True, exist_ok=True)
    # 即使未配置翻译服务或首次构建，也应有真实可用的待译队列。
    queue_file = DATA / "translation-queue.json"
    old_queue = load(queue_file) if queue_file.exists() else {}
    queue = queue_payload(collect_candidates(load(DATA / "translations.zh-CN.json").get("items", {})), old_queue.get("model", ""), old_queue.get("service_status", "not_configured"))
    if {key: value for key, value in queue.items() if key != "generated_at"} == {key: value for key, value in old_queue.items() if key != "generated_at"}:
        queue["generated_at"] = old_queue["generated_at"]
    queue_file.write_text(json.dumps(queue, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    for name in (
        "papers.json", "news.json", "notices.json", "featured.json", "status.json",
        "translations.zh-CN.json", "translation-queue.json", "reference-resources.json",
    ):
        shutil.copy2(DATA / name, PUBLIC_DATA / name)
    shutil.copy2(CONFIG / "notice_portals.json", PUBLIC_DATA / "notice-portals.json")
    personal_state = DATA / "personal" / "state.json"
    shutil.copy2(personal_state, PUBLIC_DATA / "personal-state.json")
    personal_payload = load(personal_state)
    favorite_records = list((personal_payload.get("personal", {}).get("favorites") or {}).values())
    (PUBLIC_DATA / "public-favorites.json").write_text(
        json.dumps(favorite_records, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

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
        "translation_service": {**({"last_run": load(DATA / "translation-run.json")} if (DATA / "translation-run.json").exists() else {}), **{key: queue.get(key) for key in ("service_status", "pending", "generated_at", "model")}},
        "personal_backup": {"snapshot_at": personal_payload.get("updated_at", "")},
        "notice": "本站汇总官方公开元数据，不代表数据源机构背书。请以原始页面为准。",
    }
    (PUBLIC_DATA / "meta.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    (ROOT / "site" / ".nojekyll").touch()
    if MINIPROGRAM_PREVIEW.is_dir():
        PUBLIC_MINIPROGRAM_PREVIEW.mkdir(parents=True, exist_ok=True)
        for name in ("index.html", "preview.css", "preview.js"):
            shutil.copy2(MINIPROGRAM_PREVIEW / name, PUBLIC_MINIPROGRAM_PREVIEW / name)
    history_manifest = build_history_site()
    wechat_digest = build_digest()
    print(f"站点数据已构建：{PUBLIC_DATA}")
    print(f"历史索引：{history_manifest['indexed_papers']} 篇 / {history_manifest['indexed_months']} 个月份")
    print(
        "公众号简报："
        f"{wechat_digest['counts']['papers']} 论文 / "
        f"{wechat_digest['counts']['news']} 新闻 / "
        f"{wechat_digest['counts']['notices']} 通知"
    )


if __name__ == "__main__":
    main()
