#!/usr/bin/env python3
"""将已生成的科研简报写入微信公众号草稿箱并提交发布。

凭据只从环境变量读取，不写入日志、数据文件或 Git 仓库。
默认只检查本地稿件；必须显式传入 --publish 才会调用微信 API。
"""

from __future__ import annotations

import argparse
import html
import json
import mimetypes
import os
import re
import sys
import uuid
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
DIGEST_DIR = ROOT / "wechat-official-account"
DEFAULT_COVER = ROOT / "wechat-official-account" / "cover.png"
API_BASE = "https://api.weixin.qq.com/cgi-bin"
COVER_NAME = "nuclear-frontier-wechat-cover.png"


class WechatAPIError(RuntimeError):
    """微信公众平台 API 返回的可诊断错误。"""


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def api_json(
    path: str,
    *,
    query: dict[str, str] | None = None,
    payload: dict[str, Any] | None = None,
    timeout: int = 30,
) -> dict[str, Any]:
    url = f"{API_BASE}/{path.lstrip('/')}"
    if query:
        url += "?" + urlencode(query)
    data = None
    headers = {"User-Agent": "nuclear-frontier-wechat-publisher/1.0"}
    if payload is not None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json; charset=utf-8"
    try:
        with urlopen(Request(url, data=data, headers=headers), timeout=timeout) as response:
            result = json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        raise WechatAPIError(f"微信 API HTTP {error.code}：{body[:300]}") from error
    except (URLError, TimeoutError) as error:
        raise WechatAPIError(f"无法连接微信 API：{error}") from error
    if result.get("errcode") not in (None, 0):
        raise WechatAPIError(
            f"微信 API 错误 {result.get('errcode')}：{result.get('errmsg', '未知错误')}"
        )
    return result


def get_access_token(app_id: str, app_secret: str) -> str:
    result = api_json(
        "token",
        query={"grant_type": "client_credential", "appid": app_id, "secret": app_secret},
    )
    token = result.get("access_token", "")
    if not token:
        raise WechatAPIError("微信 API 未返回 access_token。")
    return token


def multipart_file(field: str, path: Path, filename: str) -> tuple[bytes, str]:
    boundary = "----nuclear-frontier-" + uuid.uuid4().hex
    mime = mimetypes.guess_type(filename)[0] or "application/octet-stream"
    body = bytearray()
    body.extend(f"--{boundary}\r\n".encode())
    body.extend(
        f'Content-Disposition: form-data; name="{field}"; filename="{filename}"\r\n'.encode()
    )
    body.extend(f"Content-Type: {mime}\r\n\r\n".encode())
    body.extend(path.read_bytes())
    body.extend(f"\r\n--{boundary}--\r\n".encode())
    return bytes(body), boundary


def upload_cover(access_token: str, cover_path: Path) -> str:
    body, boundary = multipart_file("media", cover_path, COVER_NAME)
    url = f"{API_BASE}/material/add_material?" + urlencode(
        {"access_token": access_token, "type": "image"}
    )
    request = Request(
        url,
        data=body,
        headers={
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "User-Agent": "nuclear-frontier-wechat-publisher/1.0",
        },
    )
    try:
        with urlopen(request, timeout=60) as response:
            result = json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        raise WechatAPIError(f"上传封面失败：HTTP {error.code}") from error
    except (URLError, TimeoutError) as error:
        raise WechatAPIError(f"上传封面时无法连接微信 API：{error}") from error
    if result.get("errcode") not in (None, 0):
        raise WechatAPIError(
            f"上传封面失败 {result.get('errcode')}：{result.get('errmsg', '未知错误')}"
        )
    media_id = result.get("media_id", "")
    if not media_id:
        raise WechatAPIError("微信 API 未返回封面 media_id。")
    return media_id


def find_existing_cover(access_token: str) -> str:
    offset = 0
    while offset < 200:
        result = api_json(
            "material/batchget_material",
            query={"access_token": access_token},
            payload={"type": "image", "offset": offset, "count": 20},
        )
        items = result.get("item") or []
        for item in items:
            if item.get("name") == COVER_NAME:
                return item.get("media_id", "")
        offset += len(items)
        if not items or offset >= int(result.get("total_count") or 0):
            break
    return ""


def extract_article_fragment(document: str) -> str:
    match = re.search(r"<main\b[^>]*>(.*)</main>", document, flags=re.I | re.S)
    if not match:
        raise ValueError("公众号简报缺少 <main> 正文。")
    return match.group(1).strip()


def sanitize_article_html(fragment: str) -> str:
    # 公众号正文对外部超链接有限制；将稿件中的链接降级为带样式文字，
    # 唯一的站外入口由 content_source_url（阅读原文）承担。
    fragment = re.sub(r"<a\b[^>]*>", "<span>", fragment, flags=re.I)
    fragment = re.sub(r"</a>", "</span>", fragment, flags=re.I)
    fragment = re.sub(r"<script\b[^>]*>.*?</script>", "", fragment, flags=re.I | re.S)
    return fragment.strip()


def iter_titles(payload: dict[str, Any]) -> list[str]:
    titles: list[str] = []
    for item in payload.get("item") or []:
        content = item.get("content") or {}
        for article in content.get("news_item") or []:
            if article.get("title"):
                titles.append(str(article["title"]))
    return titles


def already_exists(access_token: str, title: str) -> bool:
    for endpoint in ("draft/batchget", "freepublish/batchget"):
        result = api_json(
            endpoint,
            query={"access_token": access_token},
            payload={"offset": 0, "count": 20, "no_content": 0},
        )
        if title in iter_titles(result):
            return True
    return False


def add_draft(
    access_token: str,
    *,
    title: str,
    author: str,
    digest: str,
    content: str,
    source_url: str,
    thumb_media_id: str,
) -> str:
    result = api_json(
        "draft/add",
        query={"access_token": access_token},
        payload={
            "articles": [
                {
                    "title": title,
                    "author": author,
                    "digest": digest,
                    "content": content,
                    "content_source_url": source_url,
                    "thumb_media_id": thumb_media_id,
                    "need_open_comment": 0,
                    "only_fans_can_comment": 0,
                }
            ]
        },
    )
    media_id = result.get("media_id", "")
    if not media_id:
        raise WechatAPIError("新建草稿成功，但未获得草稿 media_id。")
    return media_id


def submit_publish(access_token: str, media_id: str) -> str:
    result = api_json(
        "freepublish/submit",
        query={"access_token": access_token},
        payload={"media_id": media_id},
    )
    publish_id = result.get("publish_id", "")
    if not publish_id:
        raise WechatAPIError("发布已提交，但未获得 publish_id。")
    return publish_id


def prepare_article() -> dict[str, str]:
    metadata = read_json(DIGEST_DIR / "metadata.json")
    document = (DIGEST_DIR / "index.html").read_text(encoding="utf-8")
    counts = metadata.get("counts") or {}
    digest = (
        f"核物理每日科研简报：{counts.get('papers', 0)} 篇论文、"
        f"{counts.get('news', 0)} 条物理新闻、{counts.get('notices', 0)} 条科研通知。"
    )
    return {
        "title": str(metadata["title"]),
        "digest": digest[:120],
        "content": sanitize_article_html(extract_article_fragment(document)),
        "source_url": str(metadata.get("site_url") or "https://code-world-kang.github.io/nuclear-frontier/"),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="发布微信公众号每日科研简报")
    parser.add_argument("--publish", action="store_true", help="实际调用微信 API 创建草稿并提交发布")
    parser.add_argument("--cover", type=Path, default=DEFAULT_COVER, help="公众号封面 PNG/JPEG")
    args = parser.parse_args()

    article = prepare_article()
    if not args.cover.is_file():
        raise SystemExit(f"缺少公众号封面：{args.cover}")
    if not args.publish:
        print(
            f"草稿检查通过：{article['title']} / "
            f"HTML {len(article['content'])} 字符（未连接公众号）"
        )
        return 0

    app_id = os.environ.get("WECHAT_OFFICIAL_APP_ID", "").strip()
    app_secret = os.environ.get("WECHAT_OFFICIAL_APP_SECRET", "").strip()
    author = os.environ.get("WECHAT_OFFICIAL_AUTHOR", "").strip() or "小康康"
    if not app_id or not app_secret:
        raise SystemExit("缺少 WECHAT_OFFICIAL_APP_ID 或 WECHAT_OFFICIAL_APP_SECRET。")

    try:
        access_token = get_access_token(app_id, app_secret)
        if already_exists(access_token, article["title"]):
            print(f"今日公众号简报已存在，跳过重复发布：{article['title']}")
            return 0
        thumb_media_id = find_existing_cover(access_token) or upload_cover(access_token, args.cover)
        draft_media_id = add_draft(
            access_token,
            title=article["title"],
            author=author,
            digest=article["digest"],
            content=article["content"],
            source_url=article["source_url"],
            thumb_media_id=thumb_media_id,
        )
        publish_id = submit_publish(access_token, draft_media_id)
    except WechatAPIError as error:
        print(str(error), file=sys.stderr)
        return 1

    print(f"公众号文章已提交发布：{article['title']} / publish_id={publish_id}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
