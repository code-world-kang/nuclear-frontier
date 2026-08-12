from __future__ import annotations

import unittest
from pathlib import Path

from scripts.publish_wechat_official import (
    DEFAULT_COVER,
    extract_article_fragment,
    iter_titles,
    prepare_article,
    sanitize_article_html,
)


ROOT = Path(__file__).resolve().parents[1]


class WechatPublishTests(unittest.TestCase):
    def test_article_fragment_is_sanitized_for_official_account(self):
        fragment = extract_article_fragment(
            '<!doctype html><main style="color:green"><p>hello</p><a href="https://example.com">link</a><script>x()</script></main>'
        )
        sanitized = sanitize_article_html(fragment)
        self.assertIn("<p>hello</p>", sanitized)
        self.assertIn("<span>link</span>", sanitized)
        self.assertNotIn("href=", sanitized)
        self.assertNotIn("<script", sanitized)

    def test_article_is_prepared_from_daily_digest(self):
        article = prepare_article()
        self.assertIn("小康康的物理世界", article["title"])
        self.assertIn("论文", article["digest"])
        self.assertIn("今日重点论文", article["content"])
        self.assertNotIn("href=", article["content"])
        self.assertTrue(article["source_url"].startswith("https://"))
        self.assertTrue(DEFAULT_COVER.is_file())

    def test_duplicate_title_reader_supports_wechat_records(self):
        payload = {
            "item": [
                {"content": {"news_item": [{"title": "A"}, {"title": "B"}]}},
                {"content": {"news_item": [{"title": "C"}]}},
            ]
        }
        self.assertEqual(iter_titles(payload), ["A", "B", "C"])

    def test_workflow_is_secret_gated_and_does_not_publish_on_push(self):
        workflow = (ROOT / ".github" / "workflows" / "update-and-deploy.yml").read_text(encoding="utf-8")
        self.assertIn("WECHAT_OFFICIAL_APP_ID", workflow)
        self.assertIn("WECHAT_OFFICIAL_APP_SECRET", workflow)
        self.assertIn("WECHAT_OFFICIAL_PUBLISH_ENABLED", workflow)
        self.assertIn('github.event_name != \'push\'', workflow)
        self.assertIn("publish_wechat_official.py --publish", workflow)


if __name__ == "__main__":
    unittest.main()
