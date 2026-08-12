from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from scripts.build_wechat_digest import build_digest


ROOT = Path(__file__).resolve().parents[1]


class WechatDigestTests(unittest.TestCase):
    def test_digest_is_generated_with_three_scientific_sections(self):
        with tempfile.TemporaryDirectory() as first, tempfile.TemporaryDirectory() as second:
            metadata = build_digest(Path(first), Path(second))
            article = (Path(first) / "index.html").read_text(encoding="utf-8")
            markdown = (Path(first) / "latest.md").read_text(encoding="utf-8")
            public_article = (Path(second) / "index.html").read_text(encoding="utf-8")
            self.assertIn("今日重点论文", article)
            self.assertIn("物理新闻", article)
            self.assertIn("科研通知", article)
            self.assertIn("小康康的物理世界", markdown)
            self.assertIn("code-world-kang.github.io/nuclear-frontier", article)
            self.assertEqual(article, public_article)
            self.assertGreaterEqual(metadata["counts"]["papers"], 1)
            self.assertGreaterEqual(metadata["counts"]["news"], 1)
            self.assertGreaterEqual(metadata["counts"]["notices"], 1)

    def test_committed_digest_metadata_matches_article(self):
        metadata_path = ROOT / "wechat-official-account" / "metadata.json"
        if not metadata_path.exists():
            self.skipTest("请先运行站点构建")
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        article = (ROOT / "wechat-official-account" / "index.html").read_text(encoding="utf-8")
        self.assertIn(metadata["title"], article)
        self.assertEqual(metadata["counts"]["total"], sum(metadata["counts"][key] for key in ("papers", "news", "notices")))

    def test_daily_workflow_commits_and_publishes_digest(self):
        workflow = (ROOT / ".github" / "workflows" / "update-and-deploy.yml").read_text(encoding="utf-8")
        self.assertIn("site/wechat-digest", workflow)
        self.assertIn("wechat-official-account", workflow)
        self.assertIn("path: site", workflow)


if __name__ == "__main__":
    unittest.main()
