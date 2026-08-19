import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class EdgeOneTests(unittest.TestCase):
    def test_china_region_and_blob_dependency_are_configured(self):
        config = json.loads((ROOT / "edgeone.json").read_text(encoding="utf-8"))
        package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
        runtime = json.loads((ROOT / "config" / "runtime.json").read_text(encoding="utf-8"))
        self.assertIn("ap-beijing", config["cloudFunctions"]["mainlandRegions"])
        self.assertEqual(config["outputDirectory"], "site")
        self.assertEqual(config["cloudFunctions"]["nodejs"]["maxDuration"], 30)
        self.assertEqual(package["dependencies"]["@edgeone/pages-blob"], "0.0.16")
        self.assertEqual(runtime["cloud_sync"]["endpoint"], "/api/personal-state")

    def test_dynamic_api_requires_owner_secret_for_writes(self):
        function = (ROOT / "cloud-functions" / "api" / "personal-state.js").read_text(encoding="utf-8")
        self.assertIn("PERSONAL_SYNC_SECRET", function)
        self.assertIn("Authorization", function)
        self.assertIn("request.method === 'GET'", function)
        self.assertIn("request.method !== 'PUT'", function)
        self.assertIn("store.setJSON", function)
        self.assertIn("consistency: 'strong'", function)

    def test_no_secret_is_committed(self):
        forbidden = ("github_pat_", "ghp_", "PERSONAL_SYNC_SECRET=")
        for path in [
            ROOT / "edgeone.json",
            ROOT / "package.json",
            ROOT / "cloud-functions" / "api" / "personal-state.js",
        ]:
            text = path.read_text(encoding="utf-8")
            for marker in forbidden:
                self.assertNotIn(marker, text)


if __name__ == "__main__":
    unittest.main()
