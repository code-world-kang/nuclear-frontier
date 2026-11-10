import subprocess
import tempfile
import unittest
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from rebase_generated import rebase


class RebaseGeneratedTests(unittest.TestCase):
    def test_only_generated_conflicts_are_resolved(self):
        for name, allowed in [('site/data/meta.json', True), ('data/personal/state.json', False)]:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as root:
                def git(*args):
                    return subprocess.run(['git', *args], cwd=root, check=True, capture_output=True, text=True).stdout.strip()
                git('init', '-b', 'main')
                git('config', 'user.name', 'Test')
                git('config', 'user.email', 'test@example.invalid')
                path = Path(root) / name
                path.parent.mkdir(parents=True)
                path.write_text('base\n')
                git('add', '.'); git('commit', '-m', 'base')
                git('checkout', '-b', 'snapshot')
                path.write_text('snapshot\n')
                git('commit', '-am', 'snapshot')
                git('checkout', 'main')
                path.write_text('new upstream\n')
                git('commit', '-am', 'upstream')
                upstream = git('rev-parse', 'HEAD')
                git('checkout', 'snapshot')
                if allowed:
                    rebase('main', cwd=root)
                    self.assertEqual(path.read_text(), 'new upstream\n')
                    self.assertEqual(git('rev-parse', 'HEAD'), upstream)
                    self.assertEqual(git('status', '--porcelain'), '')
                else:
                    with self.assertRaisesRegex(RuntimeError, 'Non-generated'):
                        rebase('main', cwd=root)
                    self.assertIn('UU', git('status', '--porcelain'))
