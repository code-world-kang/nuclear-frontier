"""首页与论文重点选项共用的期刊组配置，不改变物理相关性采集门控。"""
import re


def normalized_name(value):
    return re.sub(r"\s+", " ", str(value or "").lower().replace(".", "")).strip()


def featured_label(item, config):
    if item.get("source_type") == "preprint":
        return ""
    names = [normalized_name(item.get(key)) for key in ("source", "source_short", "journal_abbrev")]
    doi = re.sub(r"^https?://(?:dx\.)?doi\.org/", "", str(item.get("doi", "")).lower())
    for group in config.get("groups", []):
        if (any(name and name in [normalized_name(n) for n in group.get("names", [])] for name in names)
                or any(name.startswith(normalized_name(prefix) + " ") for name in names for prefix in group.get("name_prefixes", []))
                or any(doi.startswith(prefix) for prefix in group.get("doi_prefixes", []))):
            return group["label"]
    return ""
