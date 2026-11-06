import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from paper_identity import arxiv_key, merge_papers, paper_change_counts, record_ids
from translate_content import needs_translation, source_hash, store_translation, translation_for
from update_content import crossref_publication_links, enrich_arxiv_publication_links
from featured_journals import featured_label
from run_local_translation import merge_bundle


def paper(id, kind="preprint", **fields):
    return dict({"id": id, "type": "paper", "title": "Nuclear structure study", "source_type": kind,
                 "authors": ["Alice Smith", "Bob Jones"], "published": "2026-01-01", "abstract": "Original abstract."}, **fields)


class PaperIdentityTests(unittest.TestCase):
    def test_featured_families_use_shared_config(self):
        root = Path(__file__).resolve().parents[1]
        config = json.loads((root / "config/featured-journals.json").read_text())
        for name in ("NIMA", "Physical Review Letters", "Nature Astronomy", "Communications Physics", "npj Quantum Information", "Science Advances", "Science Bulletin", "科学通报"):
            self.assertTrue(featured_label({"source": name, "source_type": "journal"}, config), name)
        for name in ("Physical Review C", "NIMB", "Science China Physics"):
            self.assertFalse(featured_label({"source": name}, config), name)
        self.assertFalse(featured_label({"source_short": "PRL", "source_type": "preprint"}, config))

    def test_new_multidisciplinary_sources_remain_filtered(self):
        config = json.loads((Path(__file__).resolve().parents[1] / "config/sources.json").read_text())
        names = {"Communications Physics", "Nature Materials", "Nature Photonics", "Nature Computational Science", "npj Quantum Information", "Science Advances", "科学通报"}
        found = [row for row in config["crossref_journals"] if row["name"] in names]
        self.assertEqual(len(found), len(names))
        self.assertTrue(all(row["mode"] == "filtered" for row in found))

    def test_arxiv_versions_legacy_ids_and_doi(self):
        for value in ("https://arxiv.org/pdf/nucl-ex/0507025v2.pdf", "arXiv:nucl-ex/0507025v1"):
            self.assertEqual(arxiv_key(value), "nucl-ex/0507025")
        self.assertEqual(arxiv_key("10.48550/arXiv.2601.00001"), "2601.00001")
        self.assertEqual(arxiv_key("https://evil.example/2601.00001"), "")

    def test_doi_matches_changed_title_and_keeps_old_id(self):
        old = paper("old", doi="https://doi.org/10.1234/ABC")
        new = paper("journal", "journal", doi="10.1234/abc", title="Changed title", published="2026-11-01")
        merged = merge_papers([old], [new])
        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0]["id"], "old")
        self.assertEqual(merged[0]["title"], "Changed title")
        self.assertEqual(paper_change_counts([old], merged), {"new": 0, "published": 1})
        self.assertEqual(paper_change_counts(merged, merge_papers(merged, [new])), {"new": 0, "published": 0})

    def test_arxiv_links_preprint_with_different_title(self):
        pre = paper("pre", arxiv_id="2601.00001v2", pdf_url="https://arxiv.org/pdf/2601.00001")
        journal = paper("journal", "journal", title="Revised title", arxiv_id="2601.00001", doi="10.1234/a", abstract="Published abstract.", abstract_source="Crossref", published="2026-05-01")
        merged = merge_papers([pre], [journal])[0]
        self.assertEqual(merged["publication_status"], "published")
        self.assertEqual(merged["preprint_published"], "2026-01-01")
        self.assertEqual(merged["journal_published"], "2026-05-01")
        self.assertEqual(merged["abstract"], "Published abstract.")
        self.assertEqual(merged["abstract_source"], "Crossref")
        self.assertEqual(merged["arxiv_pdf_url"], pre["pdf_url"])
        self.assertEqual(len(merged["versions"]), 2)
        self.assertEqual(merge_papers([merged], [pre])[0]["abstract"], "Published abstract.")

    def test_bridge_existing_duplicates_preserves_all_ids(self):
        pre = paper("pre", title="Preprint title", arxiv_id="2601.00001")
        journal = paper("journal", "journal", title="Journal title", doi="10.1234/a")
        bridge = paper("bridge", arxiv_id="2601.00001", publication_links=[{"relation": "is-preprint-of", "id_type": "doi", "id": "10.1234/a"}])
        merged = merge_papers([pre, journal], [bridge])
        self.assertEqual(len(merged), 1)
        self.assertEqual(set(record_ids(merged[0])), {"pre", "journal", "bridge"})
        self.assertEqual(merged[0]["source_type"], "journal")

    def test_title_requires_authors_and_conflicting_dois_stay_separate(self):
        original = paper("one")
        for other in (paper("two", authors=[]), paper("two", authors=["Someone Else"]), paper("two", title="Similar nuclear structure study")):
            self.assertEqual(len(merge_papers([original], [other])), 2)
        a = paper("one", "journal", doi="10.1234/a", arxiv_id="2601.00001")
        b = paper("two", "journal", doi="10.1234/correction", arxiv_id="2601.00001")
        self.assertEqual(len(merge_papers([a], [b])), 2)

    def test_exact_title_author_match_and_no_mutation(self):
        source = [paper("a"), paper("b", "journal", doi="10.1234/a")]
        before = copy.deepcopy(source)
        merged = merge_papers(source)
        self.assertEqual(len(merged), 1)
        self.assertEqual(source, before)
        self.assertEqual(merge_papers(merged), merged)

    def test_new_count_does_not_double_count_same_run_versions(self):
        merged = merge_papers([], [paper("a"), paper("b", "journal", doi="10.1234/a")])
        self.assertEqual(paper_change_counts([], merged), {"new": 1, "published": 0})

    def test_official_relation_only(self):
        links = crossref_publication_links({"relation": {"has-preprint": [{"id-type": "doi", "id": "10.48550/arXiv.2601.00001"}], "is-correction-of": [{"id": "10.1234/a"}]}})
        self.assertEqual(len(links), 1)
        result = merge_papers([paper("a", arxiv_id="2601.00001")], [paper("b", "journal", title="New title", doi="10.1234/a", publication_links=links)])
        self.assertEqual(len(result), 1)

    def test_alias_translation_reuse_only_when_identical_source(self):
        original = paper("a")
        translation = {"title_zh": "核结构研究", "abstract_zh": "完整的摘要。", "source_hash": source_hash(original)}
        item = merge_papers([paper("b", "journal", doi="10.1234/a")], [original])[0]
        self.assertEqual(translation_for(item, {"a": translation}), translation)
        self.assertFalse(needs_translation(item, {"a": translation}))
        item["abstract"] = "Changed official abstract."
        self.assertEqual(translation_for(item, {"a": translation}), {})
        self.assertTrue(needs_translation(item, {"a": translation}))

    def test_legacy_translation_not_reused_after_source_changes_and_archived(self):
        old = paper("a")
        old_translation = {"title_zh": "旧版本题目", "abstract_zh": "旧版本摘要。"}
        # 使用可靠共同编号连接改题目的两个版本。
        old["arxiv_id"] = "2601.00001"
        item = merge_papers([old], [paper("b", "journal", title="Changed title", arxiv_id="2601.00001", doi="10.1234/a")])[0]
        payload = {"items": {"a": old_translation}}
        self.assertEqual(translation_for(item, payload["items"]), {})
        current = {"title_zh": "新版本题目", "abstract_zh": "新版本摘要。", "source_hash": source_hash(item)}
        store_translation(payload, item, current)
        self.assertEqual(payload["versions"]["a"][source_hash(old)], old_translation)
        self.assertEqual(payload["items"]["a"], current)

    def test_arxiv_lookup_records_doi_and_cooldown(self):
        raw = b'<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom"><entry><id>http://arxiv.org/abs/2601.00001v2</id><arxiv:doi>10.1234/a</arxiv:doi><arxiv:journal_ref>PRC 114</arxiv:journal_ref></entry></feed>'
        records = [paper("p", arxiv_id="2601.00001")]
        with patch("update_content.fetch_arxiv_resource", return_value=raw) as request:
            stats = enrich_arxiv_publication_links(records, "2026-11-06T00:00:00+00:00", 20)
            self.assertEqual(stats["linked"], 1)
            self.assertEqual(records[0]["publication_links"][0]["id"], "10.1234/a")
            self.assertEqual(enrich_arxiv_publication_links(records, "2026-11-07T00:00:00+00:00", 20)["attempted"], 0)
            self.assertEqual(request.call_count, 1)
        with patch("update_content.fetch_arxiv_resource", side_effect=RuntimeError("offline")):
            self.assertEqual(enrich_arxiv_publication_links(records, "2026-11-20T00:00:00+00:00", 20)["failed"], 1)
            self.assertEqual(records[0]["publication_links"][0]["id"], "10.1234/a")

    def test_in_flight_translation_old_id_can_publish_to_merged_id(self):
        item = paper("journal", "journal", record_aliases=["preprint"])
        value = {"title_zh": "核结构研究", "abstract_zh": "论文的中文摘要。", "source_hash": source_hash(item), "translated_at": "2026-11-06T00:00:00Z"}
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "data").mkdir()
            (root / "data/papers.json").write_text(json.dumps([item]))
            (root / "data/translations.zh-CN.json").write_text('{"items": {}}')
            report = merge_bundle(root, {"records": {"preprint": value}, "retries": {}, "report": {"automatic": True, "failed": 0}})
            self.assertEqual(report["published_ids"], ["journal"])
            payload = json.loads((root / "data/translations.zh-CN.json").read_text())
            self.assertEqual(payload["items"]["journal"]["abstract_zh"], value["abstract_zh"])


if __name__ == "__main__":
    unittest.main()
