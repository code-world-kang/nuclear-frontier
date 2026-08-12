#!/usr/bin/env python3
"""生成适合微信公众号编辑器的每日核物理科研简报。

输出使用内联样式，可直接复制到公众号图文编辑器；同时保留
Markdown 和 JSON 元数据，便于后续接入公众号草稿箱 API。
"""

from __future__ import annotations

import argparse
import html
import json
import re
from datetime import datetime
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
OUTPUT = ROOT / "wechat-official-account"
PUBLIC_OUTPUT = ROOT / "site" / "wechat-digest"
SITE_URL = "https://code-world-kang.github.io/nuclear-frontier/"

CORE_TOPICS = {
    "experimental-nuclear",
    "theoretical-nuclear",
    "nuclear-structure",
    "nuclear-decay",
    "nuclear-reactions",
    "detectors-daq",
    "high-energy-nuclear",
    "nuclear-astrophysics",
}

TOPIC_LABELS = {
    "experimental-nuclear": "实验核物理",
    "theoretical-nuclear": "理论核物理",
    "nuclear-structure": "核结构",
    "nuclear-decay": "核衰变与放射性",
    "nuclear-reactions": "核反应",
    "high-energy-nuclear": "高能核物理",
    "nuclear-astrophysics": "核天体物理",
    "detectors-daq": "探测器与 DAQ",
    "nuclear-general": "核物理综合",
    "accelerators": "加速器与束流",
    "fusion": "核聚变",
    "ai-science": "AI 与科学计算",
    "nuclear-data-applications": "核数据与应用",
    "particle-cross": "粒子与核物理交叉",
    "frontiers": "其他物理前沿",
}

NOTICE_LABELS = {
    "meetings": "会议通知",
    "funding": "科研基金",
    "beam": "束流申请",
}


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def has_chinese(text: str) -> bool:
    return bool(re.search(r"[\u3400-\u9fff]", text or ""))


def clean_text(text: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(text or "")).strip()


def clip(text: str, length: int) -> str:
    text = clean_text(text)
    return text if len(text) <= length else text[: max(1, length - 1)].rstrip() + "…"


def translated(record: dict[str, Any], translations: dict[str, Any]) -> tuple[str, str, bool]:
    item = translations.get(record.get("id", ""), {})
    original_title = clean_text(record.get("title", ""))
    original_body = clean_text(
        record.get("abstract") or record.get("summary") or record.get("content") or ""
    )
    title = clean_text(item.get("title_zh", "")) or original_title
    body = clean_text(item.get("abstract_zh", "")) or original_body
    is_zh = bool(item.get("title_zh")) or has_chinese(title)
    return title, body, is_zh


def latest_records(records: list[dict[str, Any]], limit: int) -> list[dict[str, Any]]:
    if not records:
        return []
    dated = [item for item in records if item.get("published")]
    if dated:
        latest_day = max(str(item.get("published", ""))[:10] for item in dated)
        pool = [item for item in dated if str(item.get("published", ""))[:10] == latest_day]
        if len(pool) < limit:
            pool = dated
    else:
        pool = records
    return sorted(
        pool,
        key=lambda item: (
            int(item.get("importance") or 0),
            str(item.get("published") or ""),
        ),
        reverse=True,
    )[:limit]


def select_papers(records: list[dict[str, Any]], limit: int = 8) -> list[dict[str, Any]]:
    if not records:
        return []
    latest_day = max(str(item.get("published", ""))[:10] for item in records)
    recent = [item for item in records if str(item.get("published", ""))[:10] == latest_day]
    pool = recent if len(recent) >= min(4, limit) else records
    return sorted(
        pool,
        key=lambda item: (
            bool(set(item.get("categories", [])) & CORE_TOPICS),
            int(item.get("importance") or 0),
            bool(item.get("abstract")),
            str(item.get("published") or ""),
        ),
        reverse=True,
    )[:limit]


def notice_group(item: dict[str, Any]) -> str:
    value = f"{item.get('notice_category', '')} {item.get('scope', '')} {item.get('title', '')}".lower()
    if any(word in value for word in ("beam", "proposal", "束流", "实验申请")):
        return "beam"
    if any(word in value for word in ("fund", "grant", "nsfc", "基金", "资助", "项目申报", "csc", "博士后")):
        return "funding"
    return "meetings"


def topic_label(item: dict[str, Any]) -> str:
    topic = item.get("primary_topic") or next(iter(item.get("categories", [])), "nuclear-general")
    return TOPIC_LABELS.get(topic, "核物理")


def escape(text: str) -> str:
    return html.escape(text or "", quote=True)


def paper_html(item: dict[str, Any], translations: dict[str, Any], index: int) -> str:
    title, body, is_zh = translated(item, translations)
    original = clean_text(item.get("title", ""))
    source = clean_text(item.get("source", "未知来源"))
    meta = " · ".join(filter(None, [source, item.get("published", ""), topic_label(item)]))
    translation_note = "" if is_zh else "<span style=\"color:#b07a3f;\">待中文翻译</span> · "
    original_line = ""
    if title != original and original:
        original_line = f'<p style="margin:6px 0 0;color:#8a968c;font-size:13px;line-height:1.55;">{escape(original)}</p>'
    return f"""
    <section style="margin:14px 0;padding:16px 16px 14px;border:1px solid #dcebd7;border-radius:14px;background:#fffef9;box-shadow:0 5px 16px rgba(73,112,77,.06);">
      <p style="margin:0 0 7px;color:#71a66d;font-size:13px;font-weight:700;letter-spacing:.08em;">{index:02d} · {escape(topic_label(item))}</p>
      <h3 style="margin:0;color:#345d42;font-size:18px;line-height:1.55;font-weight:750;">{escape(title)}</h3>
      {original_line}
      <p style="margin:10px 0 0;color:#78877d;font-size:13px;line-height:1.6;">{translation_note}{escape(meta)}</p>
      <p style="margin:10px 0 0;color:#52655a;font-size:15px;line-height:1.85;text-align:justify;">{escape(clip(body, 360) or '数据源暂未提供摘要，请查看原始页面。')}</p>
      <p style="margin:12px 0 0;"><a href="{escape(item.get('url', SITE_URL))}" style="color:#4f8b61;text-decoration:none;font-size:14px;font-weight:700;">查看论文原文 ↗</a></p>
    </section>"""


def compact_html(item: dict[str, Any], translations: dict[str, Any], kind: str) -> str:
    title, body, is_zh = translated(item, translations)
    source = clean_text(item.get("source", "未知来源"))
    original = clean_text(item.get("title", ""))
    original_line = ""
    if title != original and original:
        original_line = f'<p style="margin:4px 0 0;color:#8a968c;font-size:12px;line-height:1.5;">{escape(original)}</p>'
    pending = "" if is_zh else " · 待中文翻译"
    label = NOTICE_LABELS.get(notice_group(item), "物理通知") if kind == "notice" else "物理新闻"
    return f"""
    <section style="margin:10px 0;padding:14px 15px;border-left:4px solid #9ccc8e;border-radius:0 12px 12px 0;background:#f7fbf3;">
      <p style="margin:0;color:#6f9a67;font-size:12px;font-weight:700;">{escape(label)} · {escape(source)}{escape(pending)}</p>
      <h3 style="margin:6px 0 0;color:#3e6048;font-size:16px;line-height:1.55;">{escape(title)}</h3>
      {original_line}
      <p style="margin:7px 0 0;color:#5f7065;font-size:14px;line-height:1.75;">{escape(clip(body, 220) or '数据源暂未提供详细介绍。')}</p>
      <p style="margin:8px 0 0;"><a href="{escape(item.get('url', SITE_URL))}" style="color:#4f8b61;text-decoration:none;font-size:13px;font-weight:700;">查看官方原文 ↗</a></p>
    </section>"""


def markdown_item(item: dict[str, Any], translations: dict[str, Any], index: int | None = None) -> str:
    title, body, _ = translated(item, translations)
    prefix = f"{index}. " if index is not None else "- "
    meta = " · ".join(filter(None, [item.get("source", ""), item.get("published", "")]))
    return f"{prefix}**[{title}]({item.get('url', SITE_URL)})**  \n   {meta}  \n   {clip(body, 360) or '数据源暂未提供详细介绍。'}"


def build_digest(output_dir: Path = OUTPUT, public_dir: Path = PUBLIC_OUTPUT) -> dict[str, Any]:
    papers = load_json(DATA / "papers.json")
    news = load_json(DATA / "news.json")
    notices = load_json(DATA / "notices.json")
    status_payload = load_json(DATA / "status.json")
    translation_payload = load_json(DATA / "translations.zh-CN.json")
    translations = translation_payload.get("items", {})

    selected_papers = select_papers(papers, 8)
    selected_news = latest_records(news, 4)
    notice_pool = latest_records(notices, 12)
    selected_notices: list[dict[str, Any]] = []
    for group in ("meetings", "funding", "beam"):
        selected_notices.extend([item for item in notice_pool if notice_group(item) == group][:2])
    if len(selected_notices) < 6:
        seen = {item.get("id") for item in selected_notices}
        selected_notices.extend(item for item in notice_pool if item.get("id") not in seen)
        selected_notices = selected_notices[:6]

    dates = [str(item.get("published", ""))[:10] for item in selected_papers if item.get("published")]
    issue_date = max(dates, default=datetime.now().astimezone().date().isoformat())
    title = f"小康康的物理世界 · {issue_date} 科研简报"
    translated_count = sum(
        bool(translations.get(item.get("id", ""), {}).get("title_zh"))
        for item in selected_papers + selected_news + selected_notices
    )
    total_count = len(selected_papers) + len(selected_news) + len(selected_notices)

    paper_sections = "".join(paper_html(item, translations, i) for i, item in enumerate(selected_papers, 1))
    news_sections = "".join(compact_html(item, translations, "news") for item in selected_news)
    notice_sections = "".join(compact_html(item, translations, "notice") for item in selected_notices)
    article_html = f"""<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{escape(title)}</title></head>
<body style="margin:0;background:#f5f7ee;color:#405348;font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif;">
<main style="box-sizing:border-box;max-width:760px;margin:0 auto;padding:20px 16px 36px;">
  <section style="padding:24px 20px;border-radius:20px;background:linear-gradient(135deg,#edf8df,#fff2dd);text-align:center;">
    <p style="margin:0;color:#6f9b68;font-size:13px;font-weight:700;letter-spacing:.18em;">每日核物理科研简报</p>
    <h1 style="margin:9px 0 0;color:#355f43;font-size:25px;line-height:1.45;">{escape(title)}</h1>
    <p style="margin:12px 0 0;color:#718075;font-size:14px;line-height:1.75;">今日精选 {len(selected_papers)} 篇论文、{len(selected_news)} 条新闻、{len(selected_notices)} 条通知；其中 {translated_count}/{total_count} 条已有中文内容。</p>
  </section>
  <h2 style="margin:26px 0 8px;color:#355f43;font-size:21px;border-bottom:2px solid #b9dca8;padding-bottom:8px;">📖 今日重点论文</h2>
  {paper_sections or '<p>今日暂无新论文。</p>'}
  <h2 style="margin:28px 0 8px;color:#355f43;font-size:21px;border-bottom:2px solid #b9dca8;padding-bottom:8px;">🌱 物理新闻</h2>
  {news_sections or '<p>今日暂无新闻。</p>'}
  <h2 style="margin:28px 0 8px;color:#355f43;font-size:21px;border-bottom:2px solid #b9dca8;padding-bottom:8px;">📣 科研通知</h2>
  {notice_sections or '<p>今日暂无通知。</p>'}
  <section style="margin-top:26px;padding:18px;border-radius:16px;background:#eaf5e5;text-align:center;">
    <p style="margin:0;color:#496854;font-size:15px;line-height:1.8;">完整摘要、筛选、收藏、笔记与 Cite 请访问<br><a href="{SITE_URL}" style="color:#3f8055;font-weight:700;text-decoration:none;">小康康的物理世界 ↗</a></p>
  </section>
  <p style="margin:16px 0 0;color:#97a299;font-size:11px;line-height:1.7;text-align:center;">内容来自公开学术元数据与官方通知，请以原始页面为准。</p>
</main></body></html>
"""

    markdown = [
        f"# {title}",
        "",
        f">今日精选 {len(selected_papers)} 篇论文、{len(selected_news)} 条新闻、{len(selected_notices)} 条通知；其中 {translated_count}/{total_count} 条已有中文内容。",
        "",
        "## 今日重点论文",
        "",
        *[markdown_item(item, translations, i) for i, item in enumerate(selected_papers, 1)],
        "",
        "## 物理新闻",
        "",
        *[markdown_item(item, translations) for item in selected_news],
        "",
        "## 科研通知",
        "",
        *[markdown_item(item, translations) for item in selected_notices],
        "",
        f"[访问完整网站]({SITE_URL})",
        "",
    ]

    metadata = {
        "title": title,
        "issue_date": issue_date,
        # 使用数据管线时间而不是构建时间，避免只构建一次就产生无意义的 Git 变更。
        "generated_at": status_payload.get("last_success")
        or translation_payload.get("generated_at")
        or f"{issue_date}T00:00:00+08:00",
        "site_url": SITE_URL,
        "counts": {
            "papers": len(selected_papers),
            "news": len(selected_news),
            "notices": len(selected_notices),
            "translated": translated_count,
            "total": total_count,
        },
        "record_ids": {
            "papers": [item.get("id") for item in selected_papers],
            "news": [item.get("id") for item in selected_news],
            "notices": [item.get("id") for item in selected_notices],
        },
    }

    for directory in (output_dir, public_dir):
        directory.mkdir(parents=True, exist_ok=True)
        (directory / "index.html").write_text(article_html, encoding="utf-8")
        (directory / "latest.md").write_text("\n".join(markdown), encoding="utf-8")
        (directory / "metadata.json").write_text(
            json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
    return metadata


def main() -> None:
    parser = argparse.ArgumentParser(description="生成微信公众号每日科研简报")
    parser.add_argument("--output", type=Path, default=OUTPUT, help="可复制稿件输出目录")
    parser.add_argument("--public-output", type=Path, default=PUBLIC_OUTPUT, help="在线预览输出目录")
    args = parser.parse_args()
    metadata = build_digest(args.output, args.public_output)
    print(
        f"公众号简报已生成：{args.output / 'index.html'} "
        f"({metadata['counts']['papers']} 论文 / {metadata['counts']['news']} 新闻 / "
        f"{metadata['counts']['notices']} 通知)"
    )


if __name__ == "__main__":
    main()
