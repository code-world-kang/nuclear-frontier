#!/usr/bin/env python3
"""每日内容更新管线。

仅使用公开 RSS/API 与官方通知页的元数据，不下载或镜像受版权保护的全文。
任一数据源失败时保留历史数据，并将失败记录到 data/status.json。
"""

from __future__ import annotations

import argparse
import concurrent.futures
import datetime as dt
import email.utils
import hashlib
import html
import json
import re
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from dataclasses import asdict, dataclass
from html.parser import HTMLParser
from pathlib import Path
from typing import Any, Iterable


ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / "config"
DATA = ROOT / "data"
USER_AGENT = "NuclearFrontierPortal/1.0 (+https://github.com; academic metadata aggregator)"
CROSSREF_SEMAPHORE = threading.BoundedSemaphore(2)


@dataclass
class SourceResult:
    name: str
    kind: str
    ok: bool
    count: int
    message: str = ""
    duration_ms: int = 0


def read_json(path: Path, default: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    temporary.replace(path)


def fetch(url: str, *, accept: str = "*/*", attempts: int = 3) -> bytes:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": accept,
            "Accept-Encoding": "identity",
        },
    )
    last_error: Exception | None = None
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(request, timeout=25) as response:
                return response.read()
        except urllib.error.HTTPError as exc:
            last_error = exc
            if attempt + 1 < attempts and exc.code in (429, 500, 502, 503, 504):
                retry_after = exc.headers.get("Retry-After", "") if exc.headers else ""
                delay = float(retry_after) if retry_after.isdigit() else 2.5 * (attempt + 1)
                time.sleep(min(delay, 15))
                continue
            break
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            last_error = exc
            if attempt + 1 < attempts:
                time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(str(last_error) if last_error else "unknown network error")


def clean_text(value: str | None) -> str:
    if not value:
        return ""
    value = re.sub(r"<[^>]+>", " ", value)
    value = html.unescape(value)
    return re.sub(r"\s+", " ", value).strip()


def normalize_title(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", value.lower())[:220]


def stable_id(*parts: str) -> str:
    key = "|".join(part.strip().lower() for part in parts if part)
    return hashlib.sha1(key.encode("utf-8")).hexdigest()[:16]


def iso_date(value: Any) -> str:
    if not value:
        return ""
    if isinstance(value, dict):
        parts = value.get("date-parts", [[]])[0]
        if parts:
            year = int(parts[0])
            month = int(parts[1]) if len(parts) > 1 else 1
            day = int(parts[2]) if len(parts) > 2 else 1
            return f"{year:04d}-{month:02d}-{day:02d}"
    text = str(value).strip()
    try:
        parsed = email.utils.parsedate_to_datetime(text)
        return parsed.date().isoformat()
    except (TypeError, ValueError, OverflowError):
        pass
    match = re.search(r"(20\d{2}|19\d{2})[-/.](\d{1,2})[-/.](\d{1,2})", text)
    if match:
        return f"{int(match.group(1)):04d}-{int(match.group(2)):02d}-{int(match.group(3)):02d}"
    return text[:10] if re.match(r"^\d{4}-\d{2}-\d{2}", text) else ""


def extract_arxiv_id(url: str) -> str:
    match = re.search(r"arxiv\.org/(?:abs|pdf)/([^?#/]+)", url, re.I)
    return match.group(1).removesuffix(".pdf") if match else ""


class AnchorParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.current_href = ""
        self.current_text: list[str] = []
        self.links: list[tuple[str, str]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() != "a":
            return
        self.current_href = dict(attrs).get("href") or ""
        self.current_text = []

    def handle_data(self, data: str) -> None:
        if self.current_href:
            self.current_text.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() == "a" and self.current_href:
            text = clean_text(" ".join(self.current_text))
            if text:
                self.links.append((self.current_href, text))
            self.current_href = ""
            self.current_text = []


class Classifier:
    def __init__(self, config: dict[str, Any]) -> None:
        self.categories = config["categories"]
        self.priority_terms = [item.lower() for item in config["priority_terms"]]
        self.nuclear_gate = [item.lower() for item in config["nuclear_gate"]]
        self.physics_gate = [item.lower() for item in config.get("physics_gate", [])]
        self.ai_gate = [item.lower() for item in config["ai_gate"]]

    @staticmethod
    def contains_term(text: str, term: str) -> bool:
        """使用词边界避免 NIF 命中 significant、AI 命中 explain 等假阳性。"""
        normalized = term.strip().lower()
        lowered = text.lower()
        if re.fullmatch(r"[a-z0-9]+(?:[ -][a-z0-9]+)*", normalized):
            pattern = r"(?<![a-z0-9])" + re.escape(normalized).replace(r"\ ", r"\s+") + r"(?![a-z0-9])"
            return re.search(pattern, lowered) is not None
        return normalized in lowered

    @classmethod
    def match_count(cls, text: str, terms: Iterable[str]) -> int:
        return sum(1 for term in terms if cls.contains_term(text, term))

    def classify(self, title: str, abstract: str, source: str = "") -> tuple[list[str], list[str]]:
        text = f"{title} {abstract} {source}".lower()
        scored: list[tuple[int, str, str]] = []
        tags: list[str] = []
        for category in self.categories:
            hits = [term for term in category["keywords"] if self.contains_term(text, term)]
            if hits:
                scored.append((len(hits), category["id"], category["name"]))
                tags.extend(hits[:3])
        scored.sort(key=lambda item: (-item[0], item[2]))
        category_ids = [item[1] for item in scored[:3]]
        if not category_ids:
            source_defaults = (
                (("physical review c", "nuclear physics a", "european physical journal a", "journal of physics g", "chinese physics c", "nuclear science and techniques"), "experimental-nuclear"),
                (("nuclear instruments",), "detectors-daq"),
                (("nuclear fusion", "plasma physics"), "fusion"),
                (("physics letters b",), "particle-cross"),
                (("physical review d",), "particle-cross"),
                (("astrophysical journal", "monthly notices", "astronomy and astrophysics"), "nuclear-astrophysics"),
                (("machine learning science",), "ai-science"),
                (("nuclear data sheets", "atomic data and nuclear data"), "nuclear-data-applications"),
                (("fusion engineering",), "fusion"),
                (("scientific instruments", "instrumentation", "ieee transactions on nuclear science"), "detectors-daq"),
                (("annals of nuclear energy", "radiation physics and chemistry"), "nuclear-data-applications"),
            )
            category_ids = [next((category for names, category in source_defaults if any(name in source.lower() for name in names)), "frontiers")]
        return category_ids, list(dict.fromkeys(tags))[:8]

    def relevant(self, title: str, abstract: str, mode: str) -> bool:
        if mode == "all":
            return True
        text = f"{title} {abstract}".lower()
        strong_nuclear_terms = [
            term for term in self.nuclear_gate
            if term not in {"nuclear", "nucleus", "nuclei", "particle", "proton", "detector", "radiation"}
        ] + ["nuclear physics", "nuclear structure", "nuclear reaction", "nuclear matter", "nuclear data", "atomic nucleus"]
        strong_nuclear_hits = self.match_count(text, strong_nuclear_terms)
        priority_hits = self.match_count(text, self.priority_terms)
        if mode == "important-ai":
            ai_hits = self.match_count(text, self.ai_gate)
            return ai_hits >= 1 and self.match_count(text, ["machine learning", "artificial intelligence", "neural network", "foundation model", "large language model", "deep learning"]) >= 1
        physics_hits = self.match_count(text, self.physics_gate)
        return strong_nuclear_hits >= 1 or (priority_hits >= 1 and physics_hits >= 1)

    def importance_details(self, title: str, abstract: str, base: int, categories: list[str]) -> tuple[int, list[str]]:
        text = f"{title} {abstract}".lower()
        score = base * 10
        reasons = [f"来源权重 +{base * 10}"]
        priority_hits = self.match_count(text, self.priority_terms)
        if priority_hits:
            bonus = min(20, priority_hits * 8)
            score += bonus
            reasons.append(f"突破性表述 +{bonus}")
        if len(categories) > 1:
            bonus = min(12, (len(categories) - 1) * 4)
            score += bonus
            reasons.append(f"跨领域关联 +{bonus}")
        if any(category in categories for category in ("high-energy-nuclear", "nuclear-astrophysics", "fusion", "ai-science")):
            score += 4
            reasons.append("前沿主题 +4")
        return min(score, 100), reasons

    def importance(self, title: str, abstract: str, base: int, categories: list[str]) -> int:
        return self.importance_details(title, abstract, base, categories)[0]


def crossref_url(issn: str, start: str, end: str) -> str:
    params = {
        "filter": f"from-pub-date:{start},until-pub-date:{end},type:journal-article",
        "select": "DOI,title,author,published,published-online,published-print,URL,container-title,abstract,subject,type",
        "rows": "500",
        "sort": "published",
        "order": "desc",
    }
    return f"https://api.crossref.org/journals/{urllib.parse.quote(issn)}/works?{urllib.parse.urlencode(params)}"


def fetch_crossref(source: dict[str, Any], classifier: Classifier, start: str, end: str) -> tuple[list[dict[str, Any]], SourceResult]:
    try:
        with CROSSREF_SEMAPHORE:
            payload = json.loads(fetch(crossref_url(source["issn"], start, end), accept="application/json"))
        records: list[dict[str, Any]] = []
        for item in payload.get("message", {}).get("items", []):
            title = clean_text((item.get("title") or [""])[0])
            abstract = clean_text(item.get("abstract"))
            if not title or not classifier.relevant(title, abstract, source["mode"]):
                continue
            categories, tags = classifier.classify(title, abstract, source["name"])
            authors = []
            for author in item.get("author", []):
                name = " ".join(filter(None, [author.get("given", ""), author.get("family", "")])).strip()
                if name:
                    authors.append(name)
            published = iso_date(item.get("published-online") or item.get("published-print") or item.get("published"))
            doi = item.get("DOI", "")
            url = item.get("URL") or (f"https://doi.org/{doi}" if doi else "")
            importance, score_reasons = classifier.importance_details(title, abstract, source["weight"], categories)
            records.append({
                "id": stable_id("doi", doi) if doi else stable_id(title, published, source["short"]),
                "type": "paper",
                "title": title,
                "abstract": abstract,
                "authors": authors[:40],
                "published": published,
                "updated": published,
                "source": source["name"],
                "source_short": source["short"],
                "source_type": "journal",
                "doi": doi,
                "arxiv_id": "",
                "url": url,
                "pdf_url": "",
                "categories": categories,
                "tags": tags,
                "importance": importance,
                "score_reasons": score_reasons,
                "open_access": None,
            })
        return records, SourceResult(source["name"], "paper", True, len(records))
    except Exception as exc:  # noqa: BLE001 - 单源失败不应终止整个日更
        return [], SourceResult(source["name"], "paper", False, 0, str(exc)[:240])


def xml_text(element: ET.Element, names: list[str]) -> str:
    for child in element.iter():
        local = child.tag.rsplit("}", 1)[-1].lower()
        if local in names and child.text:
            return clean_text(child.text)
    return ""


def parse_feed_items(raw: bytes) -> list[dict[str, str]]:
    # 部分官方 RSS 偶尔带有 XML 1.0 不允许的控制字符，先清理再解析。
    xml = raw.decode("utf-8", errors="replace")
    xml = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", xml)
    root = ET.fromstring(xml)
    candidates = [node for node in root.iter() if node.tag.rsplit("}", 1)[-1].lower() in ("item", "entry")]
    output: list[dict[str, str]] = []
    for node in candidates:
        title = xml_text(node, ["title"])
        summary = xml_text(node, ["description", "summary", "content"])
        published = xml_text(node, ["pubdate", "published", "updated", "date"])
        creator = xml_text(node, ["creator", "author"])
        link = ""
        for child in node.iter():
            if child.tag.rsplit("}", 1)[-1].lower() == "link":
                candidate = child.attrib.get("href") or clean_text(child.text)
                relation = child.attrib.get("rel", "alternate")
                if candidate and relation in ("alternate", ""):
                    link = candidate
                    break
        if not link:
            link = xml_text(node, ["guid", "id"])
        if title and link:
            output.append({"title": title, "summary": summary, "published": published, "creator": creator, "url": link})
    return output


def fetch_arxiv(source: dict[str, Any], classifier: Classifier) -> tuple[list[dict[str, Any]], SourceResult]:
    url = f"https://rss.arxiv.org/rss/{urllib.parse.quote(source['category'])}"
    try:
        items = parse_feed_items(fetch(url, accept="application/rss+xml, application/xml, text/xml"))
        records: list[dict[str, Any]] = []
        for item in items:
            title, abstract = item["title"], item["summary"]
            if not classifier.relevant(title, abstract, source["mode"]):
                continue
            categories, tags = classifier.classify(title, abstract, source["name"])
            arxiv_id = extract_arxiv_id(item["url"])
            published = iso_date(item["published"])
            importance, score_reasons = classifier.importance_details(title, abstract, source["weight"], categories)
            records.append({
                "id": stable_id("arxiv", arxiv_id) if arxiv_id else stable_id(title, published, source["category"]),
                "type": "paper",
                "title": title,
                "abstract": abstract,
                "authors": [name.strip() for name in re.split(r",| and ", item["creator"]) if name.strip()][:40],
                "published": published,
                "updated": published,
                "source": source["name"],
                "source_short": source["category"],
                "source_type": "preprint",
                "doi": "",
                "arxiv_id": arxiv_id,
                "url": item["url"],
                "pdf_url": f"https://arxiv.org/pdf/{arxiv_id}" if arxiv_id else "",
                "categories": categories,
                "tags": tags,
                "importance": importance,
                "score_reasons": score_reasons,
                "open_access": True,
            })
        if source["mode"] == "important-ai":
            records.sort(key=lambda item: (item["importance"], item["published"]), reverse=True)
            records = records[: int(source.get("limit", 6))]
        return records, SourceResult(source["name"], "paper", True, len(records))
    except Exception as exc:  # noqa: BLE001
        return [], SourceResult(source["name"], "paper", False, 0, str(exc)[:240])


def fetch_news(source: dict[str, Any], classifier: Classifier) -> tuple[list[dict[str, Any]], SourceResult]:
    try:
        items = parse_feed_items(fetch(source["url"], accept="application/rss+xml, application/xml, text/xml"))
        records = []
        for item in items[:80]:
            title, summary = item["title"], item["summary"]
            # 官方新闻源仍做宽松的科研相关性筛选。
            if not classifier.relevant(title, summary, "filtered") and source["name"] not in ("APS Physics", "Nature Physics"):
                continue
            categories, tags = classifier.classify(title, summary, source["name"])
            published = iso_date(item["published"])
            importance, score_reasons = classifier.importance_details(title, summary, source["weight"], categories)
            records.append({
                "id": stable_id("news", item["url"]),
                "type": "news",
                "title": title,
                "summary": summary,
                "published": published,
                "source": source["name"],
                "url": item["url"],
                "categories": categories,
                "tags": tags,
                "importance": importance,
                "score_reasons": score_reasons,
            })
        return records, SourceResult(source["name"], "news", True, len(records))
    except Exception as exc:  # noqa: BLE001
        return [], SourceResult(source["name"], "news", False, 0, str(exc)[:240])


def fetch_notice(source: dict[str, Any], classifier: Classifier) -> tuple[list[dict[str, Any]], SourceResult]:
    try:
        raw = fetch(source["url"], accept="text/html").decode("utf-8", errors="replace")
        parser = AnchorParser()
        parser.feed(raw)
        include = [term.lower() for term in source["include"]]
        records: list[dict[str, Any]] = []
        seen: set[str] = set()
        for href, title in parser.links:
            if len(title) < 12 or not any(term in title.lower() for term in include):
                continue
            url = urllib.parse.urljoin(source["url"], href)
            if url in seen:
                continue
            seen.add(url)
            categories, tags = classifier.classify(title, "", source["name"])
            published = iso_date(title)
            record_kind = source.get("kind", "notice")
            importance, score_reasons = classifier.importance_details(title, "", source["weight"], categories)
            records.append({
                "id": stable_id("notice", url),
                "type": record_kind,
                "title": title,
                "summary": "",
                "published": published,
                "deadline": "",
                "source": source["name"],
                "url": url,
                "categories": categories,
                "tags": tags,
                "importance": importance,
                "score_reasons": score_reasons,
            })
            if len(records) >= 30:
                break
        return records, SourceResult(source["name"], source.get("kind", "notice"), True, len(records))
    except Exception as exc:  # noqa: BLE001
        return [], SourceResult(source["name"], source.get("kind", "notice"), False, 0, str(exc)[:240])


def merge_records(existing: list[dict[str, Any]], incoming: list[dict[str, Any]], max_items: int) -> list[dict[str, Any]]:
    merged: dict[str, dict[str, Any]] = {item["id"]: item for item in existing if item.get("id")}
    title_index = {normalize_title(item.get("title", "")): item["id"] for item in existing if item.get("title")}
    for item in incoming:
        duplicate_id = title_index.get(normalize_title(item.get("title", "")))
        target_id = duplicate_id or item["id"]
        if target_id in merged:
            old = merged[target_id]
            # 官方期刊元数据优先于预印本，但保留 arXiv/PDF 链接。
            if item.get("source_type") == "journal" or old.get("source_type") != "journal":
                combined = {**old, **item, "id": target_id}
            else:
                combined = {**item, **old, "id": target_id}
            combined["arxiv_id"] = old.get("arxiv_id") or item.get("arxiv_id", "")
            combined["pdf_url"] = old.get("pdf_url") or item.get("pdf_url", "")
            combined["doi"] = old.get("doi") or item.get("doi", "")
            combined["categories"] = list(dict.fromkeys(old.get("categories", []) + item.get("categories", [])))[:4]
            combined["tags"] = list(dict.fromkeys(old.get("tags", []) + item.get("tags", [])))[:10]
            combined["importance"] = max(old.get("importance", 0), item.get("importance", 0))
            combined["first_seen"] = old.get("first_seen") or item.get("first_seen", "")
            combined["last_seen"] = item.get("last_seen") or old.get("last_seen", "")
            merged[target_id] = combined
        else:
            merged[target_id] = item
            title_index[normalize_title(item.get("title", ""))] = target_id
    return sorted(
        merged.values(),
        key=lambda item: (item.get("published", ""), item.get("importance", 0), item.get("title", "")),
        reverse=True,
    )[:max_items]


def count_new_records(existing: list[dict[str, Any]], incoming: list[dict[str, Any]]) -> int:
    """统计真正首次出现的条目，而不是把回溯窗口中重复抓取的条目当成新增。"""
    existing_ids = {item.get("id") for item in existing if item.get("id")}
    existing_titles = {normalize_title(item.get("title", "")) for item in existing if item.get("title")}
    seen: set[str] = set()
    count = 0
    for item in incoming:
        key = item.get("id") or normalize_title(item.get("title", ""))
        title_key = normalize_title(item.get("title", ""))
        if not key or key in seen:
            continue
        seen.add(key)
        if item.get("id") not in existing_ids and title_key not in existing_titles:
            count += 1
    return count


def main() -> int:
    parser = argparse.ArgumentParser(description="更新核物理前沿网站数据")
    parser.add_argument("--days", type=int, default=14, help="Crossref 回溯天数")
    parser.add_argument("--max-workers", type=int, default=6)
    parser.add_argument("--strict", action="store_true", help="任一类数据全部失败时返回非零")
    args = parser.parse_args()

    source_config = read_json(CONFIG / "sources.json", {})
    topic_config = read_json(CONFIG / "topics.json", {})
    runtime = read_json(CONFIG / "runtime.json", {})
    classifier = Classifier(topic_config)
    today = dt.datetime.now(dt.timezone.utc).date()
    run_at = dt.datetime.now(dt.timezone.utc).astimezone().isoformat(timespec="seconds")
    start = (today - dt.timedelta(days=args.days)).isoformat()
    end = today.isoformat()

    papers_new: list[dict[str, Any]] = []
    news_new: list[dict[str, Any]] = []
    notices_new: list[dict[str, Any]] = []
    results: list[SourceResult] = []

    jobs: list[tuple[str, dict[str, Any]]] = []
    jobs.extend(("crossref", source) for source in source_config.get("crossref_journals", []))
    jobs.extend(("arxiv", source) for source in source_config.get("arxiv_feeds", []))
    jobs.extend(("news", source) for source in source_config.get("news_feeds", []))
    jobs.extend(("notice", source) for source in source_config.get("notice_pages", []))

    def execute(job: tuple[str, dict[str, Any]]) -> tuple[list[dict[str, Any]], SourceResult]:
        started = time.perf_counter()
        kind, source = job
        if kind == "crossref":
            records, result = fetch_crossref(source, classifier, start, end)
        elif kind == "arxiv":
            records, result = fetch_arxiv(source, classifier)
        elif kind == "news":
            records, result = fetch_news(source, classifier)
        else:
            records, result = fetch_notice(source, classifier)
        result.duration_ms = round((time.perf_counter() - started) * 1000)
        return records, result

    with concurrent.futures.ThreadPoolExecutor(max_workers=args.max_workers) as pool:
        future_map = {pool.submit(execute, job): job for job in jobs}
        for future in concurrent.futures.as_completed(future_map):
            records, result = future.result()
            results.append(result)
            if result.kind == "paper":
                papers_new.extend(records)
            elif result.kind == "news":
                news_new.extend(records)
            else:
                notices_new.extend(records)
            state = "OK" if result.ok else "FAIL"
            print(f"[{state:4}] {result.kind:6} {result.name}: {result.count} {result.message}")

    existing_papers = read_json(DATA / "papers.json", [])
    existing_news = read_json(DATA / "news.json", [])
    existing_notices = read_json(DATA / "notices.json", [])
    for item in papers_new + news_new + notices_new:
        item["first_seen"] = run_at
        item["last_seen"] = run_at

    true_new_counts = {
        "papers": count_new_records(existing_papers, papers_new),
        "news": count_new_records(existing_news, news_new),
        "notices": count_new_records(existing_notices, notices_new),
    }
    max_items = int(runtime.get("daily_limit", 900)) * 20
    papers = merge_records(existing_papers, papers_new, max_items)
    paper_sources = source_config.get("crossref_journals", []) + source_config.get("arxiv_feeds", [])
    source_modes = {source["name"]: source.get("mode", "all") for source in paper_sources}
    source_weights = {source["name"]: int(source.get("weight", 3)) for source in paper_sources}
    # 所有筛选型来源都按当前规则重新门控，防止旧假阳性永久残留。
    papers = [
        paper for paper in papers
        if source_modes.get(paper.get("source"), "all") == "all"
        or classifier.relevant(
            paper.get("title", ""), paper.get("abstract", ""), source_modes.get(paper.get("source"), "filtered")
        )
    ]
    history_cutoff = (today - dt.timedelta(days=int(runtime.get("history_days", 3650)))).isoformat()
    papers = [paper for paper in papers if not paper.get("published") or paper.get("published", "")[:10] >= history_cutoff]
    # 配置中的分类词可持续改进；每日对历史记录重新分类，避免旧假阳性永久残留。
    for paper in papers:
        categories, tags = classifier.classify(
            paper.get("title", ""), paper.get("abstract", ""), paper.get("source", "")
        )
        paper["categories"] = categories
        paper["tags"] = tags
        paper["importance"], paper["score_reasons"] = classifier.importance_details(
            paper.get("title", ""), paper.get("abstract", ""), source_weights.get(paper.get("source"), 3), categories
        )
        paper.setdefault("first_seen", f"{paper.get('published', today.isoformat())}T00:00:00+00:00")
        paper.setdefault("last_seen", paper["first_seen"])
    news = merge_records(existing_news, news_new, 1500)
    notices = merge_records(existing_notices, notices_new, 1500)
    latest_day = max((paper.get("published", "")[:10] for paper in papers), default=today.isoformat())
    featured_cutoff = (dt.date.fromisoformat(latest_day) - dt.timedelta(days=14)).isoformat()
    featured_candidates = [paper for paper in papers if paper.get("published", "")[:10] >= featured_cutoff]
    featured = sorted(
        featured_candidates, key=lambda item: (item.get("importance", 0), item.get("published", "")), reverse=True
    )[:40]

    write_json(DATA / "papers.json", papers)
    write_json(DATA / "news.json", news)
    write_json(DATA / "notices.json", notices)
    write_json(DATA / "featured.json", featured)
    status = {
        "last_success": run_at,
        "window": {"from": start, "to": end},
        "source_results": [asdict(item) for item in sorted(results, key=lambda result: (result.kind, result.name))],
        "counts": {"papers": len(papers), "news": len(news), "notices": len(notices), "featured": len(featured)},
        "new_counts": true_new_counts,
        "fetched_counts": {"papers": len(papers_new), "news": len(news_new), "notices": len(notices_new)},
    }
    write_json(DATA / "status.json", status)
    print(json.dumps(status["counts"], ensure_ascii=False))

    if args.strict:
        for kind in ("paper", "news", "notice"):
            group = [result for result in results if result.kind == kind]
            if group and not any(result.ok for result in group):
                print(f"所有 {kind} 数据源均失败", file=sys.stderr)
                return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
