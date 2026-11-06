"""论文身份与版本归并；不处理新闻，不写入个人数据或译文。"""
from __future__ import annotations

from copy import deepcopy
import re
import unicodedata
from urllib.parse import unquote

from translate_content import source_hash


def doi_key(value):
    value = unquote(str(value or "")).strip().lower()
    return re.sub(r"^(?:https?://(?:dx\.)?doi\.org/|doi:\s*)", "", value)


def arxiv_key(value):
    value = unquote(str(value or "")).strip()
    value = re.sub(r"^(?:https?://(?:export\.)?arxiv\.org/(?:abs|pdf|html)/|arxiv:\s*|(?:https?://doi\.org/)?10\.48550/arxiv\.)", "", value, flags=re.I)
    value = re.sub(r"[?#].*$|\.pdf$", "", value, flags=re.I)
    value = re.sub(r"v\d+$", "", value, flags=re.I).lower()
    return value if re.fullmatch(r"(?:\d{4}\.\d{4,5}|[a-z][a-z.\-]+/\d{7})", value) else ""


def title_key(value):
    return "".join(c for c in unicodedata.normalize("NFKC", str(value or "")).casefold() if c.isalnum())


def record_ids(item):
    return list(dict.fromkeys(x for x in [item.get("id"), *item.get("record_aliases", [])] if x))


def identifiers(item):
    doi = doi_key(item.get("doi"))
    arxiv = arxiv_key(item.get("arxiv_id")) or arxiv_key(doi)
    dois = {doi} if doi and not arxiv_key(doi) else set()
    arxivs = {arxiv} if arxiv else set()
    for related in item.get("publication_links", []):
        if related.get("relation") not in {"is-preprint-of", "has-preprint"}:
            continue
        value = related.get("id", "")
        if aid := arxiv_key(value):
            arxivs.add(aid)
        elif related.get("id_type") == "doi" and doi_key(value).startswith("10."):
            dois.add(doi_key(value))
    return dois, arxivs


def authors_agree(a, b):
    def names(item):
        # 仅完整名字的标准化匹配，不凭一个常见姓氏合并。
        return {" ".join(sorted(re.findall(r"\w+", unicodedata.normalize("NFKC", name).casefold())))
                for name in item.get("authors", []) if name.strip()}
    left, right = names(a), names(b)
    overlap = left & right
    return bool(left and right and len(overlap) >= min(2, len(left), len(right))
                and len(overlap) / min(len(left), len(right)) >= 0.5)


def match_reason(a, b):
    if set(record_ids(a)) & set(record_ids(b)):
        return "record-id"
    ad, aa = identifiers(a)
    bd, ba = identifiers(b)
    # 不把勘误、回复等具有不同期刊 DOI 的文章吞进同一条。
    if (a.get("source_type") == b.get("source_type") == "journal" and a.get("doi") and b.get("doi")
            and doi_key(a["doi"]) != doi_key(b["doi"])):
        return ""
    if ad & bd:
        return "doi-or-publisher-relation"
    if aa & ba:
        return "arxiv-id"
    # 不同标识符不允许被标题相同这一弱证据推翻。
    if (ad and bd and not ad & bd) or (aa and ba and not aa & ba):
        return ""
    title = title_key(a.get("title"))
    if title and title == title_key(b.get("title")) and authors_agree(a, b):
        return "exact-title-and-authors"
    return ""


VERSION_FIELDS = (
    "id", "title", "abstract", "abstract_source", "authors", "citation_authors", "published", "updated",
    "source", "source_short", "source_type", "doi", "arxiv_id", "url", "pdf_url", "journal_abbrev",
    "volume", "issue", "pages", "numpages", "publisher", "publisher_url", "citation_metadata_checked",
)


def version_snapshot(item):
    return {**{key: deepcopy(item[key]) for key in VERSION_FIELDS if key in item}, "translation_source_hash": source_hash(item)}


def merge_pair(old, new, reason):
    old_journal, new_journal = old.get("source_type") == "journal", new.get("source_type") == "journal"
    older_refresh = old_journal == new_journal and (old.get("last_seen") or old.get("updated") or old.get("published", "")) > (new.get("last_seen") or new.get("updated") or new.get("published", ""))
    preferred, fallback = (old, new) if (old_journal and not new_journal) or older_refresh else (new, old)
    result = {**deepcopy(fallback), **deepcopy(preferred), "id": old["id"]}
    for key in VERSION_FIELDS:
        if not result.get(key) and fallback.get(key):
            result[key] = deepcopy(fallback[key])
    result["id"] = old["id"]
    result["record_aliases"] = [key for key in dict.fromkeys(record_ids(old) + record_ids(new)) if key != old["id"]]
    result["arxiv_id"] = arxiv_key(preferred.get("arxiv_id")) or arxiv_key(fallback.get("arxiv_id"))
    result["doi"] = doi_key(preferred.get("doi")) or doi_key(fallback.get("doi"))
    if result["arxiv_id"]:
        result["arxiv_url"] = f"https://arxiv.org/abs/{result['arxiv_id']}"
        result["arxiv_pdf_url"] = f"https://arxiv.org/pdf/{result['arxiv_id']}"
        result["pdf_url"] = result.get("pdf_url") or result["arxiv_pdf_url"]
    # 摘要与来源始终成对选取，优先期刊正文；不能用空字段覆盖已有摘要。
    body_owner = preferred if preferred.get("abstract") else fallback
    result["abstract"] = body_owner.get("abstract", "")
    result["abstract_source"] = body_owner.get("abstract_source", "")
    result["abstract_source_type"] = body_owner.get("abstract_source_type") or body_owner.get("source_type", "")
    result["abstract_status"] = "full" if result["abstract"] else "missing"
    for key in ("categories", "tags", "publisher_licenses"):
        result[key] = list(dict.fromkeys(old.get(key, []) + new.get(key, [])))
    result["publication_links"] = list({(r.get("relation"), r.get("id")): r for r in old.get("publication_links", []) + new.get("publication_links", [])}.values())
    result["importance"] = max(old.get("importance", 0), new.get("importance", 0))
    result["first_seen"] = min(filter(None, [old.get("first_seen"), new.get("first_seen")]), default="")
    result["last_seen"] = max(old.get("last_seen", ""), new.get("last_seen", ""))
    for key in ("figures", "figure_enrichment", "license", "arxiv_publication_checked"):
        result[key] = preferred.get(key) or fallback.get(key, [] if key == "figures" else "")
    # 保存旧无哈希译文对应的源文；译文正文与个人数据均不在此修改。
    legacy = {**new.get("translation_legacy_hashes", {}), **old.get("translation_legacy_hashes", {})}
    for item in (old, new):
        legacy.setdefault(item["id"], source_hash(item))
    result["translation_legacy_hashes"] = legacy
    if result.get("arxiv_id") or old.get("versions") or new.get("versions"):
        versions = {}
        for value in [*old.get("versions", []), *new.get("versions", []), version_snapshot(fallback), version_snapshot(preferred)]:
            kind = value.get("source_type", "")
            identifier = arxiv_key(value.get("arxiv_id")) if kind == "preprint" else doi_key(value.get("doi"))
            # 每个平台保留最新可获取元数据；不同摘要仍保留其来源，绝不拼接。
            key = (kind, identifier or value.get("id"))
            current = versions.get(key, {})
            versions[key] = {**current, **{k: v for k, v in value.items() if v not in ("", [], None)}}
        result["versions"] = list(versions.values())
        preprints = [v for v in result["versions"] if v.get("source_type") == "preprint"]
        journals = [v for v in result["versions"] if v.get("source_type") == "journal"]
        if preprints:
            result["preprint_published"] = min((v.get("published", "") for v in preprints if v.get("published")), default="")
        if journals:
            result["journal_published"] = result.get("published", "")
        if preprints and journals:
            result["publication_status"] = "published"
    result["merge_evidence"] = list(dict.fromkeys(old.get("merge_evidence", []) + new.get("merge_evidence", []) + [reason]))
    result["translation_source_hash"] = source_hash(result)
    return result


def merge_papers(existing, incoming=(), max_items=None):
    """索引归并，可在一条新关联桥接两个既有条目时保留全部旧 ID。"""
    groups, index, parent = {}, {}, {}
    def root(key):
        while key in parent:
            key = parent[key]
        return key
    def keys(item):
        dois, arxivs = identifiers(item)
        return [("id", x) for x in record_ids(item)] + [("doi", x) for x in dois] + [("arxiv", x) for x in arxivs] + [("title", title_key(item.get("title")))]
    for source in [*existing, *incoming]:
        if not source.get("id"):
            continue
        item = deepcopy(source)
        candidates = sorted({root(g) for key in keys(item) if key[1] for g in index.get(key, ())})
        matches = [(key, match_reason(groups[key], item)) for key in candidates]
        matches = [(key, reason) for key, reason in matches if reason]
        # 强关联冲突时不要通过中间条目把两个正式 DOI 误串成一篇。
        if len(matches) > 1 and any(groups[a[0]].get("source_type") == groups[b[0]].get("source_type") == "journal"
                                    and groups[a[0]].get("doi") and groups[b[0]].get("doi")
                                    and doi_key(groups[a[0]]["doi"]) != doi_key(groups[b[0]]["doi"])
                                    for i, a in enumerate(matches) for b in matches[i + 1:]):
            strong = [(key, reason) for key, reason in matches if reason == "record-id"]
            matches = strong[:1]
        if matches:
            target, reason = matches[0]
            combined = groups[target]
            for other, why in matches[1:]:
                combined = merge_pair(combined, groups.pop(other), why)
                parent[other] = target
            groups[target] = merge_pair(combined, item, reason)
        else:
            target = len(groups) + len(parent)
            groups[target] = item
        for key in keys(groups[target]):
            if key[1]:
                index.setdefault(key, set()).add(target)
    result = sorted(groups.values(), key=lambda x: (x.get("published", ""), x.get("importance", 0), x.get("title", "")), reverse=True)
    return result if max_items is None else result[:max_items]


def paper_change_counts(existing, merged):
    old = {key: item for item in existing for key in record_ids(item)}
    new, published = 0, 0
    for item in merged:
        previous = [old[key] for key in record_ids(item) if key in old]
        if not previous:
            new += 1
        elif item.get("source_type") == "journal" and all(x.get("source_type") == "preprint" for x in previous):
            published += 1
    return {"new": new, "published": published}
