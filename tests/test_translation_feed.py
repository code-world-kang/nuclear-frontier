import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from translation_feed import apply_batch, load_translations, batch_path
from stage_pages import stage


class FeedTests(unittest.TestCase):
    def test_later_manual_edit_and_old_versions_are_preserved(self):
        old = {'title_zh': '旧版本', 'source_hash': 'old'}
        new = {'title_zh': '新版本', 'source_hash': 'new'}
        batch = {'items': {'a': new}, 'previous': {'a': old}}
        payload = {'items': {'a': old}}
        apply_batch(payload, batch)
        self.assertEqual(payload['versions']['a']['old'], old)
        payload['items']['a'] = {'title_zh': '人工修改'}
        apply_batch(payload, batch)
        self.assertEqual(payload['items']['a']['title_zh'], '人工修改')

    def test_corrupt_batch_and_invalid_paths_fail_closed(self):
        with tempfile.TemporaryDirectory() as root:
            data = Path(root) / 'data'
            (data / 'translation-feed/batches').mkdir(parents=True)
            (data / 'translations.zh-CN.json').write_text('{"items": {}}')
            digest = hashlib.sha256(b'expected').hexdigest()
            (data / 'translation-feed/manifest.json').write_text(json.dumps({'batches': [digest]}))
            (Path(root) / batch_path(digest)).write_text('corrupt')
            with self.assertRaisesRegex(ValueError, 'checksum'):
                load_translations(data)
            with self.assertRaises(ValueError):
                batch_path('../../personal')

    def test_pages_artifact_excludes_history_without_deleting_source(self):
        with tempfile.TemporaryDirectory() as root:
            source, target = Path(root) / 'site', Path(root) / 'artifact'
            (source / 'data/history').mkdir(parents=True)
            (source / 'data/history/manifest.json').write_text('{}')
            (source / 'index.html').write_text('page')
            (source / 'data/meta.json').write_text('{}')
            stage(source, target)
            self.assertFalse((target / 'data/history').exists())
            self.assertTrue((source / 'data/history/manifest.json').exists())
            self.assertTrue((target / 'data/meta.json').exists())
            self.assertEqual((target / 'index.html').read_text(), 'page')
