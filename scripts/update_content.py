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
import unicodedata
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
ARXIV_REQUEST_LOCK = threading.Lock()
ARXIV_LAST_REQUEST = 0.0
ARXIV_MIN_INTERVAL_SECONDS = 3.1
ARXIV_FIGURE_HOSTS = frozenset({"arxiv.org", "export.arxiv.org"})
FIGURE_RETRY_COOLDOWNS = {
    "source_timeout": dt.timedelta(days=1),
    "extraction_failed": dt.timedelta(days=7),
    "no_figures": dt.timedelta(days=30),
}

# 每日通知只保留物理学相关内容，核物理、束流实验和涉核会议优先。
# 生物、医学和化学即使同时出现“核”“辐射”等字样也不进入通知流。
NOTICE_NON_PHYSICS_TERMS = (
    "生物", "医学", "医疗", "临床", "疾病", "癌症", "肿瘤", "药物", "制药", "药品", "传染病",
    "细胞", "基因", "rna", "蛋白", "糖质", "代谢", "心脑血管", "生命科学", "农业", "育种",
    "化学", "化工", "催化", "生态", "ecosystem", "biology", "biological", "biomedical", "medicine",
    "medical", "clinical", "disease", "cancer", "tumor", "drug", "pharmaceutical", "chemistry", "chemical",
    "health", "life science", "agriculture",
)
NOTICE_PHYSICS_TERMS = (
    "物理", "数学物理科学部", "核物理", "原子核", "核结构", "核反应", "核衰变", "核谱学", "核数据",
    "核探测", "核电子学", "核技术", "核能", "放射性核束", "稀有同位素", "重离子", "离子束", "束流",
    "加速器", "探测器", "中子", "质子束", "辐射", "射线", "同步辐射", "自由电子激光", "阿秒",
    "粒子物理", "高能物理", "中微子", "暗物质", "强相互作用", "量子", "凝聚态", "拓扑物态",
    "超导", "等离子体", "聚变", "天体物理", "空间物理", "宇宙学", "天文", "引力", "相对论",
    "光学", "激光", "声学", "低温", "统计物理", "热物理", "流体物理", "爆轰", "qcd",
    "physics", "nuclear", "atomic nucleus", "nuclear structure", "nuclear reaction", "nuclear decay",
    "radioactive beam", "rare isotope", "heavy ion", "ion beam", "beam time", "beam proposal", "accelerator",
    "detector", "neutron", "proton beam", "radiation", "synchrotron", "free electron laser", "particle physics",
    "high energy", "neutrino", "dark matter", "quantum", "condensed matter", "superconduct", "plasma", "fusion",
    "astrophysics", "astronomy", "cosmology", "gravity", "relativity", "optics", "laser", "acoustics", "qcd",
)
NOTICE_TRUSTED_PHYSICS_CATEGORIES = frozenset({"beam-domestic", "beam-international", "meetings-nuclear"})


def notice_is_physics_relevant(
    title: str,
    summary: str = "",
    *,
    notice_category: str = "",
    scope: str = "",
) -> bool:
    """严格筛选物理通知；明确的生物、医学和化学主题直接排除。"""
    title_text = unicodedata.normalize("NFKC", title or "").lower()
    detail_text = unicodedata.normalize("NFKC", " ".join([title or "", summary or "", scope or ""])).lower()
    if any(term in detail_text for term in NOTICE_NON_PHYSICS_TERMS):
        return False
    if notice_category in NOTICE_TRUSTED_PHYSICS_CATEGORIES:
        return True
    return any(term in title_text for term in NOTICE_PHYSICS_TERMS)


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


def fetch_arxiv_resource(url: str, *, accept: str = "*/*", attempts: int = 3) -> bytes:
    """arXiv 要求 API/RSS 单连接且请求间隔不小于 3 秒。"""
    global ARXIV_LAST_REQUEST
    last_error: Exception | None = None
    for _ in range(attempts):
        with ARXIV_REQUEST_LOCK:
            wait = ARXIV_MIN_INTERVAL_SECONDS - (time.monotonic() - ARXIV_LAST_REQUEST)
            if wait > 0:
                time.sleep(wait)
            try:
                payload = fetch(url, accept=accept, attempts=1)
                return payload
            except Exception as exc:  # noqa: BLE001 - 由外层统一重试和记录
                last_error = exc
            finally:
                ARXIV_LAST_REQUEST = time.monotonic()
    raise RuntimeError(str(last_error) if last_error else "arXiv request failed")


def clean_text(value: str | None) -> str:
    if not value:
        return ""
    value = re.sub(r"<[^>]+>", " ", value)
    value = html.unescape(value)
    return re.sub(r"\s+", " ", value).strip()


def normalize_title(value: str) -> str:
    """生成用于去重的 Unicode 标题键。

    ``str.isalnum`` 会保留中文、希腊字母等 Unicode 字母数字；NFKC
    则让全角字符等兼容形式在比较前归一化。
    """
    normalized = unicodedata.normalize("NFKC", value or "").casefold()
    return "".join(character for character in normalized if character.isalnum())[:220]


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


class PageMetadataParser(HTMLParser):
    """提取通知详情页中的描述和可见文本。

    只用于识别官方发布日期、截止日期与短介，不保存或镜像原文全文。
    """

    def __init__(self) -> None:
        super().__init__()
        self.description = ""
        self.parts: list[str] = []
        self.headings: list[str] = []
        self.heading_parts: list[str] = []
        self.heading_depth = 0
        self.ignored_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        lowered = tag.lower()
        values = {str(key).lower(): value or "" for key, value in attrs}
        if lowered in {"script", "style", "svg", "noscript"}:
            self.ignored_depth += 1
        if lowered in {"h1", "h2", "h3"}:
            self.heading_depth += 1
            self.heading_parts = []
        if lowered == "meta":
            key = (values.get("name") or values.get("property") or "").lower()
            if key in {"description", "og:description"} and not self.description:
                self.description = clean_text(values.get("content"))

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() in {"script", "style", "svg", "noscript"} and self.ignored_depth:
            self.ignored_depth -= 1
        if tag.lower() in {"h1", "h2", "h3"} and self.heading_depth:
            heading = clean_text(" ".join(self.heading_parts))
            if heading:
                self.headings.append(heading)
            self.heading_depth -= 1
            self.heading_parts = []

    def handle_data(self, data: str) -> None:
        if not self.ignored_depth:
            value = clean_text(data)
            if value:
                self.parts.append(value)
                if self.heading_depth:
                    self.heading_parts.append(value)

    @property
    def visible_text(self) -> str:
        return clean_text(" ".join(self.parts))


DATE_PATTERN = re.compile(r"(?<!\d)(20\d{2})\s*[年./-]\s*(\d{1,2})\s*[月./-]\s*(\d{1,2})\s*日?", re.I)
DEADLINE_PATTERNS = (
    re.compile(r"(?:截止(?:日期|时间)?|申请截止|申报截止|报名截止|受理时间[^\u3002；;]{0,24}?(?:至|到))\s*[:：为]?\s*(20\d{2}\s*[年./-]\s*\d{1,2}\s*[月./-]\s*\d{1,2}\s*日?)", re.I),
    re.compile(r"(?:申请|申报|受理|报名)时间[^\u3002；;]{0,80}?(?:至|到|[-–—])\s*(20\d{2}\s*[年./-]\s*\d{1,2}\s*[月./-]\s*\d{1,2}\s*日?)", re.I),
    re.compile(r"(?:deadline|closes?|due\s+date|applications?\s+(?:are\s+)?due|proposal\s+submission\s+deadline)\s*(?:is|on|:)?\s*((?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?[,]?\s+20\d{2}|\d{1,2}(?:st|nd|rd|th)?\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+20\d{2}|20\d{2}[-/.]\d{1,2}[-/.]\d{1,2})", re.I),
    re.compile(r"(?:submitted|received|apply)[^.]{0,100}?(?:by|before|until)\s*(?:\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?\s*[A-Z]{2,5}\s*(?:on)?)?\s*(\d{1,2}(?:st|nd|rd|th)?\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+20\d{2}|(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2},?\s+20\d{2})", re.I),
)


def extract_notice_date(value: str) -> str:
    matches = list(DATE_PATTERN.finditer(value or ""))
    if not matches:
        return iso_date(value)
    # 很多列表项的排列为“截止时间 发布时间 标题”，发布日期通常是最后一个。
    match = matches[-1]
    try:
        return dt.date(int(match.group(1)), int(match.group(2)), int(match.group(3))).isoformat()
    except ValueError:
        return ""


def extract_deadline(value: str) -> str:
    """从中英文官方通知中识别明确的截止日期。"""
    text_value = clean_text(value)
    for pattern in DEADLINE_PATTERNS:
        match = pattern.search(text_value)
        if not match:
            continue
        candidate = re.sub(r"(\d)(?:st|nd|rd|th)\b", r"\1", match.group(1), flags=re.I)
        parsed = extract_notice_date(candidate)
        if parsed:
            return parsed
        for fmt in ("%B %d, %Y", "%B %d %Y", "%b %d, %Y", "%b %d %Y", "%d %B %Y", "%d %b %Y"):
            try:
                return dt.datetime.strptime(candidate, fmt).date().isoformat()
            except ValueError:
                pass
    return ""


def extract_english_notice_date(value: str) -> str:
    month = r"(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)"
    match = re.search(rf"\b(\d{{1,2}}\s+{month}\s+20\d{{2}}|{month}\s+\d{{1,2}},?\s+20\d{{2}})\b", value or "", re.I)
    if not match:
        return ""
    candidate = match.group(1).replace(",", "")
    for fmt in ("%d %B %Y", "%d %b %Y", "%B %d %Y", "%b %d %Y"):
        try:
            return dt.datetime.strptime(candidate, fmt).date().isoformat()
        except ValueError:
            pass
    return ""


def notice_date_from_url(url: str) -> str:
    match = re.search(r"(?:^|[/_-])t?(20\d{2})(\d{2})(\d{2})(?:[_/.-]|$)", url, re.I)
    if not match:
        return ""
    try:
        return dt.date(int(match.group(1)), int(match.group(2)), int(match.group(3))).isoformat()
    except ValueError:
        return ""


def notice_detail_metadata(url: str, title: str = "") -> dict[str, Any]:
    """读取少量新通知的详情页，失败时安全退回列表页元数据。"""
    raw = fetch(url, accept="text/html", attempts=1).decode("utf-8", errors="replace")
    parser = PageMetadataParser()
    parser.feed(raw)
    visible = parser.visible_text[:30000]
    description = ""
    if title:
        candidates: list[tuple[int, str]] = []
        for match in re.finditer(re.escape(title), visible, re.I):
            candidate = clean_text(visible[match.end():match.end() + 900])
            lowered = candidate[:220].lower()
            if candidate.startswith("|") or "skip to main content" in lowered:
                continue
            content_terms = ("申请", "申报", "截止", "受理", "用户", "issued", "invites", "submitted", "deadline")
            navigation_terms = ("search the site", "downloads", "resources", "leadership", "careers")
            score = sum(term in candidate.lower() for term in content_terms) * 3
            score -= sum(term in candidate.lower() for term in navigation_terms) * 2
            candidates.append((score, candidate))
        if candidates:
            description = max(candidates, key=lambda value: value[0])[1]
    if not description and parser.description:
        title_terms = [term for term in re.split(r"\W+", title.lower()) if len(term) >= 4]
        if not title_terms or any(term in parser.description.lower() for term in title_terms[:5]):
            description = parser.description
    if not description:
        sentences = [clean_text(part) for part in re.split(r"[。！？!?]", visible)]
        description = next((part for part in sentences if 45 <= len(part) <= 420), "")
    deadline = extract_deadline(visible)
    if deadline and not any(term in description.lower() for term in ("截止", "申请时间", "deadline", "submitted")):
        context = re.search(r"[^.。]{0,260}(?:截止|申请时间|deadline|submitted)[^.。]{0,520}[.。]?", visible, re.I)
        if context:
            description = clean_text(context.group(0))
    return {
        "summary": description[:500],
        "published": notice_date_from_url(url) or extract_notice_date(visible[:5000]) or extract_english_notice_date(visible[:5000]),
        "deadline": deadline,
        "headings": parser.headings,
    }


class ArxivFigureParser(HTMLParser):
    """提取 arXiv HTML 中的原始图与图注；许可判定在上层完成。"""

    def __init__(self) -> None:
        super().__init__()
        self.current: dict[str, Any] | None = None
        self.figure_depth = 0
        self.caption_depth = 0
        self.figures: list[dict[str, Any]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        lowered = tag.lower()
        if lowered == "figure" and self.current is None:
            self.current = {"id": values.get("id", ""), "images": [], "caption_parts": []}
            self.figure_depth = 1
            return
        if self.current is None:
            return
        if lowered == "figure":
            self.figure_depth += 1
        elif lowered == "img":
            src = values.get("src") or ""
            if src and not src.startswith("data:"):
                self.current["images"].append({
                    "src": src,
                    "alt": values.get("alt") or "",
                    "width": values.get("width") or "",
                    "height": values.get("height") or "",
                })
        elif lowered == "figcaption":
            self.caption_depth += 1

    def handle_data(self, data: str) -> None:
        if self.current is not None and self.caption_depth:
            self.current["caption_parts"].append(data)

    def handle_endtag(self, tag: str) -> None:
        if self.current is None:
            return
        lowered = tag.lower()
        if lowered == "figcaption" and self.caption_depth:
            self.caption_depth -= 1
        elif lowered == "figure":
            self.figure_depth -= 1
            if self.figure_depth == 0:
                if self.current["images"]:
                    self.current["caption"] = clean_text(" ".join(self.current["caption_parts"]))
                    self.figures.append(self.current)
                self.current = None


class Classifier:
    def __init__(self, config: dict[str, Any]) -> None:
        self.categories = config["categories"]
        self.priority_terms = [item.lower() for item in config["priority_terms"]]
        self.nuclear_gate = [item.lower() for item in config["nuclear_gate"]]
        self.physics_gate = [item.lower() for item in config.get("physics_gate", [])]
        self.ai_gate = [item.lower() for item in config["ai_gate"]]
        self.category_priorities = {item["id"]: int(item.get("priority", 0)) for item in self.categories}

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

    def category_hits_allowed(self, category_id: str, text: str, hits: list[str], source: str) -> bool:
        """对容易与粒子衰变、天文多极矩或生物细胞核混淆的类别加上语境门控。"""
        lowered = text.lower()
        source_lower = source.lower()
        core_source = any(name in source_lower for name in (
            "physical review c", "nuclear physics a", "european physical journal a", "journal of physics g",
            "chinese physics c", "nuclear science and techniques", "international journal of modern physics e",
            "progress in particle and nuclear physics", "annual review of nuclear and particle", "arxiv nucl-",
        ))
        nuclear_context = self.match_count(lowered, [
            "nuclear physics", "nuclear structure", "nuclear reaction", "nuclear decay", "nuclear matter",
            "nucleus", "nuclei", "nuclide", "isotope", "radioactive", "nucleon", "neutron-rich", "proton-rich",
        ]) > 0

        if category_id == "nuclear-decay":
            strong = {
                "nuclear decay", "radioactive decay", "alpha decay", "beta decay", "beta-decay", "double beta decay",
                "neutrinoless double beta", "electron capture", "internal conversion", "decay spectroscopy",
                "decay scheme", "decay curve", "beta-delayed neutron", "beta delayed neutron",
                "beta-delayed proton", "beta delayed proton", "beta-delayed alpha", "proton emission",
                "two-proton emission", "spontaneous fission", "isomeric transition",
            }
            decay_context = self.match_count(lowered, [
                "decay", "half-life", "half life", "radioactive", "unstable nucleus", "isomer", "decay width",
            ]) > 0
            return any(hit.lower() in strong for hit in hits) or (nuclear_context and decay_context)

        if category_id == "nuclear-structure":
            strong = {
                "nuclear structure", "nuclear spectroscopy", "shell evolution", "magic number", "giant resonance",
                "halo nucleus", "drip line", "exotic nuclei", "charge radii", "nuclear deformation",
                "shape coexistence", "nuclear isomer", "metastable nuclear state", "b(e2)", "level scheme",
                "reduced transition probability",
            }
            if any(hit.lower() in strong for hit in hits):
                return True
            if any(term in lowered for term in ("galactic nucleus", "active galactic nucleus", "nuclear star cluster")) and not core_source:
                return False
            return core_source or nuclear_context

        if category_id in {"experimental-nuclear", "theoretical-nuclear"}:
            return core_source or nuclear_context or "lattice qcd" in [hit.lower() for hit in hits]
        return True

    def classify(
        self, title: str, abstract: str, source: str = "", default_categories: Iterable[str] | None = None
    ) -> tuple[list[str], list[str]]:
        text = f"{title} {abstract} {source}".lower()
        scored: list[tuple[int, int, str, str]] = []
        tags: list[str] = []
        for category in self.categories:
            hits = [term for term in category["keywords"] if self.contains_term(text, term)]
            if hits and self.category_hits_allowed(category["id"], text, hits, source):
                scored.append((len(hits), int(category.get("priority", 0)), category["id"], category["name"]))
                tags.extend(hits[:3])
        scored.sort(key=lambda item: (-item[0], -item[1], item[3]))
        category_ids = [item[2] for item in scored[:4]]
        supplied = [category for category in (default_categories or []) if category in self.category_priorities]
        # nucl-ex/nucl-th 以及专门探测器源的方法先验可与内容主题并存；
        # “核物理综合”仅在内容无法细分时作保守回退。
        for category in supplied:
            if category != "nuclear-general" and category not in category_ids:
                category_ids.append(category)
        category_ids.sort(key=lambda category: self.category_priorities.get(category, 0), reverse=True)
        category_ids = category_ids[:4]
        if not category_ids:
            source_defaults = (
                (("arxiv nucl-ex",), "experimental-nuclear"),
                (("arxiv nucl-th",), "theoretical-nuclear"),
                (("physical review c", "nuclear physics a", "european physical journal a", "journal of physics g", "chinese physics c", "nuclear science and techniques", "international journal of modern physics e"), "nuclear-general"),
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
            category_ids = supplied or [next((category for names, category in source_defaults if any(name in source.lower() for name in names)), "frontiers")]
        return category_ids, list(dict.fromkeys(tags))[:8]

    def infer_methods(self, title: str, abstract: str, source: str = "") -> list[str]:
        text = f"{title} {abstract} {source}".lower()
        methods: list[str] = []
        experimental = ["measurement", "experiment", "spectroscopy", "measured", "detector", "data acquisition", "beam time"]
        theoretical = ["theory", "theoretical", "calculation", "shell model", "density functional", "ab initio", "simulation", "prediction"]
        if "nucl-ex" in source.lower() or self.match_count(text, experimental):
            methods.append("experimental")
        if "nucl-th" in source.lower() or self.match_count(text, theoretical):
            methods.append("theoretical")
        if self.match_count(text, ["review", "overview", "progress in", "status report"]):
            methods.append("review")
        return list(dict.fromkeys(methods))

    def classification_details(
        self, title: str, abstract: str, source: str = "", default_categories: Iterable[str] | None = None
    ) -> dict[str, Any]:
        categories, tags = self.classify(title, abstract, source, default_categories)
        evidence_count = len(tags)
        confidence = min(0.98, 0.48 + evidence_count * 0.08) if evidence_count else 0.38
        return {
            "categories": categories,
            "primary_topic": categories[0] if categories else "frontiers",
            "methods": self.infer_methods(title, abstract, source),
            "tags": tags,
            "classification_confidence": round(confidence, 2),
            "classification_evidence": tags[:6],
        }

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
        score = base * 8
        reasons = [f"来源权重 +{base * 8}"]
        research_bonus = max((self.category_priorities.get(category, 0) for category in categories), default=0)
        if research_bonus:
            score += research_bonus
            reasons.append(f"核物理研究侧重 +{research_bonus}")
        priority_hits = self.match_count(text, self.priority_terms)
        if priority_hits:
            bonus = min(20, priority_hits * 8)
            score += bonus
            reasons.append(f"突破性表述 +{bonus}")
        if len(categories) > 1:
            bonus = min(6, (len(categories) - 1) * 2)
            score += bonus
            reasons.append(f"跨领域关联 +{bonus}")
        if abstract:
            score += 2
            reasons.append("完整摘要 +2")
        return min(score, 100), reasons

    def importance(self, title: str, abstract: str, base: int, categories: list[str]) -> int:
        return self.importance_details(title, abstract, base, categories)[0]


def crossref_url(issn: str, start: str, end: str) -> str:
    params = {
        "filter": f"from-pub-date:{start},until-pub-date:{end},type:journal-article",
        "select": "DOI,title,author,published,published-online,published-print,URL,container-title,short-container-title,abstract,subject,type,license,link,relation,volume,issue,page,article-number,publisher,resource",
        "rows": "500",
        "sort": "published",
        "order": "desc",
    }
    return f"https://api.crossref.org/journals/{urllib.parse.quote(issn)}/works?{urllib.parse.urlencode(params)}"


def citation_page_count(value: str) -> str:
    """仅在页码是明确的纯数字区间时计算总页数，避免把文章编号误判为页数。"""
    match = re.fullmatch(r"\s*(\d+)\s*[-–—]\s*(\d+)\s*", value or "")
    if not match:
        return ""
    first, last = (int(part) for part in match.groups())
    return str(last - first + 1) if last >= first else ""


def crossref_citation_fields(item: dict[str, Any]) -> dict[str, Any]:
    """提取生成完整 BibTeX 所需的结构化出版元数据。"""
    citation_authors = []
    for author in item.get("author", []):
        family = clean_text(author.get("family", ""))
        given = clean_text(author.get("given", ""))
        name = ", ".join(filter(None, [family, given]))
        if name:
            citation_authors.append(name)
    pages = clean_text(item.get("page") or item.get("article-number"))
    resource = item.get("resource") or {}
    publisher_url = ((resource.get("primary") or {}).get("URL") or "").strip()
    return {
        "citation_authors": citation_authors[:40],
        "journal_abbrev": clean_text((item.get("short-container-title") or [""])[0]),
        "volume": clean_text(item.get("volume")),
        "issue": clean_text(item.get("issue")),
        "pages": pages,
        "numpages": citation_page_count(item.get("page", "")),
        "publisher": clean_text(item.get("publisher")),
        "publisher_url": publisher_url,
        "citation_metadata_checked": True,
    }


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
            classification_text = " ".join(filter(None, [abstract, " ".join(item.get("subject") or [])]))
            classification = classifier.classification_details(
                title, classification_text, source["name"], source.get("default_categories")
            )
            categories, tags = classification["categories"], classification["tags"]
            authors = []
            for author in item.get("author", []):
                name = " ".join(filter(None, [author.get("given", ""), author.get("family", "")])).strip()
                if name:
                    authors.append(name)
            published = iso_date(item.get("published-online") or item.get("published-print") or item.get("published"))
            doi = item.get("DOI", "")
            url = item.get("URL") or (f"https://doi.org/{doi}" if doi else "")
            importance, score_reasons = classifier.importance_details(title, abstract, source["weight"], categories)
            publisher_licenses = [entry.get("URL", "") for entry in item.get("license", []) if entry.get("URL")]
            records.append({
                "id": stable_id("doi", doi) if doi else stable_id(title, published, source["short"]),
                "type": "paper",
                "title": title,
                "abstract": abstract,
                "abstract_status": "full" if abstract else "missing",
                "abstract_source": "Crossref" if abstract else "",
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
                "primary_topic": classification["primary_topic"],
                "methods": classification["methods"],
                "classification_confidence": classification["classification_confidence"],
                "classification_evidence": classification["classification_evidence"],
                "importance": importance,
                "score_reasons": score_reasons,
                "open_access": None,
                "license": "",
                "publisher_licenses": publisher_licenses,
                "rights_status": "unknown",
                "figures": [],
                "figure_status": "rights_unknown",
                **crossref_citation_fields(item),
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
        rights = xml_text(node, ["rights", "license"])
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
            output.append({"title": title, "summary": summary, "published": published, "creator": creator, "url": link, "rights": rights})
    return output


def fetch_feed_items(url: str, attempts: int = 3) -> list[dict[str, str]]:
    """同时重试网络与 XML 解析，应对 CDN 偶发返回截断或污染内容。"""
    last_error: Exception | None = None
    for attempt in range(attempts):
        try:
            raw = fetch(url, accept="application/rss+xml, application/xml, text/xml", attempts=1)
            return parse_feed_items(raw)
        except (ET.ParseError, RuntimeError) as exc:
            last_error = exc
            if attempt + 1 < attempts:
                time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(str(last_error) if last_error else "feed parsing failed")


def fetch_arxiv_feed_items(url: str, attempts: int = 3) -> list[dict[str, str]]:
    """与通用 RSS 解析相同，但所有 arXiv 请求经过全局串行限速。"""
    last_error: Exception | None = None
    for _ in range(attempts):
        try:
            raw = fetch_arxiv_resource(
                url, accept="application/rss+xml, application/xml, text/xml", attempts=1
            )
            return parse_feed_items(raw)
        except (ET.ParseError, RuntimeError) as exc:
            last_error = exc
    raise RuntimeError(str(last_error) if last_error else "arXiv feed parsing failed")


def clean_arxiv_abstract(value: str) -> str:
    """移除 RSS 在摘要前附加的 arXiv 编号与公告类型，保留完整原文摘要。"""
    return re.sub(
        r"^arXiv:\S+\s+Announce\s+Type:\s*\S+\s+Abstract:\s*", "", clean_text(value), flags=re.I
    ).strip()


def reusable_license(value: str) -> bool:
    """首版仅允许 CC0 和不带 NC/ND/SA 限制的 CC BY。"""
    lowered = (value or "").lower().replace("http://", "https://")
    return (
        "creativecommons.org/publicdomain/zero/" in lowered
        or re.search(r"creativecommons\.org/licenses/by/\d", lowered) is not None
    )


def license_label(value: str) -> str:
    lowered = (value or "").lower()
    if "publicdomain/zero" in lowered:
        return "CC0"
    match = re.search(r"licenses/by/(\d(?:\.\d)?)", lowered)
    return f"CC BY {match.group(1)}" if match else "授权未核实"


def is_arxiv_figure_url(value: str) -> bool:
    """图片必须使用 arXiv 自有主机的 HTTPS URL。"""
    try:
        parsed = urllib.parse.urlsplit(value)
    except ValueError:
        return False
    return parsed.scheme.lower() == "https" and (parsed.hostname or "").lower() in ARXIV_FIGURE_HOSTS


def caption_has_third_party_risk(caption: str) -> bool:
    """保守过滤图注中明示的第三方来源线索。

    这是自动风险筛查，不是对图片权利的最终保证。
    """
    patterns = (
        r"\breprinted\s+with\s+permission\b",
        r"\b(?:reproduced|reprinted|adapted|modified)\b",
        r"\b(?:image|photo|figure)?\s*credits?\s*:",
        r"\b(?:image|photo)\s+(?:credits?|courtesy|by)\b",
        r"\bimages?\s*:",
        r"\b(?:from|after)\s+ref(?:erence)?\.?\s*(?:\[|\d)",
        r"\btaken\s+from\b",
        r"\bcourtesy\b",
        r"\bcopyright\b",
        r"\bpermission\b",
        r"\bsource\s*:",
        r"©",
    )
    return any(re.search(pattern, caption, flags=re.I) for pattern in patterns)


def filter_arxiv_figures(figures: Any) -> list[dict[str, Any]]:
    """清理抓取结果与旧数据；仅保留 arXiv 主机且无明示风险线索的候选图。"""
    if not isinstance(figures, list):
        return []
    filtered: list[dict[str, Any]] = []
    for figure in figures:
        if not isinstance(figure, dict):
            continue
        caption = str(figure.get("caption", ""))
        if (
            caption
            and is_arxiv_figure_url(str(figure.get("url", "")))
            and not caption_has_third_party_risk(caption)
        ):
            filtered.append(figure)
    return filtered[:2]


def figure_rank(caption: str, index: int) -> tuple[int, list[str]]:
    lowered = caption.lower()
    score = max(0, 8 - index)
    reasons: list[str] = []
    groups = [
        (("main result", "result", "measured", "measurement", "data", "comparison", "constraint"), 18, "主要结果或数据比较"),
        (("spectrum", "cross section", "angular distribution", "excitation function", "yield", "correlation"), 17, "关键实验观测量"),
        (("level scheme", "energy level", "decay scheme", "half-life", "transition probability", "b(e2)"), 17, "核结构或衰变关键图"),
        (("detector", "efficiency", "resolution", "calibration", "setup", "apparatus", "data acquisition"), 13, "探测器、装置或性能"),
        (("theory", "model", "calculation", "prediction", "fit"), 10, "理论、模型或拟合比较"),
    ]
    for terms, bonus, reason in groups:
        if any(term in lowered for term in terms):
            score += bonus
            reasons.append(reason)
    return score, reasons or ["论文前部主图"]


def parse_arxiv_figures(raw: bytes, html_url: str, paper: dict[str, Any]) -> list[dict[str, Any]]:
    if not reusable_license(paper.get("license", "")):
        return []
    parser = ArxivFigureParser()
    parser.feed(raw.decode("utf-8", errors="replace"))
    candidates: list[dict[str, Any]] = []
    for index, figure in enumerate(parser.figures):
        caption = figure.get("caption", "")
        if not caption or caption_has_third_party_risk(caption):
            continue
        image = figure["images"][0]
        image_url = urllib.parse.urljoin(html_url, image["src"])
        # 绝对 URL、协议相对 URL 和异常基地址都经过主机白名单；
        # 因此第三方 CDN/出版社图像不会进入结果。
        if not is_arxiv_figure_url(image_url):
            continue
        score, reasons = figure_rank(caption, index)
        label_match = re.search(r"\bFigure\s+\d+[A-Za-z]?", caption, re.I)
        label = label_match.group(0) if label_match else f"关键图 {index + 1}"
        source_url = f"{html_url}#{figure['id']}" if figure.get("id") else html_url
        author_text = ", ".join(paper.get("authors", [])[:3])
        if len(paper.get("authors", [])) > 3:
            author_text += " 等"
        candidates.append({
            "url": image_url,
            "caption": caption,
            "label": label,
            "source_url": source_url,
            "provider": f"arXiv · {license_label(paper.get('license', ''))}",
            "license": paper.get("license", ""),
            "attribution": f"{author_text or '原文作者'}，arXiv:{paper.get('arxiv_id', '')}，{label}，{license_label(paper.get('license', ''))}",
            "importance_score": score,
            "rank_reason": reasons,
        })
    candidates.sort(key=lambda item: item["importance_score"], reverse=True)
    return filter_arxiv_figures(candidates)


def parse_timestamp(value: str) -> dt.datetime | None:
    """容错解析 ISO 8601 时间，统一转为 UTC 便于冷却期比较。"""
    if not value:
        return None
    try:
        parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=dt.timezone.utc)
    return parsed.astimezone(dt.timezone.utc)


def figure_retry_due(paper: dict[str, Any], now: dt.datetime) -> bool:
    """新任务立即处理；已检查失败按失败类型冷却后再试。"""
    status = paper.get("figure_status") or "pending"
    if status not in FIGURE_RETRY_COOLDOWNS:
        return True
    metadata = paper.get("figure_enrichment")
    if not isinstance(metadata, dict):
        return True
    checked_at = parse_timestamp(str(metadata.get("checked_at", "")))
    if checked_at is None:
        return True
    return now - checked_at >= FIGURE_RETRY_COOLDOWNS[status]


def record_figure_attempt(paper: dict[str, Any], status: str, now: dt.datetime) -> None:
    """记录本次尝试和下次可重试时间。"""
    previous = paper.get("figure_enrichment")
    metadata = dict(previous) if isinstance(previous, dict) else {}
    try:
        attempts = int(metadata.get("attempts", 0)) + 1
    except (TypeError, ValueError):
        attempts = 1
    metadata.update({"status": status, "checked_at": now.isoformat(), "attempts": attempts})
    cooldown = FIGURE_RETRY_COOLDOWNS.get(status)
    if cooldown is None:
        metadata.pop("retry_after", None)
    else:
        metadata["retry_after"] = (now + cooldown).isoformat()
    paper["figure_enrichment"] = metadata


def enrich_arxiv_figures(
    papers: list[dict[str, Any]], limit: int = 16, run_at: str | None = None
) -> dict[str, int]:
    """仅处理明确 CC0/CC BY 的候选图；自动筛查不代替人工权利核验。"""
    now = parse_timestamp(run_at or "") or dt.datetime.now(dt.timezone.utc)
    licensed = [
        paper for paper in papers
        if paper.get("arxiv_id") and reusable_license(paper.get("license", "")) and not paper.get("figures")
    ]
    candidates = [paper for paper in licensed if figure_retry_due(paper, now)]
    candidates.sort(
        key=lambda paper: (
            paper.get("figure_status") not in FIGURE_RETRY_COOLDOWNS,
            max((22 if category == "nuclear-decay" else 20 if category == "nuclear-structure" else 18 if category in ("experimental-nuclear", "nuclear-reactions") else 17 if category == "detectors-daq" else 15 if category == "theoretical-nuclear" else 0 for category in paper.get("categories", [])), default=0),
            paper.get("importance", 0), paper.get("published", "")
        ),
        reverse=True,
    )
    stats = {
        "checked": 0,
        "ready": 0,
        "no_figures": 0,
        "failed": 0,
        "deferred": len(licensed) - len(candidates),
        "skipped": max(0, len(candidates) - max(0, limit)),
    }
    for paper in candidates[:max(0, limit)]:
        html_url = f"https://arxiv.org/html/{paper['arxiv_id']}"
        stats["checked"] += 1
        try:
            raw = fetch_arxiv_resource(html_url, accept="text/html", attempts=2)
            figures = parse_arxiv_figures(raw, html_url, paper)
            paper["figures"] = figures
            paper["figure_status"] = "ready" if figures else "no_figures"
            stats["ready"] += int(bool(figures))
            stats["no_figures"] += int(not figures)
        except Exception as exc:  # noqa: BLE001 - 图像是非阻断式增强
            error = str(exc).lower()
            paper["figure_status"] = "source_timeout" if "timeout" in error or "timed out" in error else "extraction_failed"
            stats["failed"] += 1
        record_figure_attempt(paper, paper["figure_status"], now)
    return stats


def normalized_doi(value: str) -> str:
    return re.sub(r"^https?://(?:dx\.)?doi\.org/", "", (value or "").strip(), flags=re.I).lower()


def enrich_missing_abstracts(
    papers: list[dict[str, Any]], run_at: str, limit: int = 240, batch_size: int = 20
) -> dict[str, int]:
    """
    使用 INSPIRE 的公开学术元数据补齐 DOI 记录摘要。

    未命中记录 30 天后再试，避免每日重复查询尚未入库的新 DOI。
    """
    now = dt.datetime.fromisoformat(run_at)

    def due(paper: dict[str, Any]) -> bool:
        if paper.get("abstract") or not paper.get("doi"):
            return False
        checked = paper.get("abstract_enrichment", {}).get("checked_at", "")
        if not checked:
            return True
        try:
            return now - dt.datetime.fromisoformat(checked) >= dt.timedelta(days=30)
        except ValueError:
            return True

    candidates = sorted(
        [paper for paper in papers if due(paper)],
        key=lambda paper: (paper.get("published", ""), paper.get("importance", 0)), reverse=True,
    )[:limit]
    stats = {"checked": 0, "enriched": 0, "not_found": 0, "failed_batches": 0, "remaining": 0}
    for offset in range(0, len(candidates), batch_size):
        batch = candidates[offset:offset + batch_size]
        query = " or ".join(f"doi:{paper['doi']}" for paper in batch)
        url = "https://inspirehep.net/api/literature?" + urllib.parse.urlencode({"q": query, "size": batch_size})
        try:
            payload = json.loads(fetch(url, accept="application/json", attempts=3))
        except Exception:  # noqa: BLE001 - 补全源失败不阻断日更，且不标记以便下次重试
            stats["failed_batches"] += 1
            continue
        found: dict[str, dict[str, Any]] = {}
        for hit in payload.get("hits", {}).get("hits", []):
            metadata = hit.get("metadata", {})
            abstract = next((clean_text(item.get("value", "")) for item in metadata.get("abstracts", []) if item.get("value")), "")
            arxiv_id = next((item.get("value", "") for item in metadata.get("arxiv_eprints", []) if item.get("value")), "")
            for entry in metadata.get("dois", []):
                doi = normalized_doi(entry.get("value", ""))
                if doi:
                    found[doi] = {"abstract": abstract, "arxiv_id": arxiv_id}
        for paper in batch:
            stats["checked"] += 1
            match = found.get(normalized_doi(paper.get("doi", "")), {})
            abstract = match.get("abstract", "")
            if abstract:
                paper["abstract"] = abstract
                paper["abstract_status"] = "full"
                paper["abstract_source"] = "INSPIRE"
                paper["abstract_enrichment"] = {"status": "ready", "checked_at": run_at, "source": "INSPIRE"}
                arxiv_id = match.get("arxiv_id", "")
                if arxiv_id and not paper.get("arxiv_id"):
                    paper["arxiv_id"] = arxiv_id
                    paper["pdf_url"] = f"https://arxiv.org/pdf/{arxiv_id}"
                stats["enriched"] += 1
            else:
                paper["abstract_enrichment"] = {"status": "not_found", "checked_at": run_at, "source": "INSPIRE"}
                stats["not_found"] += 1
        if offset + batch_size < len(candidates):
            time.sleep(0.8)
    stats["remaining"] = sum(1 for paper in papers if due(paper))
    return stats


def fetch_arxiv(source: dict[str, Any], classifier: Classifier) -> tuple[list[dict[str, Any]], SourceResult]:
    url = f"https://rss.arxiv.org/rss/{urllib.parse.quote(source['category'])}"
    try:
        items = fetch_arxiv_feed_items(url)
        records: list[dict[str, Any]] = []
        for item in items:
            title, abstract = item["title"], clean_arxiv_abstract(item["summary"])
            if not classifier.relevant(title, abstract, source["mode"]):
                continue
            classification = classifier.classification_details(
                title, abstract, source["name"], source.get("default_categories")
            )
            categories, tags = classification["categories"], classification["tags"]
            arxiv_id = extract_arxiv_id(item["url"])
            published = iso_date(item["published"])
            importance, score_reasons = classifier.importance_details(title, abstract, source["weight"], categories)
            records.append({
                "id": stable_id("arxiv", arxiv_id) if arxiv_id else stable_id(title, published, source["category"]),
                "type": "paper",
                "title": title,
                "abstract": abstract,
                "abstract_status": "full" if abstract else "missing",
                "abstract_source": "arXiv RSS" if abstract else "",
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
                "primary_topic": classification["primary_topic"],
                "methods": classification["methods"],
                "classification_confidence": classification["classification_confidence"],
                "classification_evidence": classification["classification_evidence"],
                "importance": importance,
                "score_reasons": score_reasons,
                "open_access": True,
                "license": item.get("rights", ""),
                "publisher_licenses": [],
                "rights_status": "reusable" if reusable_license(item.get("rights", "")) else "source_restricted",
                "figures": [],
                "figure_status": "pending" if reusable_license(item.get("rights", "")) else "license_blocked",
            })
        if source["mode"] == "important-ai":
            records.sort(key=lambda item: (item["importance"], item["published"]), reverse=True)
            records = records[: int(source.get("limit", 6))]
        return records, SourceResult(source["name"], "paper", True, len(records))
    except Exception as exc:  # noqa: BLE001
        return [], SourceResult(source["name"], "paper", False, 0, str(exc)[:240])


def fetch_news(source: dict[str, Any], classifier: Classifier) -> tuple[list[dict[str, Any]], SourceResult]:
    try:
        items = fetch_feed_items(source["url"])
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
        raw = fetch(
            source["url"], accept="text/html", attempts=max(1, int(source.get("attempts", 2)))
        ).decode("utf-8", errors="replace")
        parser = AnchorParser()
        parser.feed(raw)
        include = [term.lower() for term in source["include"]]
        records: list[dict[str, Any]] = []
        seen: set[str] = set()
        for href, title in parser.links:
            if len(title) < int(source.get("min_title_length", 12)) or not any(term in title.lower() for term in include):
                continue
            required = [value.lower() for value in source.get("require_any", [])]
            if required and not any(term in title.lower() for term in required):
                continue
            url = urllib.parse.urljoin(source["url"], href)
            parsed_url = urllib.parse.urlsplit(url)
            if parsed_url.scheme not in {"http", "https"} or not parsed_url.hostname:
                continue
            if any(term in title.lower() for term in [value.lower() for value in source.get("exclude", [])]):
                continue
            if source.get("kind", "notice") == "notice" and not notice_is_physics_relevant(
                title,
                notice_category=source.get("notice_category", "funding-national"),
                scope=source.get("scope", ""),
            ):
                continue
            if url in seen:
                continue
            seen.add(url)
            title_dates = [extract_notice_date(match.group(0)) for match in DATE_PATTERN.finditer(title)]
            published = notice_date_from_url(url) or extract_notice_date(title)
            title_deadline = ""
            if source.get("title_date_order") == "deadline-published" and len(title_dates) >= 2:
                title_deadline, published = title_dates[0], title_dates[-1]
                cleaned_title = re.sub(
                    r"^(?:20\d{2}[-/.]\d{1,2}[-/.]\d{1,2}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?\s*){2}",
                    "", title,
                ).strip()
                title = cleaned_title or title
            categories, tags = classifier.classify(title, "", source["name"])
            record_kind = source.get("kind", "notice")
            importance, score_reasons = classifier.importance_details(title, "", source["weight"], categories)
            records.append({
                "id": stable_id("notice", url),
                "type": record_kind,
                "title": title,
                "summary": "",
                "published": published,
                "deadline": title_deadline,
                "source": source["name"],
                "source_url": source["url"],
                "url": url,
                "notice_category": source.get("notice_category", "funding-national"),
                "scope": source.get("scope", ""),
                "categories": categories,
                "tags": tags,
                "importance": importance,
                "score_reasons": score_reasons,
            })
            if len(records) >= int(source.get("limit", 30)):
                break
        # 仅读取每个来源最新的少量详情页，提取截止日期与官方简介。
        detail_limit = max(0, int(source.get("detail_limit", 2)))
        detail_candidates = sorted(
            records,
            key=lambda item: (item.get("published", ""), item.get("importance", 0)),
            reverse=True,
        )[:detail_limit]
        for record in detail_candidates:
            try:
                details = notice_detail_metadata(record["url"], record["title"])
            except Exception:  # noqa: BLE001 - 列表元数据仍可用
                continue
            record["summary"] = details.get("summary", "")
            record["published"] = record.get("published") or details.get("published", "")
            record["deadline"] = record.get("deadline") or details.get("deadline", "")
            if source.get("prefer_detail_heading"):
                heading = next((
                    value for value in details.get("headings", [])
                    if len(value) >= 12 and any(term in value.lower() for term in include)
                ), "")
                if heading:
                    record["title"] = heading
        records = [
            record for record in records
            if notice_is_physics_relevant(
                record.get("title", ""),
                record.get("summary", ""),
                notice_category=record.get("notice_category", ""),
                scope=record.get("scope", ""),
            )
        ]
        return records, SourceResult(source["name"], source.get("kind", "notice"), True, len(records))
    except Exception as exc:  # noqa: BLE001
        return [], SourceResult(source["name"], source.get("kind", "notice"), False, 0, str(exc)[:240])


def merge_records(existing: list[dict[str, Any]], incoming: list[dict[str, Any]], max_items: int) -> list[dict[str, Any]]:
    merged: dict[str, dict[str, Any]] = {}
    for item in existing:
        if not item.get("id"):
            continue
        sanitized = dict(item)
        if "figures" in sanitized:
            sanitized["figures"] = filter_arxiv_figures(sanitized["figures"])
            if not sanitized["figures"] and sanitized.get("figure_status") == "ready":
                sanitized["figure_status"] = "pending"
        merged[item["id"]] = sanitized
    title_index: dict[str, str] = {}
    for item in existing:
        title_key = normalize_title(item.get("title", ""))
        # 纯标点等标题会得到空键；空键不具备去重语义。
        if item.get("id") and title_key:
            title_index[title_key] = item["id"]
    for item in incoming:
        title_key = normalize_title(item.get("title", ""))
        duplicate_id = title_index.get(title_key) if title_key else None
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
            for field in ("citation_authors", "journal_abbrev", "volume", "issue", "pages", "numpages", "publisher", "publisher_url"):
                combined[field] = item.get(field) or old.get(field, [] if field == "citation_authors" else "")
            combined["citation_metadata_checked"] = bool(item.get("citation_metadata_checked") or old.get("citation_metadata_checked"))
            # 新元数据缺失时不得覆盖已有的完整摘要、许可证据与已筛选图像。
            combined["abstract"] = item.get("abstract") or old.get("abstract", "")
            combined["abstract_status"] = "full" if combined["abstract"] else "missing"
            combined["abstract_source"] = item.get("abstract_source") or old.get("abstract_source", "")
            combined["license"] = item.get("license") or old.get("license", "")
            combined["publisher_licenses"] = list(dict.fromkeys(old.get("publisher_licenses", []) + item.get("publisher_licenses", [])))
            combined["figures"] = filter_arxiv_figures(old.get("figures") or item.get("figures", []))
            old_figure_status = old.get("figure_status", "")
            combined["figure_status"] = "ready" if combined["figures"] else (
                old_figure_status if old_figure_status in FIGURE_RETRY_COOLDOWNS
                else item.get("figure_status") or old_figure_status or "rights_unknown"
            )
            figure_enrichment = old.get("figure_enrichment") or item.get("figure_enrichment")
            if figure_enrichment:
                combined["figure_enrichment"] = figure_enrichment
            else:
                combined.pop("figure_enrichment", None)
            combined["rights_status"] = "reusable" if reusable_license(combined["license"]) else (item.get("rights_status") or old.get("rights_status", "unknown"))
            combined["categories"] = list(dict.fromkeys(old.get("categories", []) + item.get("categories", [])))[:4]
            combined["tags"] = list(dict.fromkeys(old.get("tags", []) + item.get("tags", [])))[:10]
            combined["importance"] = max(old.get("importance", 0), item.get("importance", 0))
            combined["first_seen"] = old.get("first_seen") or item.get("first_seen", "")
            combined["last_seen"] = item.get("last_seen") or old.get("last_seen", "")
            if combined.get("type") == "notice":
                # 详情页偶尔受限时，空值不得覆盖之前已核验的元数据。
                for field in ("summary", "published", "deadline", "notice_category", "source_url", "scope"):
                    combined[field] = item.get(field) or old.get(field, "")
            merged[target_id] = combined
        else:
            merged[target_id] = item
        if title_key:
            title_index[title_key] = target_id
    return sorted(
        merged.values(),
        key=lambda item: (item.get("published", ""), item.get("importance", 0), item.get("title", "")),
        reverse=True,
    )[:max_items]


def count_new_records(existing: list[dict[str, Any]], incoming: list[dict[str, Any]]) -> int:
    """统计真正首次出现的条目，而不是把回溯窗口中重复抓取的条目当成新增。"""
    existing_ids = {item.get("id") for item in existing if item.get("id")}
    existing_titles = {
        title_key for item in existing
        if (title_key := normalize_title(item.get("title", "")))
    }
    seen: set[str] = set()
    count = 0
    for item in incoming:
        key = item.get("id") or normalize_title(item.get("title", ""))
        title_key = normalize_title(item.get("title", ""))
        if not key or key in seen:
            continue
        seen.add(key)
        if item.get("id") not in existing_ids and (not title_key or title_key not in existing_titles):
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
    source_default_categories = {source["name"]: source.get("default_categories", []) for source in paper_sources}
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
    abstract_stats = enrich_missing_abstracts(
        papers, run_at, int(runtime.get("abstract_enrichment_limit", 240))
    )
    # 配置中的分类词可持续改进；每日对历史记录重新分类，避免旧假阳性永久残留。
    for paper in papers:
        if paper.get("source_type") == "preprint" and paper.get("abstract"):
            paper["abstract"] = clean_arxiv_abstract(paper["abstract"])
        classification = classifier.classification_details(
            paper.get("title", ""), paper.get("abstract", ""), paper.get("source", ""),
            source_default_categories.get(paper.get("source", ""), []),
        )
        categories = classification["categories"]
        paper.update(classification)
        paper["importance"], paper["score_reasons"] = classifier.importance_details(
            paper.get("title", ""), paper.get("abstract", ""), source_weights.get(paper.get("source"), 3), categories
        )
        paper["abstract_status"] = "full" if paper.get("abstract") else "missing"
        paper.setdefault("abstract_source", "arXiv RSS" if paper.get("source_type") == "preprint" and paper.get("abstract") else "")
        paper.setdefault("license", "")
        paper.setdefault("publisher_licenses", [])
        original_figures = paper.get("figures", [])
        paper["figures"] = filter_arxiv_figures(original_figures)
        figures_removed = bool(original_figures) and len(paper["figures"]) < len(original_figures)
        paper["rights_status"] = "reusable" if reusable_license(paper.get("license", "")) else paper.get("rights_status", "unknown")
        if paper.get("figures") and not reusable_license(paper.get("license", "")):
            paper["figures"] = []
            paper["figure_status"] = "license_blocked"
        elif paper.get("figures"):
            paper["figure_status"] = "ready"
        elif figures_removed and reusable_license(paper.get("license", "")):
            paper["figure_status"] = "pending"
        else:
            paper.setdefault("figure_status", "pending" if reusable_license(paper.get("license", "")) else "rights_unknown")
        paper.setdefault("first_seen", f"{paper.get('published', today.isoformat())}T00:00:00+00:00")
        paper.setdefault("last_seen", paper["first_seen"])
    figure_stats = enrich_arxiv_figures(
        papers, int(runtime.get("figure_enrichment_limit", 16)), run_at=run_at
    )
    news = merge_records(existing_news, news_new, 1500)
    notices = merge_records(existing_notices, notices_new, 1500)
    notice_source_categories = {
        source["name"]: source.get("notice_category", "funding-national")
        for source in source_config.get("notice_pages", []) if source.get("kind", "notice") == "notice"
    }
    notice_source_urls = {
        source["name"]: source.get("url", "")
        for source in source_config.get("notice_pages", []) if source.get("kind", "notice") == "notice"
    }
    for notice in notices:
        notice.setdefault("notice_category", notice_source_categories.get(notice.get("source", ""), "funding-national"))
        notice.setdefault("source_url", notice_source_urls.get(notice.get("source", ""), ""))
        notice.setdefault("scope", "")
        notice.setdefault("deadline", "")
    notice_terms = {
        source["name"]: [term.lower() for term in source.get("include", [])]
        for source in source_config.get("notice_pages", []) if source.get("kind", "notice") == "notice"
    }
    notice_exclude_terms = {
        source["name"]: [term.lower() for term in source.get("exclude", [])]
        for source in source_config.get("notice_pages", []) if source.get("kind", "notice") == "notice"
    }
    notice_required_terms = {
        source["name"]: [term.lower() for term in source.get("require_any", [])]
        for source in source_config.get("notice_pages", []) if source.get("kind", "notice") == "notice"
    }
    # 通知来源收紧规则后，同步清理历史中的导航链接和普通新闻页。
    notices = [
        notice for notice in notices
        if notice.get("source") not in notice_terms
        or any(term in notice.get("title", "").lower() for term in notice_terms[notice.get("source")])
    ]
    notices = [
        notice for notice in notices
        if not any(term in notice.get("title", "").lower() for term in notice_exclude_terms.get(notice.get("source", ""), []))
    ]
    notices = [
        notice for notice in notices
        if not notice_required_terms.get(notice.get("source", ""))
        or any(term in notice.get("title", "").lower() for term in notice_required_terms[notice.get("source", "")])
    ]
    notices = [
        notice for notice in notices
        if notice_is_physics_relevant(
            notice.get("title", ""),
            notice.get("summary", ""),
            notice_category=notice.get("notice_category", ""),
            scope=notice.get("scope", ""),
        )
    ]
    latest_day = max((paper.get("published", "")[:10] for paper in papers), default=today.isoformat())
    featured_cutoff = (dt.date.fromisoformat(latest_day) - dt.timedelta(days=14)).isoformat()
    featured_candidates = [paper for paper in papers if paper.get("published", "")[:10] >= featured_cutoff]
    def research_priority(item: dict[str, Any]) -> int:
        return max((classifier.category_priorities.get(category, 0) for category in item.get("categories", [])), default=0)

    core_featured = sorted(
        [paper for paper in featured_candidates if research_priority(paper) >= 15],
        key=lambda item: (item.get("importance", 0), research_priority(item), item.get("published", "")), reverse=True,
    )[:32]
    selected_ids = {paper["id"] for paper in core_featured}
    broad_featured = sorted(
        [paper for paper in featured_candidates if paper["id"] not in selected_ids],
        key=lambda item: (item.get("importance", 0), research_priority(item), item.get("published", "")), reverse=True,
    )[:8]
    featured = core_featured + broad_featured

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
        "figure_enrichment": figure_stats,
        "abstract_enrichment": abstract_stats,
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
