#!/usr/bin/env python3
"""小康康的物理世界 → Zotero 本机桥。

公开的 GitHub Pages 只把当前论文发送到本机回环地址；本程序再与
Zotero Connector 的本地服务通信。程序不需要、也不保存 Zotero API Key。
"""

from __future__ import annotations

import html
import json
import re
import urllib.error
import urllib.parse
import urllib.request
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any


BRIDGE_HOST = "127.0.0.1"
BRIDGE_PORT = 43119
ZOTERO_BASE = "http://127.0.0.1:23119"
MAX_REQUEST_BYTES = 2 * 1024 * 1024
MAX_PDF_BYTES = 100 * 1024 * 1024
ALLOWED_ORIGINS = {
    "https://code-world-kang.github.io",
    "http://127.0.0.1:4173",
    "http://localhost:4173",
}
PDF_HOST_SUFFIXES = (
    "arxiv.org",
    "aps.org",
    "cern.ch",
    "elsevier.com",
    "frontiersin.org",
    "inspirehep.net",
    "iop.org",
    "iopscience.iop.org",
    "nature.com",
    "sciencedirect.com",
    "springer.com",
    "tandfonline.com",
    "wiley.com",
)


class BridgeError(RuntimeError):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def compact(value: Any, maximum: int = 12000) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()[:maximum]


def normalized_doi(value: Any) -> str:
    doi = compact(value, 300).lower()
    doi = re.sub(r"^(?:https?://(?:dx\.)?doi\.org/|doi:\s*)", "", doi)
    return doi.rstrip(" .")


def valid_http_url(value: Any, *, https_only: bool = False) -> str:
    url = compact(value, 4000)
    if not url:
        return ""
    parsed = urllib.parse.urlsplit(url)
    schemes = {"https"} if https_only else {"http", "https"}
    if parsed.scheme not in schemes or not parsed.hostname or parsed.username or parsed.password:
        raise BridgeError("链接格式不安全，已拒绝读取")
    return url


def allowed_pdf_url(value: Any) -> str:
    url = valid_http_url(value, https_only=True)
    if not url:
        return ""
    host = (urllib.parse.urlsplit(url).hostname or "").lower().rstrip(".")
    if not any(host == suffix or host.endswith(f".{suffix}") for suffix in PDF_HOST_SUFFIXES):
        return ""
    return url


def zotero_request(
    path: str,
    *,
    payload: Any | None = None,
    body: bytes | None = None,
    headers: dict[str, str] | None = None,
    method: str | None = None,
    timeout: int = 25,
) -> tuple[int, bytes, dict[str, str]]:
    request_headers = {
        "X-Zotero-Connector-API-Version": "3",
        "User-Agent": "NuclearFrontierZoteroBridge/1.0",
    }
    if headers:
        request_headers.update(headers)
    if payload is not None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        request_headers["Content-Type"] = "application/json"
    request = urllib.request.Request(
        f"{ZOTERO_BASE}{path}", data=body, headers=request_headers, method=method
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, response.read(), dict(response.headers.items())
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")[:400]
        raise BridgeError(f"Zotero 拒绝了请求（{exc.code}）：{detail}", 502) from exc
    except (urllib.error.URLError, TimeoutError, ConnectionError) as exc:
        raise BridgeError("无法连接 Zotero，请确认 Zotero 桌面端已打开", 503) from exc


def zotero_health() -> dict[str, Any]:
    status, _, headers = zotero_request("/connector/ping", method="GET", timeout=3)
    return {
        "ok": status == 200,
        "zotero_version": headers.get("X-Zotero-Version", ""),
        "connector_api": headers.get("X-Zotero-Connector-API-Version", ""),
    }


def local_items(query: str) -> list[dict[str, Any]]:
    params = urllib.parse.urlencode(
        {"q": query, "itemType": "-attachment", "format": "json", "limit": 100}
    )
    _, body, _ = zotero_request(f"/api/users/0/items?{params}", method="GET")
    try:
        result = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return []
    return result if isinstance(result, list) else []


def find_existing(item: dict[str, Any]) -> dict[str, Any] | None:
    doi = normalized_doi(item.get("doi"))
    title = compact(item.get("title"), 1000).casefold()
    # Zotero 本地 API 的 q 主要检索题名/创作者/年份，不保证命中 DOI。
    # 因此先用题名召回候选条目，再对 DOI 或完整题名做精确比对。
    if not title:
        return None
    for record in local_items(title):
        data = record.get("data", record) if isinstance(record, dict) else {}
        record_doi = normalized_doi(data.get("DOI"))
        record_title = compact(data.get("title"), 1000).casefold()
        if (doi and record_doi == doi) or (not doi and title and record_title == title):
            return data
    return None


def creator_for(author: Any) -> dict[str, str] | None:
    name = compact(author, 300)
    if not name:
        return None
    if "," in name:
        last, first = [part.strip() for part in name.split(",", 1)]
        return {"creatorType": "author", "firstName": first, "lastName": last}
    return {"creatorType": "author", "firstName": "", "lastName": name}


def note_html(item: dict[str, Any]) -> str:
    note = str(item.get("note") or "").strip()[:12000]
    remarks = str(item.get("remarks") or "").strip()[:4000]
    translated_title = compact(item.get("title_zh"), 2000)
    parts = ["<p><strong>小康康的物理世界</strong></p>"]
    if translated_title:
        parts.append(f"<p><strong>中文题名：</strong>{html.escape(translated_title)}</p>")
    if note:
        parts.append(f"<p><strong>我的笔记：</strong><br>{html.escape(note).replace(chr(10), '<br>')}</p>")
    if remarks:
        parts.append(f"<p><strong>备注：</strong><br>{html.escape(remarks).replace(chr(10), '<br>')}</p>")
    parts.append(
        f'<p><a href="{html.escape(valid_http_url(item.get("url")))}">'
        "来自小康康的物理世界</a></p>"
    )
    return "".join(parts)


def zotero_item(item: dict[str, Any]) -> dict[str, Any]:
    title = compact(item.get("title"), 4000)
    if not title:
        raise BridgeError("论文题名为空，无法保存")
    source_type = compact(item.get("source_type"), 50)
    is_preprint = source_type == "preprint"
    creators = [creator_for(author) for author in (item.get("authors") or [])]
    tags = []
    seen = set()
    for value in [*(item.get("categories") or []), *(item.get("tags") or []), *(item.get("keywords") or [])]:
        value = compact(value, 200)
        key = value.casefold()
        if value and key not in seen:
            seen.add(key)
            tags.append({"tag": value})
    record: dict[str, Any] = {
        "id": compact(item.get("id"), 200) or uuid.uuid4().hex,
        "itemType": "preprint" if is_preprint else "journalArticle",
        "title": title,
        "creators": [value for value in creators if value],
        "date": compact(item.get("published"), 100),
        "DOI": normalized_doi(item.get("doi")),
        "url": valid_http_url(item.get("url")),
        "abstractNote": str(item.get("abstract") or "").strip()[:50000],
        "language": compact(item.get("language"), 50) or "en",
        "tags": tags,
        "notes": [{"note": note_html(item)}],
    }
    if is_preprint:
        record.update(
            {
                "repository": compact(item.get("source"), 1000),
                "archiveID": compact(item.get("arxiv_id"), 300),
            }
        )
    else:
        record.update(
            {
                "publicationTitle": compact(item.get("source"), 1000),
                "journalAbbreviation": compact(item.get("source_short"), 300),
                "volume": compact(item.get("volume"), 100),
                "issue": compact(item.get("issue"), 100),
                "pages": compact(item.get("pages"), 300),
            }
        )
    return record


class SafePDFRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: N802
        if not allowed_pdf_url(newurl):
            raise BridgeError("PDF 跳转到未信任的地址，已停止下载", 502)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def download_pdf(url: str) -> tuple[bytes, str]:
    opener = urllib.request.build_opener(SafePDFRedirect())
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 NuclearFrontierZoteroBridge/1.0",
            "Accept": "application/pdf,application/octet-stream;q=0.9,*/*;q=0.2",
        },
    )
    try:
        with opener.open(request, timeout=45) as response:
            content_length = int(response.headers.get("Content-Length") or 0)
            if content_length > MAX_PDF_BYTES:
                raise BridgeError("PDF 超过 100 MB，已跳过附件下载", 413)
            data = response.read(MAX_PDF_BYTES + 1)
            final_url = response.geturl()
    except BridgeError:
        raise
    except (urllib.error.URLError, TimeoutError, ValueError) as exc:
        raise BridgeError("无法下载这篇论文的 PDF", 502) from exc
    if len(data) > MAX_PDF_BYTES:
        raise BridgeError("PDF 超过 100 MB，已跳过附件下载", 413)
    if not data.lstrip().startswith(b"%PDF"):
        raise BridgeError("PDF 链接返回的不是 PDF 文件", 502)
    return data, final_url


def save_direct_pdf(session_id: str, connector_id: str, title: str, url: str) -> bool:
    data, final_url = download_pdf(url)
    metadata = json.dumps(
        {
            "sessionID": session_id,
            "parentItemID": connector_id,
            "title": f"{title} - PDF",
            "url": final_url,
        },
        ensure_ascii=True,
        separators=(",", ":"),
    )
    status, _, _ = zotero_request(
        "/connector/saveAttachment",
        body=data,
        headers={
            "Content-Type": "application/pdf",
            "Content-Length": str(len(data)),
            "X-Metadata": metadata,
        },
        method="POST",
        timeout=90,
    )
    return status == 201


def save_resolved_pdf(session_id: str, connector_id: str) -> bool:
    resolver_payload = {"sessionID": session_id, "itemID": connector_id}
    _, body, _ = zotero_request("/connector/hasAttachmentResolvers", payload=resolver_payload, method="POST")
    if body.decode("utf-8", "replace").strip().lower() != "true":
        return False
    status, _, _ = zotero_request(
        "/connector/saveAttachmentFromResolver", payload=resolver_payload, method="POST", timeout=90
    )
    return status == 201


def save_to_zotero(item: dict[str, Any]) -> dict[str, Any]:
    zotero_health()
    existing = find_existing(item)
    if existing:
        return {
            "ok": True,
            "already_exists": True,
            "metadata_saved": True,
            "note_saved": False,
            "pdf_saved": False,
            "pdf_method": "existing",
            "message": "Zotero 中已有这篇论文，未重复创建",
        }

    record = zotero_item(item)
    session_id = f"nuclear-frontier-{uuid.uuid4().hex}"
    payload = {
        "sessionID": session_id,
        "uri": record.get("url") or "https://code-world-kang.github.io/nuclear-frontier/",
        "items": [record],
    }
    status, _, _ = zotero_request("/connector/saveItems", payload=payload, method="POST", timeout=45)
    if status != 201:
        raise BridgeError("Zotero 未能创建论文条目", 502)

    pdf_saved = False
    pdf_method = "none"
    pdf_error = ""
    pdf_url = allowed_pdf_url(item.get("pdf_url"))
    if pdf_url:
        try:
            pdf_saved = save_direct_pdf(session_id, record["id"], record["title"], pdf_url)
            pdf_method = "direct" if pdf_saved else "none"
        except BridgeError as exc:
            pdf_error = str(exc)
    if not pdf_saved:
        try:
            pdf_saved = save_resolved_pdf(session_id, record["id"])
            if pdf_saved:
                pdf_method = "resolver"
                pdf_error = ""
        except BridgeError as exc:
            pdf_error = pdf_error or str(exc)

    return {
        "ok": True,
        "already_exists": False,
        "metadata_saved": True,
        "note_saved": True,
        "pdf_saved": pdf_saved,
        "pdf_method": pdf_method,
        "pdf_error": pdf_error,
        "message": (
            "已保存论文、笔记和 PDF 到 Zotero"
            if pdf_saved
            else "已保存论文和笔记；暂未找到可保存的 PDF"
        ),
    }


class BridgeHandler(BaseHTTPRequestHandler):
    server_version = "NuclearFrontierZoteroBridge/1.0"

    def log_message(self, _format: str, *args: Any) -> None:
        # 不记录论文题名、笔记或备注。
        return

    def allowed_origin(self) -> str:
        origin = self.headers.get("Origin", "")
        return origin if origin in ALLOWED_ORIGINS else ""

    def cors_headers(self, origin: str) -> None:
        self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Private-Network", "true")

    def send_json(self, status: int, payload: dict[str, Any], origin: str = "") -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        if origin:
            self.cors_headers(origin)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:  # noqa: N802
        origin = self.allowed_origin()
        if not origin:
            self.send_json(403, {"ok": False, "message": "未授权的网站来源"})
            return
        self.send_response(204)
        self.cors_headers(origin)
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Nuclear-Frontier-Bridge")
        self.send_header("Access-Control-Max-Age", "600")
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        origin = self.allowed_origin()
        if self.path != "/health":
            self.send_json(404, {"ok": False, "message": "未找到该接口"}, origin)
            return
        if self.headers.get("Origin") and not origin:
            self.send_json(403, {"ok": False, "message": "未授权的网站来源"})
            return
        try:
            result = {"bridge": True, **zotero_health()}
            self.send_json(200, result, origin)
        except BridgeError as exc:
            self.send_json(exc.status, {"ok": False, "bridge": True, "message": str(exc)}, origin)

    def do_POST(self) -> None:  # noqa: N802
        origin = self.allowed_origin()
        if self.path != "/save":
            self.send_json(404, {"ok": False, "message": "未找到该接口"}, origin)
            return
        if not origin or self.headers.get("X-Nuclear-Frontier-Bridge") != "1":
            self.send_json(403, {"ok": False, "message": "未授权的保存请求"})
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
            if length <= 0 or length > MAX_REQUEST_BYTES:
                raise BridgeError("请求大小不符合要求", 413)
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            if not isinstance(payload, dict) or not isinstance(payload.get("item"), dict):
                raise BridgeError("论文数据格式不正确")
            result = save_to_zotero(payload["item"])
            self.send_json(200, result, origin)
        except (UnicodeDecodeError, json.JSONDecodeError):
            self.send_json(400, {"ok": False, "message": "JSON 数据格式不正确"}, origin)
        except BridgeError as exc:
            self.send_json(exc.status, {"ok": False, "message": str(exc)}, origin)
        except Exception:
            self.send_json(500, {"ok": False, "message": "本机 Zotero 桥发生未预期错误"}, origin)


def main() -> None:
    server = ThreadingHTTPServer((BRIDGE_HOST, BRIDGE_PORT), BridgeHandler)
    print(f"Zotero bridge listening on http://{BRIDGE_HOST}:{BRIDGE_PORT}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
