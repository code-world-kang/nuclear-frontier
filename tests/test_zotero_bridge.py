import importlib.util
import pathlib
import unittest
from unittest import mock


ROOT = pathlib.Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("zotero_bridge", ROOT / "zotero_bridge" / "bridge.py")
BRIDGE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader
SPEC.loader.exec_module(BRIDGE)


class ZoteroBridgeTests(unittest.TestCase):
    def sample(self):
        return {
            "id": "paper-1",
            "title": "A nuclear structure paper",
            "title_zh": "一篇核结构论文",
            "authors": ["Zhang, San", "Li Si"],
            "abstract": "An abstract.",
            "source": "Physical Review C",
            "source_short": "Phys. Rev. C",
            "source_type": "journal",
            "published": "2026-08-11",
            "volume": "114",
            "issue": "2",
            "pages": "024603",
            "doi": "https://doi.org/10.1103/example",
            "url": "https://journals.aps.org/prc/abstract/10.1103/example",
            "pdf_url": "https://arxiv.org/pdf/2608.00001",
            "categories": ["核结构"],
            "tags": ["质子数"],
            "keywords": ["重点参考"],
            "note": "比较 Figure 2 的能级。",
            "remarks": "后续检查模型假设。",
        }

    def test_zotero_item_contains_metadata_note_and_tags(self):
        item = BRIDGE.zotero_item(self.sample())
        self.assertEqual(item["itemType"], "journalArticle")
        self.assertEqual(item["DOI"], "10.1103/example")
        self.assertEqual(item["publicationTitle"], "Physical Review C")
        self.assertEqual(item["creators"][0]["lastName"], "Zhang")
        note = item["notes"][0]["note"]
        self.assertIn("一篇核结构论文", note)
        self.assertIn("Figure 2", note)
        self.assertIn("后续检查", note)
        self.assertEqual({tag["tag"] for tag in item["tags"]}, {"核结构", "质子数", "重点参考"})

    def test_pdf_download_is_limited_to_trusted_https_hosts(self):
        self.assertEqual(
            BRIDGE.allowed_pdf_url("https://arxiv.org/pdf/2608.00001"),
            "https://arxiv.org/pdf/2608.00001",
        )
        self.assertEqual(BRIDGE.allowed_pdf_url("https://example.com/paper.pdf"), "")
        with self.assertRaises(BRIDGE.BridgeError):
            BRIDGE.allowed_pdf_url("http://arxiv.org/pdf/2608.00001")

    def test_save_creates_item_note_and_uses_resolver_when_needed(self):
        sample = self.sample()
        sample["pdf_url"] = ""
        calls = []

        def fake_request(path, **kwargs):
            calls.append((path, kwargs))
            if path == "/connector/saveItems":
                return 201, b"", {}
            if path == "/connector/updateSession":
                return 200, b"{}", {}
            if path == "/connector/hasAttachmentResolvers":
                return 200, b"false", {}
            raise AssertionError(path)

        with mock.patch.object(BRIDGE, "zotero_health", return_value={"ok": True}), mock.patch.object(
            BRIDGE, "validated_target", return_value="C78"
        ), mock.patch.object(
            BRIDGE, "find_existing", return_value=None
        ), mock.patch.object(BRIDGE, "zotero_request", side_effect=fake_request):
            result = BRIDGE.save_to_zotero(sample, target="C78", classification=["核结构", "重点参考"])

        self.assertTrue(result["metadata_saved"])
        self.assertTrue(result["note_saved"])
        self.assertFalse(result["pdf_saved"])
        save_payload = next(kwargs["payload"] for path, kwargs in calls if path == "/connector/saveItems")
        self.assertEqual(save_payload["items"][0]["id"], "paper-1")
        self.assertTrue(save_payload["items"][0]["notes"])
        update_payload = next(kwargs["payload"] for path, kwargs in calls if path == "/connector/updateSession")
        self.assertEqual(update_payload["target"], "C78")
        self.assertEqual(update_payload["tags"], ["核结构", "重点参考"])
        self.assertEqual(result["classification"], ["核结构", "重点参考"])

    def test_duplicate_is_not_created(self):
        with mock.patch.object(BRIDGE, "zotero_health", return_value={"ok": True}), mock.patch.object(
            BRIDGE, "validated_target", return_value="L1"
        ), mock.patch.object(
            BRIDGE, "find_existing", return_value={"key": "ABC123"}
        ):
            result = BRIDGE.save_to_zotero(self.sample(), target="L1", classification=["核结构"])
        self.assertTrue(result["already_exists"])
        self.assertIn("未重复创建", result["message"])

    def test_duplicate_lookup_queries_title_then_checks_doi(self):
        sample = self.sample()
        record = {"data": {"title": sample["title"], "DOI": "10.1103/example"}}
        with mock.patch.object(BRIDGE, "local_items", return_value=[record]) as lookup:
            existing = BRIDGE.find_existing(sample)
        self.assertIsNotNone(existing)
        lookup.assert_called_once_with(sample["title"].casefold())

    def test_classification_is_required(self):
        with mock.patch.object(BRIDGE, "zotero_health", return_value={"ok": True}), mock.patch.object(
            BRIDGE, "validated_target", return_value="L1"
        ):
            with self.assertRaisesRegex(BRIDGE.BridgeError, "至少选择一个"):
                BRIDGE.save_to_zotero(self.sample(), target="L1", classification=[])

    def test_collection_targets_keep_tree_levels(self):
        response = {
            "libraryID": 1,
            "libraryName": "我的文库",
            "id": 78,
            "name": "Detector",
            "targets": [
                {"id": "L1", "name": "我的文库", "level": 0, "filesEditable": True},
                {"id": "C78", "name": "Detector", "level": 1, "filesEditable": True, "recent": True},
                {"id": "S9", "name": "已保存搜索", "level": 1},
            ],
        }
        with mock.patch.object(
            BRIDGE, "zotero_request", return_value=(200, __import__("json").dumps(response).encode(), {})
        ):
            result = BRIDGE.zotero_targets()
        self.assertEqual(result["current_id"], "C78")
        self.assertEqual([value["id"] for value in result["targets"]], ["L1", "C78"])
        self.assertEqual(result["targets"][1]["level"], 1)


if __name__ == "__main__":
    unittest.main()
