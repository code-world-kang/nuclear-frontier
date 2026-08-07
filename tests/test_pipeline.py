from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from update_content import Classifier, merge_records, normalize_title  # noqa: E402


class PipelineTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.topics = json.loads((ROOT / "config" / "topics.json").read_text(encoding="utf-8"))
        cls.classifier = Classifier(cls.topics)

    def test_nuclear_ai_is_classified_in_both_domains(self):
        categories, _ = self.classifier.classify(
            "Machine learning for particle identification in a silicon detector",
            "An artificial-intelligence workflow for nuclear experiment data acquisition.",
        )
        self.assertIn("ai-science", categories)
        self.assertIn("detectors-daq", categories)

    def test_fusion_category(self):
        categories, _ = self.classifier.classify(
            "Neutron diagnostics for ITER tokamak plasmas", "Nuclear fusion performance"
        )
        self.assertIn("fusion", categories)

    def test_filtered_general_article_requires_relevance(self):
        self.assertFalse(self.classifier.relevant("A study of urban traffic", "Road networks", "filtered"))
        self.assertTrue(self.classifier.relevant("Neutron-rich nuclei", "Nuclear structure", "filtered"))

    def test_merge_deduplicates_title_and_preserves_identifiers(self):
        old = [{"id": "a", "title": "Same Paper", "published": "2026-01-01", "source_type": "preprint", "arxiv_id": "2601.1", "categories": ["theoretical-nuclear"], "tags": [], "importance": 30}]
        new = [{"id": "b", "title": "Same Paper", "published": "2026-01-02", "source_type": "journal", "doi": "10.1/x", "categories": ["nuclear-structure"], "tags": [], "importance": 50}]
        merged = merge_records(old, new, 10)
        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0]["doi"], "10.1/x")
        self.assertEqual(merged[0]["arxiv_id"], "2601.1")

    def test_normalize_title(self):
        self.assertEqual(normalize_title("A: Nuclear-Physics!"), "anuclearphysics")

    def test_short_acronym_uses_word_boundaries(self):
        self.assertFalse(self.classifier.contains_term("a significant improvement", "NIF"))
        self.assertTrue(self.classifier.contains_term("an experiment at NIF", "NIF"))


if __name__ == "__main__":
    unittest.main()
