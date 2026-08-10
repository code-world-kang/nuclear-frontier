from __future__ import annotations

import json
import sys
import unittest
from unittest.mock import patch
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from update_content import (  # noqa: E402
    Classifier,
    clean_arxiv_abstract,
    count_new_records,
    enrich_arxiv_figures,
    enrich_missing_abstracts,
    extract_deadline,
    extract_english_notice_date,
    extract_notice_date,
    merge_records,
    normalize_title,
    parse_arxiv_figures,
    parse_feed_items,
    reusable_license,
)
from sync_public_favorites import clean_favorites  # noqa: E402


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

    def test_nuclear_decay_is_a_first_class_topic(self):
        categories, _ = self.classifier.classify(
            "Beta-delayed neutron emission of 137Cs",
            "Decay spectroscopy determines the half-life and branching ratio.",
        )
        self.assertIn("nuclear-decay", categories)

    def test_source_prior_does_not_guess_prc_as_experiment(self):
        details = self.classifier.classification_details(
            "A generic study of a nucleus", "", "Physical Review C", ["nuclear-general"]
        )
        self.assertEqual(details["primary_topic"], "nuclear-general")
        self.assertNotIn("experimental-nuclear", details["categories"])

    def test_nucl_ex_prior_coexists_with_physics_topic(self):
        details = self.classifier.classification_details(
            "Level scheme of a neutron-rich isotope", "Gamma spectroscopy reveals shell evolution.",
            "arXiv nucl-ex", ["experimental-nuclear"],
        )
        self.assertIn("experimental-nuclear", details["categories"])
        self.assertIn("nuclear-structure", details["categories"])

    def test_fusion_plasma_is_not_mislabeled_as_nuclear_reaction(self):
        categories, _ = self.classifier.classify(
            "Stellarator coils for future fusion reactors", "Magnetic confinement of tokamak plasma"
        )
        self.assertIn("fusion", categories)
        self.assertNotIn("nuclear-reactions", categories)

    def test_particle_branching_fraction_is_not_nuclear_decay(self):
        categories, _ = self.classifier.classify(
            "Search for lepton-flavor violating B meson decays",
            "An upper limit on the branching fraction is measured at LHCb.",
            "Physical Review Letters",
        )
        self.assertNotIn("nuclear-decay", categories)

    def test_cosmology_quadrupole_is_not_nuclear_structure(self):
        categories, _ = self.classifier.classify(
            "Galaxy clustering quadrupole moment",
            "An anisotropic correlation function constrains dark matter cosmology.",
            "Monthly Notices of the Royal Astronomical Society",
        )
        self.assertNotIn("nuclear-structure", categories)

    def test_filtered_general_article_requires_relevance(self):
        self.assertFalse(self.classifier.relevant("A study of urban traffic", "Road networks", "filtered"))
        self.assertTrue(self.classifier.relevant("Neutron-rich nuclei", "Nuclear structure", "filtered"))
        self.assertFalse(self.classifier.relevant(
            "A tumour-derived organoid biobank", "First discovery of cancer dependencies in cell nuclei", "filtered"
        ))
        self.assertFalse(self.classifier.relevant(
            "Nuclear uncaging in stretched epithelia", "Cell nuclei reorganize during tissue development", "filtered"
        ))
        self.assertTrue(self.classifier.relevant(
            "First observation of a topological quantum phase", "A physics experiment", "filtered"
        ))

    def test_merge_deduplicates_title_and_preserves_identifiers(self):
        old = [{"id": "a", "title": "Same Paper", "published": "2026-01-01", "source_type": "preprint", "arxiv_id": "2601.1", "categories": ["theoretical-nuclear"], "tags": [], "importance": 30}]
        new = [{"id": "b", "title": "Same Paper", "published": "2026-01-02", "source_type": "journal", "doi": "10.1/x", "categories": ["nuclear-structure"], "tags": [], "importance": 50}]
        merged = merge_records(old, new, 10)
        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0]["doi"], "10.1/x")
        self.assertEqual(merged[0]["arxiv_id"], "2601.1")

    def test_normalize_title(self):
        self.assertEqual(normalize_title("A: Nuclear-Physics!"), "anuclearphysics")

    def test_normalize_title_preserves_unicode_letters_and_digits(self):
        self.assertEqual(normalize_title("核结构：β 衰变２０２６"), "核结构β衰变2026")

    def test_merge_does_not_deduplicate_empty_normalized_titles(self):
        old = [{"id": "a", "title": "!!!", "published": "2026-01-01"}]
        new = [{"id": "b", "title": "---", "published": "2026-01-02"}]
        merged = merge_records(old, new, 10)
        self.assertEqual({item["id"] for item in merged}, {"a", "b"})

    def test_short_acronym_uses_word_boundaries(self):
        self.assertFalse(self.classifier.contains_term("a significant improvement", "NIF"))
        self.assertTrue(self.classifier.contains_term("an experiment at NIF", "NIF"))

    def test_general_ai_requires_scientific_physics_context(self):
        self.assertFalse(self.classifier.relevant(
            "A deep learning model for online advertising", "User click prediction", "important-ai"
        ))
        self.assertTrue(self.classifier.relevant(
            "Machine learning for plasma diagnostics", "Physics-informed detector reconstruction", "important-ai"
        ))

    def test_importance_has_explainable_reasons(self):
        score, reasons = self.classifier.importance_details(
            "First observation of a new isotope", "Nuclear structure measurement", 5,
            ["experimental-nuclear", "nuclear-structure"],
        )
        self.assertGreaterEqual(score, 60)
        self.assertTrue(any("来源权重" in reason for reason in reasons))
        self.assertTrue(any("突破性表述" in reason for reason in reasons))

    def test_true_new_count_ignores_window_refetches_and_title_duplicates(self):
        old = [{"id": "old", "title": "Known paper"}]
        incoming = [
            {"id": "old", "title": "Known paper"},
            {"id": "alias", "title": "Known paper"},
            {"id": "new", "title": "New paper"},
            {"id": "new", "title": "New paper"},
        ]
        self.assertEqual(count_new_records(old, incoming), 1)

    def test_feed_parser_removes_invalid_xml_control_characters(self):
        raw = b'<rss><channel><item><title>A\x0b title</title><link>https://example.org/a</link></item></channel></rss>'
        items = parse_feed_items(raw)
        self.assertEqual(items[0]["title"], "A title")

    def test_notice_date_supports_chinese_date(self):
        self.assertEqual(extract_notice_date("发布日期：2026年8月10日"), "2026-08-10")

    def test_notice_deadline_supports_chinese_and_english(self):
        self.assertEqual(extract_deadline("申报截止日期为2026年9月9日。"), "2026-09-09")
        self.assertEqual(extract_deadline("Proposal deadline: September 9, 2026"), "2026-09-09")
        self.assertEqual(extract_deadline("All proposals must be submitted online by 11 p.m. EST on 9 September 2026."), "2026-09-09")
        self.assertEqual(extract_english_notice_date("Published 1 June 2026"), "2026-06-01")

    def test_notice_merge_preserves_verified_metadata(self):
        old = [{
            "id": "n", "type": "notice", "title": "Beam time call", "summary": "Official summary",
            "published": "2026-08-01", "deadline": "2026-09-09", "notice_category": "beam-international",
            "first_seen": "2026-08-01T00:00:00+08:00", "last_seen": "2026-08-01T00:00:00+08:00",
        }]
        incoming = [{
            "id": "n", "type": "notice", "title": "Beam time call", "summary": "", "published": "",
            "deadline": "", "notice_category": "beam-international", "first_seen": "2026-08-10T00:00:00+08:00",
            "last_seen": "2026-08-10T00:00:00+08:00",
        }]
        merged = merge_records(old, incoming, 10)[0]
        self.assertEqual(merged["summary"], "Official summary")
        self.assertEqual(merged["deadline"], "2026-09-09")
        self.assertEqual(merged["first_seen"], "2026-08-01T00:00:00+08:00")

    def test_arxiv_rss_prefix_is_removed_without_truncating_abstract(self):
        value = "arXiv:2608.00001v1 Announce Type: new Abstract: Full abstract sentence."
        self.assertEqual(clean_arxiv_abstract(value), "Full abstract sentence.")

    def test_only_permissive_arxiv_licenses_are_reusable(self):
        self.assertTrue(reusable_license("http://creativecommons.org/licenses/by/4.0/"))
        self.assertTrue(reusable_license("https://creativecommons.org/publicdomain/zero/1.0/"))
        self.assertFalse(reusable_license("http://arxiv.org/licenses/nonexclusive-distrib/1.0/"))
        self.assertFalse(reusable_license("https://creativecommons.org/licenses/by-nc-nd/4.0/"))

    def test_arxiv_figure_parser_selects_result_figure_and_rejects_rights_risk(self):
        raw = b'''<html><figure id="F1"><img src="setup.png"><figcaption>Figure 1: Experimental setup.</figcaption></figure>
        <figure id="F2"><img src="result.png"><figcaption>Figure 2: Measured cross section and model comparison.</figcaption></figure>
        <figure id="F3"><img src="third.png"><figcaption>Figure 3: Reprinted with permission.</figcaption></figure></html>'''
        paper = {
            "license": "https://creativecommons.org/licenses/by/4.0/",
            "authors": ["A. Author"], "arxiv_id": "2608.00001",
        }
        figures = parse_arxiv_figures(raw, "https://arxiv.org/html/2608.00001", paper)
        self.assertEqual(len(figures), 2)
        self.assertTrue(figures[0]["url"].endswith("result.png"))
        self.assertNotIn("third.png", {item["url"].rsplit("/", 1)[-1] for item in figures})

    def test_arxiv_figure_parser_rejects_external_urls_and_attribution_risks(self):
        raw = b'''<html>
        <figure><img src="https://publisher.example/external.png"><figcaption>Figure 1: Main result.</figcaption></figure>
        <figure><img src="//cdn.example/external-2.png"><figcaption>Figure 2: Main result.</figcaption></figure>
        <figure><img src="credit.png"><figcaption>Figure 3: Credit: External team.</figcaption></figure>
        <figure><img src="image.png"><figcaption>Figure 4: Image: External archive.</figcaption></figure>
        <figure><img src="reference.png"><figcaption>Figure 5: from Ref. 12.</figcaption></figure>
        <figure><img src="reproduced.png"><figcaption>Figure 6: Reproduced from another work.</figcaption></figure>
        <figure><img src="adapted.png"><figcaption>Figure 7: Adapted comparison.</figcaption></figure>
        <figure><img src="courtesy.png"><figcaption>Figure 8: Courtesy of a laboratory.</figcaption></figure>
        <figure><img src="copyright.png"><figcaption>Figure 9: Copyright Publisher.</figcaption></figure>
        <figure><img src="safe.png"><figcaption>Figure 10: Measured cross section.</figcaption></figure>
        <figure><img src="https://export.arxiv.org/safe-export.png"><figcaption>Figure 11: Detector efficiency.</figcaption></figure>
        </html>'''
        paper = {
            "license": "https://creativecommons.org/licenses/by/4.0/",
            "authors": ["A. Author"], "arxiv_id": "2608.00001",
        }
        figures = parse_arxiv_figures(raw, "https://arxiv.org/html/2608.00001", paper)
        self.assertEqual(
            {item["url"] for item in figures},
            {
                "https://arxiv.org/html/safe.png",
                "https://export.arxiv.org/safe-export.png",
            },
        )

    def test_figure_enrichment_records_retry_metadata_for_all_failure_states(self):
        run_at = "2026-08-08T08:00:00+08:00"
        cases = [
            (b"<html></html>", None, "no_figures"),
            (None, RuntimeError("request timed out"), "source_timeout"),
            (None, RuntimeError("malformed response"), "extraction_failed"),
        ]
        for index, (payload, error, expected_status) in enumerate(cases):
            with self.subTest(status=expected_status):
                paper = {
                    "id": f"p{index}", "arxiv_id": f"2608.0000{index}",
                    "license": "https://creativecommons.org/licenses/by/4.0/",
                    "figures": [], "figure_status": "pending", "categories": [],
                }
                mocked_fetch = (
                    patch("update_content.fetch_arxiv_resource", side_effect=error)
                    if error is not None
                    else patch("update_content.fetch_arxiv_resource", return_value=payload)
                )
                with mocked_fetch:
                    stats = enrich_arxiv_figures([paper], limit=1, run_at=run_at)
                self.assertEqual(stats["checked"], 1)
                self.assertEqual(paper["figure_status"], expected_status)
                self.assertEqual(paper["figure_enrichment"]["status"], expected_status)
                self.assertTrue(paper["figure_enrichment"]["checked_at"])
                self.assertTrue(paper["figure_enrichment"]["retry_after"])

    def test_figure_retry_cooldown_defers_recent_failures_and_prioritizes_pending(self):
        run_at = "2026-08-08T08:00:00+08:00"
        licensed = "https://creativecommons.org/licenses/by/4.0/"
        recent_failures = [
            {
                "id": status, "arxiv_id": f"2608.1000{index}", "license": licensed,
                "figures": [], "figure_status": status, "categories": ["nuclear-decay"],
                "importance": 100,
                "figure_enrichment": {"status": status, "checked_at": "2026-08-08T00:00:00+00:00"},
            }
            for index, status in enumerate(("no_figures", "extraction_failed", "source_timeout"))
        ]
        pending = {
            "id": "pending", "arxiv_id": "2608.20001", "license": licensed,
            "figures": [], "figure_status": "pending", "categories": [], "importance": 1,
        }
        with patch("update_content.fetch_arxiv_resource", return_value=b"<html></html>") as mocked:
            stats = enrich_arxiv_figures(recent_failures + [pending], limit=1, run_at=run_at)
        self.assertEqual(stats["deferred"], 3)
        self.assertEqual(stats["checked"], 1)
        self.assertIn("2608.20001", mocked.call_args.args[0])

    def test_pending_figure_work_precedes_due_old_failure(self):
        licensed = "https://creativecommons.org/licenses/by/4.0/"
        old_failure = {
            "id": "old", "arxiv_id": "2608.30001", "license": licensed,
            "figures": [], "figure_status": "no_figures", "categories": ["nuclear-decay"],
            "importance": 100,
            "figure_enrichment": {"status": "no_figures", "checked_at": "2026-06-01T00:00:00+00:00"},
        }
        pending = {
            "id": "pending", "arxiv_id": "2608.30002", "license": licensed,
            "figures": [], "figure_status": "pending", "categories": [], "importance": 1,
        }
        with patch("update_content.fetch_arxiv_resource", return_value=b"<html></html>") as mocked:
            enrich_arxiv_figures([old_failure, pending], limit=1, run_at="2026-08-08T08:00:00+08:00")
        self.assertIn("2608.30002", mocked.call_args.args[0])

    def test_public_favorite_whitelist_preserves_keywords(self):
        cleaned = clean_favorites([{
            "id": "paper-1", "title": "Paper", "keywords": ["衰变", "探测器"],
            "note": "私人阅读笔记", "private_token": "must-not-leak",
        }])
        self.assertEqual(cleaned[0]["keywords"], ["衰变", "探测器"])
        self.assertNotIn("note", cleaned[0])
        self.assertNotIn("private_token", cleaned[0])

    def test_merge_keeps_existing_full_abstract_and_figures(self):
        old = [{
            "id": "a", "title": "Licensed Paper", "published": "2026-01-01", "source_type": "preprint",
            "abstract": "Complete abstract", "license": "https://creativecommons.org/licenses/by/4.0/",
            "figures": [{
                "url": "https://arxiv.org/html/2601.00001/x1.png", "caption": "Figure 1: Main result."
            }], "categories": ["nuclear-decay"], "tags": [],
        }]
        new = [{
            "id": "b", "title": "Licensed Paper", "published": "2026-01-02", "source_type": "journal",
            "abstract": "", "license": "", "figures": [], "categories": ["nuclear-general"], "tags": [],
        }]
        merged = merge_records(old, new, 10)
        self.assertEqual(merged[0]["abstract"], "Complete abstract")
        self.assertEqual(len(merged[0]["figures"]), 1)

    def test_merge_drops_legacy_external_figure_urls(self):
        old = [{
            "id": "a", "title": "Paper", "figures": [{
                "url": "https://publisher.example/figure.png", "caption": "Figure 1: Result."
            }],
        }]
        merged = merge_records(old, [], 10)
        self.assertEqual(merged[0]["figures"], [])

    def test_inspire_enrichment_fills_abstract_and_arxiv_link(self):
        papers = [{
            "id": "p", "title": "Paper", "doi": "10.1234/example", "abstract": "",
            "published": "2026-08-08", "importance": 50,
        }]
        payload = {
            "hits": {"hits": [{"metadata": {
                "dois": [{"value": "10.1234/example"}],
                "abstracts": [{"value": "A complete <b>nuclear</b> abstract."}],
                "arxiv_eprints": [{"value": "2608.00001"}],
            }}]}
        }
        with patch("update_content.fetch", return_value=json.dumps(payload).encode()):
            stats = enrich_missing_abstracts(papers, "2026-08-08T08:00:00+08:00", limit=20)
        self.assertEqual(stats["enriched"], 1)
        self.assertEqual(papers[0]["abstract"], "A complete nuclear abstract.")
        self.assertEqual(papers[0]["abstract_source"], "INSPIRE")
        self.assertEqual(papers[0]["arxiv_id"], "2608.00001")

    def test_inspire_not_found_is_deferred_for_thirty_days(self):
        papers = [{
            "id": "p", "title": "Paper", "doi": "10.1234/missing", "abstract": "",
            "published": "2026-08-08", "importance": 50,
            "abstract_enrichment": {"status": "not_found", "checked_at": "2026-08-01T08:00:00+08:00"},
        }]
        with patch("update_content.fetch") as mocked:
            stats = enrich_missing_abstracts(papers, "2026-08-08T08:00:00+08:00", limit=20)
        mocked.assert_not_called()
        self.assertEqual(stats["checked"], 0)


if __name__ == "__main__":
    unittest.main()
