import json
import re
import subprocess
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MINI = ROOT / "miniprogram"


class MiniProgramTests(unittest.TestCase):
    def test_miniprogram_declares_all_core_pages(self):
        app = json.loads((MINI / "app.json").read_text(encoding="utf-8"))
        pages = set(app["pages"])
        self.assertTrue({
            "pages/home/home",
            "pages/papers/papers",
            "pages/news/news",
            "pages/notices/notices",
            "pages/mine/mine",
            "pages/detail/detail",
        } <= pages)
        self.assertEqual(len(app["tabBar"]["list"]), 5)

    def test_miniprogram_page_files_are_complete(self):
        app = json.loads((MINI / "app.json").read_text(encoding="utf-8"))
        for page in app["pages"]:
            for suffix in (".js", ".json", ".wxml", ".wxss"):
                self.assertTrue((MINI / f"{page}{suffix}").is_file(), f"missing {page}{suffix}")

    def test_miniprogram_json_and_javascript_syntax(self):
        for path in MINI.rglob("*.json"):
            json.loads(path.read_text(encoding="utf-8"))
        for path in MINI.rglob("*.js"):
            result = subprocess.run(["node", "--check", str(path)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)

    def test_miniprogram_wxml_is_well_formed(self):
        for path in MINI.rglob("*.wxml"):
            source = '<root xmlns:wx="wx" xmlns:bind="bind">' + path.read_text(encoding="utf-8") + "</root>"
            with self.subTest(path=path):
                ET.fromstring(source)

    def test_miniprogram_has_no_embedded_secrets(self):
        text = "\n".join(path.read_text(encoding="utf-8") for path in MINI.rglob("*") if path.is_file())
        suspicious = [
            r"ghp_[A-Za-z0-9]{20,}",
            r"github_pat_[A-Za-z0-9_]{20,}",
            r"sk-[A-Za-z0-9]{20,}",
            r"AppSecret\s*[:=]\s*['\"][^'\"]+",
        ]
        self.assertFalse(any(re.search(pattern, text) for pattern in suspicious))

    def test_preview_mode_is_explicit_about_cloud_boundary(self):
        detail = (MINI / "pages/detail/detail.wxml").read_text(encoding="utf-8")
        readme = (MINI / "README.md").read_text(encoding="utf-8")
        self.assertIn("预览版暂存于本机", detail)
        self.assertIn("云端队列", readme)
        self.assertIn("不得写入小程序或公开 GitHub", readme)

    def test_mobile_preview_is_published_with_github_pages(self):
        build_script = (ROOT / "scripts" / "build_site.py").read_text(encoding="utf-8")
        preview_script = (MINI / "preview" / "preview.js").read_text(encoding="utf-8")
        self.assertIn("PUBLIC_MINIPROGRAM_PREVIEW", build_script)
        self.assertIn("/miniprogram-preview/", preview_script)

    def test_interface_push_does_not_repeat_daily_collection(self):
        workflow = (ROOT / ".github" / "workflows" / "update-and-deploy.yml").read_text(encoding="utf-8")
        self.assertGreaterEqual(workflow.count("if: github.event_name != 'push'"), 2)
