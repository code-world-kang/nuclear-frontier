import json
import fcntl
from argparse import Namespace
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import run_local_translation as local
from translation_feed import load_translations, MANIFEST
import translate_codex as sol


class LocalTranslationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.remote = self.root / "remote"
        self.remote.mkdir()
        self.item = {"id": "p", "type": "paper", "title": "Nuclear structure", "abstract": "A nuclear study."}
        self.value = {"id": "p", "title_zh": "核结构", "abstract_zh": "一项核物理研究。"}
        self.personal = {"personal": {"favorites": {"x": {"notes": "保留笔记"}}}}
        for name, content in {
            "data/papers.json": [self.item], "data/news.json": [], "data/notices.json": [],
            "data/translations.zh-CN.json": {"items": {"old": {"title_zh": "历史译文"}}},
            "data/translation-sol-retries.json": {}, "data/personal/state.json": self.personal,
            "config/translation-glossary.json": {},
        }.items():
            self.save(name, content)
        self.args = Namespace(limit=1, batch_size=1, max_minutes=1, ids="", retry_failed=False,
                              dry_run=False, scheduled=True, deploy_timeout=1)
        self.client = Mock()
        self.client.snapshot.side_effect = self.snapshot
        self.client.commit.side_effect = self.commit
        self.client.find_deployment.side_effect = lambda sha: ({"id": 123, "status": "completed",
            "conclusion": "success", "html_url": "https://github.com/test/actions/runs/123"}
            if self.client.dispatch.called else None)

    def save(self, name, content):
        path = self.remote / name
        path.parent.mkdir(parents=True, exist_ok=True)
        sol.write_json(path, content)

    def snapshot(self, folder):
        history = [str(path.relative_to(self.remote)) for path in
                   (self.remote / "data/history/papers").glob("*/*.json")]
        feed = [str(p.relative_to(self.remote)) for p in (self.remote / "data/translation-feed").rglob("*.json")]
        for name in (*local.SNAPSHOT_FILES, *history, *feed):
            target = folder / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(self.remote / name, target)
        if (folder / MANIFEST).exists():
            sol.write_json(folder / "data/translations.zh-CN.json", load_translations(folder / "data"))
        return "a" * 40

    def commit(self, folder, base, files=local.PUBLISH_FILES):
        self.assertEqual(base, "a" * 40)
        for name in files:
            (self.remote / name).parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(folder / name, self.remote / name)
        return "b" * 40

    def bundle(self):
        record = sol.translation_record(self.item, self.value, {})
        return {"records": {"p": record}, "retries": {}, "report": {
            "model": sol.MODEL, "automatic": True, "content_validation": "disabled",
            "attempted": 1, "completed": 1, "failed": 0, "deferred": 0, "errors": {}}}

    def test_incremental_saves_only_delta_and_next_round_skips_it(self):
        self.args.incremental = True
        self.client.confirm_incremental.return_value = "https://github.com/test/commit/b"
        with patch.object(sol, "request_batch", return_value={"translations": [self.value]}) as model:
            result = local.run(self.args, self.root, self.client)
            again = local.run(self.args, self.root, self.client)
        self.assertEqual(result["publication_mode"], "incremental")
        self.assertEqual(again["status"], "idle")
        self.assertEqual(model.call_count, 1)
        self.assertNotIn("p", sol.read(self.remote / "data/translations.zh-CN.json")["items"])
        self.assertEqual(load_translations(self.remote / "data")["items"]["p"]["title_zh"], "核结构")
        self.assertEqual(sol.read(self.remote / MANIFEST)["paper_library"]["pending"], 0)
        self.assertNotIn("data/translations.zh-CN.json", self.client.commit.call_args.kwargs["files"])
        self.client.dispatch.assert_not_called()
        self.assertEqual(sol.read(self.remote / "data/personal/state.json"), self.personal)

    def test_incremental_read_failure_resumes_without_model_or_commit(self):
        self.args.incremental = True
        self.client.confirm_incremental.side_effect = [RuntimeError("not readable"), "verified"]
        with patch.object(sol, "request_batch", return_value={"translations": [self.value]}) as model:
            with self.assertRaisesRegex(RuntimeError, "not readable"):
                local.run(self.args, self.root, self.client)
            outbox = self.root / "output/local-translation/pending.json"
            self.assertEqual(sol.read(outbox)["phase"], "feed_committed")
            result = local.run(self.args, self.root, self.client)
        self.assertEqual(result["status"], "published")
        self.assertEqual(model.call_count, 1)
        self.assertEqual(self.client.commit.call_count, 1)
        self.assertFalse(outbox.exists())

    def test_old_pages_pending_is_migrated_without_losing_committed_translations(self):
        self.args.incremental = True
        self.save("data/translations.zh-CN.json", {"items": {"p": sol.translation_record(self.item, self.value, {})}})
        outbox = self.root / "output/local-translation/pending.json"
        outbox.parent.mkdir(parents=True)
        sol.write_json(outbox, {"phase": "committed", "commit": "c" * 40, "report": self.bundle()["report"]})
        self.client.confirm_incremental.return_value = "verified"
        with patch.object(sol, "request_batch") as model:
            result = local.run(self.args, self.root, self.client)
        model.assert_not_called()
        self.client.dispatch.assert_not_called()
        self.assertEqual(result["report"]["completed"], 1)
        self.assertEqual(result["report"]["pending_papers"], 0)
        self.assertEqual(self.client.commit.call_args.kwargs["files"], [MANIFEST])
        self.client.command.assert_called_once_with(["git", "merge-base", "--is-ancestor", "c" * 40, "a" * 40])

    def test_end_to_end_publishes_without_changing_local_data(self):
        with patch.object(sol, "request_batch", return_value={"translations": [self.value]}):
            result = local.run(self.args, self.root, self.client)
        self.assertEqual(result["status"], "published")
        self.assertEqual(result["report"]["completed"], 1)
        self.assertTrue(result["report"]["automatic"])
        self.assertFalse((self.root / "data").exists())
        self.assertFalse((self.root / "output/local-translation/pending.json").exists())
        self.assertEqual(sol.read(self.remote / "data/personal/state.json"), self.personal)
        self.assertEqual(sol.read(self.remote / "data/translations.zh-CN.json")["items"]["old"], {"title_zh": "历史译文"})
        self.client.dispatch.assert_called_once_with("b" * 40)

    def test_upload_failure_retains_outbox_and_retries_without_model(self):
        self.client.commit.side_effect = local.CommandError("network")
        with patch.object(sol, "request_batch", return_value={"translations": [self.value]}) as model:
            with self.assertRaises(local.CommandError):
                local.run(self.args, self.root, self.client)
            self.assertTrue((self.root / "output/local-translation/pending.json").exists())
            self.client.commit.side_effect = self.commit
            local.run(self.args, self.root, self.client)
        self.assertEqual(model.call_count, 1)

    def test_historical_paper_publishes_and_resume_does_not_translate_again(self):
        self.save("data/papers.json", [])
        self.save("data/history/papers/2001/01.json", [self.item])
        self.save("data/news.json", [{**self.item, "id": "news", "type": "news"}])
        self.args.papers_only = True
        self.client.commit.side_effect = local.CommandError("network")
        with patch.object(sol, "request_batch", return_value={"translations": [self.value]}) as model:
            with self.assertRaises(local.CommandError):
                local.run(self.args, self.root, self.client)
            self.client.commit.side_effect = self.commit
            result = local.run(self.args, self.root, self.client)
        self.assertEqual(model.call_count, 1)
        self.assertEqual(result["report"]["pending_papers"], 0)
        self.assertEqual(result["report"]["pending"], 1)
        self.assertEqual(result["report"]["published_ids"], ["p"])
        self.assertNotIn("news", sol.read(self.remote / "data/translations.zh-CN.json")["items"])
        self.assertEqual(sol.read(self.remote / "data/personal/state.json"), self.personal)

    def test_changed_historical_source_is_deferred_before_publish(self):
        bundle = self.bundle()
        self.save("data/papers.json", [])
        self.save("data/history/papers/2001/01.json", [{**self.item, "abstract": "Changed history."}])
        report = local.merge_bundle(self.remote, bundle)
        self.assertEqual(report["completed"], 0)
        self.assertEqual(report["deferred_source_changed"], 1)

    def test_git_snapshot_reads_history_from_same_revision(self):
        client = local.GitHub(self.root)
        shard = "data/history/papers/2001/01.json"
        sha = "a" * 40
        def command(args, **kwargs):
            if args[:3] == ["git", "remote", "get-url"]:
                return f"https://github.com/{local.REPOSITORY}.git"
            if args[:2] == ["git", "rev-parse"]:
                return sha
            if args[:2] == ["git", "ls-tree"]:
                self.assertIn(sha, args)
                return shard + "\n"
            if args[:2] == ["git", "show"]:
                self.assertTrue(args[2].startswith(sha + ":"))
                kwargs["output"].write("[]")
            return ""
        client.command = Mock(side_effect=command)
        target = self.root / "snapshot"
        self.assertEqual(client.snapshot(target), sha)
        self.assertEqual(sol.read(target / shard), [])

    def test_git_snapshot_rejects_unexpected_history_paths(self):
        client = local.GitHub(self.root)
        client.command = Mock(side_effect=[f"https://github.com/{local.REPOSITORY}.git", "", "a" * 40,
                                           "data/history/papers/../../personal/state.json\n"])
        with self.assertRaisesRegex(RuntimeError, "分片路径"):
            client.snapshot(self.root / "snapshot")

    def test_publish_conflict_reloads_snapshot_without_force(self):
        self.client.commit.side_effect = [local.CommandError("conflict", 422), "b" * 40]
        commit, report = local.publish(self.client, self.bundle())
        self.assertEqual(commit, "b" * 40)
        self.assertEqual(self.client.snapshot.call_count, 2)
        self.assertEqual(report["completed"], 1)

    def test_completed_remote_translation_is_preserved(self):
        original = sol.translation_record(self.item, {**self.value, "title_zh": "最新人工题目"}, {})
        self.save("data/translations.zh-CN.json", {"items": {"p": original}})
        report = local.merge_bundle(self.remote, self.bundle())
        self.assertEqual(sol.read(self.remote / "data/translations.zh-CN.json")["items"]["p"], original)
        self.assertEqual(report["completed"], 0)
        self.assertEqual(report["skipped_already_translated"], 1)

    def test_changed_source_defers_without_overwriting(self):
        self.save("data/papers.json", [{**self.item, "abstract": "Updated data."}])
        report = local.merge_bundle(self.remote, self.bundle())
        self.assertEqual(report["completed"], 0)
        self.assertEqual(report["deferred_source_changed"], 1)
        self.assertNotIn("p", sol.read(self.remote / "data/translations.zh-CN.json")["items"])

    def test_remote_new_title_is_kept_while_abstract_is_filled(self):
        self.save("data/translations.zh-CN.json", {"items": {"p": {"title_zh": "新编辑的中文标题"}}})
        local.merge_bundle(self.remote, self.bundle())
        self.assertEqual(sol.read(self.remote / "data/translations.zh-CN.json")["items"]["p"]["title_zh"], "新编辑的中文标题")

    def test_only_translation_files_can_be_published(self):
        self.assertEqual(set(local.PUBLISH_FILES), {"data/translations.zh-CN.json", "data/translation-run.json",
            "data/translation-queue.json", "data/translation-sol-retries.json"})
        self.assertNotIn("data/personal/state.json", local.PUBLISH_FILES)

    def test_api_ref_update_is_fast_forward_only(self):
        local.merge_bundle(self.remote, self.bundle())
        client = local.GitHub(self.root)
        client.api = Mock(side_effect=[{"tree": {"sha": "tree"}}] + [{"sha": "blob"}] * 4 +
                          [{"sha": "new-tree"}, {"sha": "new-commit"}, {}])
        self.assertEqual(client.commit(self.remote, "base"), "new-commit")
        client.api.assert_called_with("git/refs/heads/main", "PATCH", {"sha": "new-commit", "force": False})

    def test_deploy_only_dispatch_never_starts_collection(self):
        client = local.GitHub(self.root)
        client.api = Mock()
        client.dispatch("b" * 40)
        payload = client.api.call_args.args[2]
        self.assertTrue(payload["inputs"]["deploy_only"])
        self.assertEqual(payload["inputs"]["translation_commit"], "b" * 40)

    def test_workflow_keeps_daily_collection_but_skips_it_on_translation_publish(self):
        workflow = (Path(__file__).resolve().parents[1] / ".github/workflows/update-and-deploy.yml").read_text()
        self.assertIn('cron: "0 22 * * *"', workflow)
        self.assertEqual(workflow.count("if: github.event_name != 'push' && inputs.deploy_only != true"), 4)
        self.assertIn("translation_commit:", workflow)
        self.assertNotIn("scripts/translate_codex.py", workflow)

    def test_pending_dry_run_does_not_publish(self):
        path = self.root / "output/local-translation/pending.json"
        path.parent.mkdir(parents=True)
        sol.write_json(path, {"phase": "translated", "bundle": self.bundle()})
        self.args.dry_run = True
        result = local.run(self.args, self.root, self.client)
        self.assertEqual(result["status"], "pending")
        self.client.commit.assert_not_called()

    def test_manual_translation_lock_prevents_duplicate_automatic_run(self):
        (self.root / "output").mkdir()
        with (self.root / "output/translation-worker.lock").open("w") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            result = local.run(self.args, self.root, self.client)
        self.assertEqual(result["status"], "busy")
        self.client.snapshot.assert_not_called()

    def test_previously_published_commit_only_waits_for_deployment(self):
        path = self.root / "output/local-translation/pending.json"
        path.parent.mkdir(parents=True)
        sol.write_json(path, {"phase": "committed", "commit": "b" * 40, "report": {"completed": 1}})
        with patch.object(sol, "request_batch") as model:
            result = local.run(self.args, self.root, self.client)
        model.assert_not_called()
        self.client.commit.assert_not_called()
        self.assertEqual(result["status"], "published")

    def test_older_failed_run_does_not_mask_new_deployment(self):
        failed = {"id": 1, "status": "completed", "conclusion": "failure", "html_url": "failed"}
        success = {"id": 2, "status": "completed", "conclusion": "success", "html_url": "success"}
        self.client.find_deployment.side_effect = [failed, failed, success]
        with patch.object(local.time, "sleep"):
            result = local.complete_deployment(self.client, {"commit": "x"}, lambda _: None, 2)
        self.assertEqual(result["id"], 2)


if __name__ == "__main__":
    unittest.main()
