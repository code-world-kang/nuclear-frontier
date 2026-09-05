#!/usr/bin/env python3
"""把每日新增的英文论文、新闻和通知自动译为中文。

仅使用显式配置的服务端翻译服务；未配置时只建立待译队列。
不使用 GitHub 登录令牌冒充翻译凭据，不截断摘要冒充完整译文。
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import time
import urllib.error
import urllib.request
import urllib.parse
import hashlib
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
TRANSLATIONS = DATA / "translations.zh-CN.json"
QUEUE = DATA / "translation-queue.json"
DEFAULT_ENDPOINT = ""
DEFAULT_MODEL = ""
HAN_RE = re.compile(r"[\u3400-\u9fff]")
BOILERPLATE = (
    "client challenge", "couldn’t load", "couldn't load", "browser extension",
    "enable javascript", "access denied", "captcha", "cloudflare",
)


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: Any) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def source_text(item: dict[str, Any]) -> str:
    value = str(item.get("abstract") or item.get("content") or item.get("summary") or "").strip()
    if any(marker in value.lower() for marker in BOILERPLATE):
        return ""
    return value


def is_chinese(value: str) -> bool:
    han = len(HAN_RE.findall(str(value or "")))
    latin = len(re.findall(r"[A-Za-z]", str(value or "")))
    return han >= 2 and han / max(1, han + latin) >= 0.25


def source_hash(item: dict[str, Any]) -> str:
    return hashlib.sha256((str(item.get("title", "")) + "\n" + source_text(item)).encode()).hexdigest()


def needs_translation(item: dict[str, Any], existing: dict[str, Any]) -> bool:
    title = str(item.get("title") or "").strip()
    if not title:
        return False
    translated = existing.get(item["id"], {})
    if not is_chinese(title) and not is_chinese(translated.get("title_zh", "")):
        return True
    body = source_text(item)
    if translated.get("source_hash") and translated["source_hash"] != source_hash(item):
        return not (is_chinese(title) and (not body or is_chinese(body)))
    return bool(body and not is_chinese(body) and not is_chinese(translated.get("abstract_zh", "")))


def collect_candidates(existing: dict[str, Any]) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []
    kind_priority = {"notice": 3, "news": 2, "paper": 1}
    for filename in ("notices.json", "news.json", "papers.json"):
        for item in load_json(DATA / filename):
            if needs_translation(item, existing):
                candidates.append(item)
    candidates.sort(
        key=lambda item: (
            kind_priority.get(str(item.get("type")), 0),
            str(item.get("published") or ""),
            int(item.get("importance") or 0),
        ),
        reverse=True,
    )
    return candidates


def queue_payload(candidates: list[dict[str, Any]], model: str, service_status: str = "not_configured") -> dict[str, Any]:
    counts = {"paper": 0, "news": 0, "notice": 0}
    for item in candidates:
        counts[str(item.get("type") or "paper")] = counts.get(str(item.get("type") or "paper"), 0) + 1
    return {
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "model": model,
        "service_status": service_status,
        "pending": len(candidates),
        "counts": counts,
        "items": [
            {
                "id": item["id"], "type": item.get("type"), "published": item.get("published"),
                "title": item.get("title"), "source": item.get("source_short") or item.get("source"),
            }
            for item in candidates
        ],
    }


def request_translation(batch: list[dict[str, Any]], token: str, endpoint: str, model: str) -> dict[str, Any]:
    records = [
        {
            "id": item["id"],
            "type": item.get("type"),
            "title": item.get("title", ""),
            "text": source_text(item),
        }
        for item in batch
    ]
    system = (
        "你是严谨的核物理科研翻译。把输入英文忠实翻译为简体中文。"
        "保留核素、公式、变量、单位、DOI、专有名词与实验装置缩写；首次出现的重要缩写可保留英文。"
        "不得补写原文没有的事实。title_zh 必须有内容；text 为空时 abstract_zh 必须为空字符串。"
        "仅返回 JSON 对象，格式为 {\"items\":[{\"id\":...,\"title_zh\":...,\"abstract_zh\":...}]}。"
    )
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": json.dumps(records, ensure_ascii=False)},
        ],
        "temperature": 0.1,
        "max_tokens": 8000,
        "response_format": {"type": "json_object"},
    }
    request = urllib.request.Request(
        endpoint,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={
            "Accept": "application/json",
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "User-Agent": "nuclear-frontier-translation/1.0",
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        result = json.loads(response.read())
    choice = result["choices"][0]
    if choice.get("finish_reason") not in (None, "stop"):
        raise ValueError("译文未完整返回，保留待译状态")
    content = choice["message"]["content"].strip()
    if content.startswith("```"):
        content = re.sub(r"^```(?:json)?\s*|\s*```$", "", content, flags=re.I | re.S)
    parsed = json.loads(content)
    return parsed if isinstance(parsed, dict) else {"items": []}


def translate_batch(batch: list[dict[str, Any]], token: str, endpoint: str, model: str) -> dict[str, dict[str, str]]:
    last_error: Exception | None = None
    for attempt in range(3):
        try:
            payload = request_translation(batch, token, endpoint, model)
            allowed = {item["id"]: item for item in batch}
            result: dict[str, dict[str, str]] = {}
            for translated in payload.get("items", []):
                record_id = str(translated.get("id") or "")
                title_zh = str(translated.get("title_zh") or "").strip()
                abstract_zh = str(translated.get("abstract_zh") or "").strip()
                if record_id not in allowed or not title_zh or not HAN_RE.search(title_zh):
                    continue
                if not source_text(allowed[record_id]):
                    abstract_zh = ""
                elif not HAN_RE.search(abstract_zh):
                    continue
                result[record_id] = {"title_zh": title_zh, "abstract_zh": abstract_zh}
            if not result:
                raise ValueError("模型没有返回可用的中文译文")
            return result
        except (OSError, KeyError, ValueError, json.JSONDecodeError, urllib.error.HTTPError) as exc:
            last_error = ValueError(f"服务响应异常 {type(exc).__name__}")
            if attempt < 2:
                time.sleep(2 ** attempt)
    raise RuntimeError(f"翻译请求失败：{last_error}")


def main() -> None:
    parser = argparse.ArgumentParser(description="自动补全英文科研内容的中文译文")
    parser.add_argument("--limit", type=int, default=40, help="本次最多翻译多少条")
    parser.add_argument("--batch-size", type=int, default=3, help="每次模型请求包含多少条")
    parser.add_argument("--strict", action="store_true", help="模型调用失败时返回非零状态")
    args = parser.parse_args()

    payload = load_json(TRANSLATIONS)
    existing = payload.setdefault("items", {})
    model = os.getenv("TRANSLATION_MODEL", DEFAULT_MODEL).strip() or DEFAULT_MODEL
    endpoint = os.getenv("TRANSLATION_API_URL", DEFAULT_ENDPOINT).strip() or DEFAULT_ENDPOINT
    token = os.getenv("TRANSLATION_API_KEY", "").strip()
    configured = bool(token and model and endpoint)
    if endpoint and (urllib.parse.urlsplit(endpoint).scheme != "https" or urllib.parse.urlsplit(endpoint).hostname == "models.github.ai"):
        configured = False
    service_status = "configured" if configured else "not_configured"
    candidates = collect_candidates(existing)
    write_json(QUEUE, queue_payload(candidates, model, service_status))
    print(f"待翻译 {len(candidates)} 条：通知优先，其次新闻和最新论文。")
    if not candidates or args.limit <= 0:
        return
    if not configured:
        print("未配置可用的服务地址、模型及翻译密钥；仅更新待译队列。")
        return

    selected = candidates[: args.limit]
    translated_count = 0
    failures: list[str] = []
    for offset in range(0, len(selected), max(1, args.batch_size)):
        batch = selected[offset: offset + max(1, args.batch_size)]
        if any(len(source_text(item)) > 50000 for item in batch):
            failures.append("超长正文等待人工分段翻译")
            continue
        try:
            translations = translate_batch(batch, token, endpoint, model)
        except RuntimeError as exc:
            failures.append(str(exc))
            print(str(exc))
            continue
        translated_at = dt.datetime.now(dt.timezone(dt.timedelta(hours=8))).isoformat()
        for record_id, item in translations.items():
            record = {
                "title_zh": item["title_zh"],
                "abstract_zh": item["abstract_zh"],
                "translated_at": translated_at,
                "provider": urllib.parse.urlsplit(endpoint).hostname,
                "model": model,
                "source_hash": source_hash(next(source for source in batch if source["id"] == record_id)),
                "note": f"由已配置服务自动翻译（{model}）；未经人工校对。",
            }
            if not record["abstract_zh"]:
                record["note"] += " 原始来源未提供 abstract/summary，仅翻译题目。"
            existing[record_id] = record
            translated_count += 1
        payload["generated_at"] = dt.datetime.now(dt.timezone.utc).isoformat()
        write_json(TRANSLATIONS, payload)
        print(f"已完成 {translated_count}/{len(selected)} 条。")

    remaining = collect_candidates(existing)
    write_json(QUEUE, queue_payload(remaining, model, "failed" if failures else "ready"))
    print(f"本次新增 {translated_count} 条中文译文，队列剩余 {len(remaining)} 条。")
    if failures and args.strict:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
