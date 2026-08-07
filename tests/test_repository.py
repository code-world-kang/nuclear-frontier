from __future__ import annotations

import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class RepositoryTests(unittest.TestCase):
    def test_required_json_is_valid(self):
        for path in [
            ROOT / "config" / "topics.json",
            ROOT / "config" / "sources.json",
            ROOT / "config" / "runtime.json",
            ROOT / "data" / "papers.json",
            ROOT / "data" / "news.json",
            ROOT / "data" / "notices.json",
            ROOT / "data" / "status.json",
        ]:
            with self.subTest(path=path):
                json.loads(path.read_text(encoding="utf-8"))

    def test_every_paper_has_traceable_source(self):
        papers = json.loads((ROOT / "data" / "papers.json").read_text(encoding="utf-8"))
        for paper in papers:
            with self.subTest(id=paper.get("id")):
                self.assertTrue(paper.get("id"))
                self.assertTrue(paper.get("title"))
                self.assertTrue(paper.get("source"))
                self.assertTrue(paper.get("url"))
                self.assertIsInstance(paper.get("categories"), list)
                self.assertEqual(len(paper.get("categories", [])), len(set(paper.get("categories", []))))

    def test_site_entrypoint_exists(self):
        index = (ROOT / "site" / "index.html").read_text(encoding="utf-8")
        self.assertIn('id="cardList"', index)
        self.assertIn('id="scopeSelect"', index)
        self.assertIn("window.location.protocol === 'file:'", index)
        self.assertIn('src="./app.js"', index)


if __name__ == "__main__":
    unittest.main()
