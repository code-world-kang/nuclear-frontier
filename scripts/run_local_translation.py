#!/usr/bin/env python3
"""本机 Sol 翻译并自动发布：临时处理数据，失败留待重传，不改日常工作区。"""
from __future__ import annotations

import argparse
import datetime as dt
import fcntl
import json
import hashlib
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time

import translate_codex as sol
from translation_feed import MANIFEST, batch_path, load_translations

ROOT = Path(__file__).resolve().parents[1]
REPOSITORY = "code-world-kang/nuclear-frontier"
WORKFLOW = "update-and-deploy.yml"
SNAPSHOT_FILES = (
    "data/papers.json", "data/news.json", "data/notices.json", "data/translations.zh-CN.json",
    "data/translation-sol-retries.json", "data/personal/state.json", "config/translation-glossary.json",
)
PUBLISH_FILES = (
    "data/translations.zh-CN.json", "data/translation-sol-retries.json",
    "data/translation-run.json", "data/translation-queue.json",
)


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat()


class CommandError(RuntimeError):
    def __init__(self, message, status=None):
        super().__init__(message)
        self.status = status


class GitHub:
    def __init__(self, root=ROOT):
        self.root = root
        self.env = os.environ.copy()
        self.proxy = self.env.get("HTTPS_PROXY") or self.env.get("https_proxy")

    def command(self, args, *, payload=None, timeout=180, output=None):
        result = subprocess.run(args, input=payload, stdout=output or subprocess.PIPE,
                                stderr=subprocess.PIPE, text=True, cwd=self.root,
                                env=self.env, timeout=timeout)
        if result.returncode:
            match = re.search(r"HTTP\s+(\d{3})", result.stderr)
            status = int(match[1]) if match else None
            # 不把原始 stderr/环境/认证信息写入网站或日志。
            raise CommandError(f"{args[0]} 请求失败" + (f"（HTTP {status}）" if status else "，请检查网络与登录"), status)
        return result.stdout or ""

    def api(self, endpoint, method="GET", payload=None):
        args = ["gh", "api", f"repos/{REPOSITORY}/{endpoint}", "--method", method]
        if payload is not None:
            args += ["--input", "-"]
        raw = self.command(args, payload=json.dumps(payload, ensure_ascii=False) if payload is not None else None)
        return json.loads(raw) if raw.strip() else None

    def snapshot(self, folder):
        remote = self.command(["git", "remote", "get-url", "origin"]).strip()
        if remote not in (f"https://github.com/{REPOSITORY}.git", f"https://github.com/{REPOSITORY}",
                          f"git@github.com:{REPOSITORY}.git"):
            raise RuntimeError("工作区 origin 不是预期的网站仓库，停止发布")
        git = ["git"]
        if self.proxy:
            git += ["-c", f"http.https://github.com.proxy={self.proxy}"]
        self.command(git + ["fetch", "--no-tags", "origin", "main"])
        sha = self.command(["git", "rev-parse", "FETCH_HEAD"]).strip()
        if not re.fullmatch(r"[0-9a-f]{40}", sha):
            raise RuntimeError("无法确认远端版本")
        historical = self.command([
            "git", "ls-tree", "-r", "--name-only", sha, "--", "data/history/papers", "data/translation-feed",
        ]).splitlines()
        if any(not (re.fullmatch(r"data/history/papers/\d{4}/\d{2}\.json", name) or
                    name == MANIFEST or re.fullmatch(r"data/translation-feed/batches/[0-9a-f]{64}\.json", name))
               for name in historical):
            raise RuntimeError("历史论文分片路径不符合预期，停止读取")
        for name in (*SNAPSHOT_FILES, *historical):
            path = folder / name
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open("w", encoding="utf-8") as stream:
                self.command(["git", "show", f"{sha}:{name}"], output=stream)
        if (folder / MANIFEST).exists():
            sol.write_json(folder / "data/translations.zh-CN.json", load_translations(folder / "data"))
        return sha

    def commit(self, folder, base, files=PUBLISH_FILES):
        base_tree = self.api(f"git/commits/{base}")["tree"]["sha"]
        tree = []
        for name in files:
            if name not in PUBLISH_FILES and name != MANIFEST and not re.fullmatch(r"data/translation-feed/batches/[0-9a-f]{64}\.json", name):
                raise ValueError("禁止发布非译文文件")
            print(f"正在上传 {name}（{(folder / name).stat().st_size:,} 字节）", flush=True)
            blob = self.api("git/blobs", "POST", {
                "content": (folder / name).read_text(encoding="utf-8"), "encoding": "utf-8"})
            tree.append({"path": name, "mode": "100644", "type": "blob", "sha": blob["sha"]})
        tree_sha = self.api("git/trees", "POST", {"base_tree": base_tree, "tree": tree})["sha"]
        commit = self.api("git/commits", "POST", {
            "message": "data: 本机 Sol 自动补译并更新发布状态", "tree": tree_sha, "parents": [base]})["sha"]
        try:
            self.api("git/refs/heads/main", "PATCH", {"sha": commit, "force": False})
        except (CommandError, subprocess.SubprocessError):
            # 响应中断时先确认是否已提交，避免把成功提交误判为失败。
            if self.api("git/ref/heads/main")["object"]["sha"] != commit:
                raise
        return commit

    def confirm_incremental(self, state):
        # Public, unauthenticated read: no login material is sent to the data endpoint.
        commit = state["commit"]
        if not re.fullmatch(r"[0-9a-f]{40}", commit):
            raise ValueError("Invalid feed commit")
        for name, digest in state["public_files"].items():
            if name != MANIFEST and name != batch_path(digest):
                raise ValueError("Invalid public translation path")
            raw = self.command(["curl", "--fail", "--silent", "--show-error", "--max-time", "45",
                                f"https://raw.githubusercontent.com/{REPOSITORY}/{commit}/{name}"], timeout=50)
            if hashlib.sha256(raw.encode()).hexdigest() != digest:
                raise RuntimeError("增量译文尚未通过公开读取确认；已保留待重传记录")
        return f"https://github.com/{REPOSITORY}/commit/{commit}"

    def find_deployment(self, commit):
        runs = self.api(f"actions/workflows/{WORKFLOW}/runs?event=workflow_dispatch&per_page=30")
        matches = [run for run in runs["workflow_runs"] if run.get("display_title") == f"发布翻译 {commit}"]
        return max(matches, key=lambda run: run["id"]) if matches else None

    def dispatch(self, commit):
        self.api(f"actions/workflows/{WORKFLOW}/dispatches", "POST", {
            "ref": "main", "inputs": {"deploy_only": True, "translation_commit": commit}})


def make_bundle(before, after, old_retries, new_retries, report, scheduled):
    changed = {key: value for key, value in after.get("items", {}).items()
               if value != before.get("items", {}).get(key)}
    retry_delta = {key: new_retries.get(key) for key in set(old_retries) | set(new_retries)
                   if old_retries.get(key) != new_retries.get(key)}
    return {"records": changed, "retries": retry_delta,
            "report": {**report, "automatic": scheduled, "execution_location": "local",
                       "finished_at": report.get("finished_at") or now()}}


def merge_bundle(folder, bundle):
    """只合并本批新增译文；并发更新、个人数据和已完成译文以最新仓库为准。"""
    payload = sol.read(folder / "data/translations.zh-CN.json", {"items": {}})
    existing = payload.setdefault("items", {})
    sources = {key: item for item in sol.records(folder) for key in [item["id"], *item.get("record_aliases", [])]}
    written, stale, skipped = [], [], []
    for key, record in bundle["records"].items():
        item = sources.get(key)
        if not item or sol.source_hash(item) != record["source_hash"]:
            stale.append(key)
            continue
        if not sol.needs_translation(item, existing):
            skipped.append(key)
            continue
        # 不做内容校验；保留翻译期间在网站新增的中文题目。
        merged = sol.translation_record(item, record, sol.translation_for(item, existing))
        merged["translated_at"] = record["translated_at"]
        sol.store_translation(payload, item, merged)
        written.append(item["id"])
    payload.update({"generated_at": now(), "provider": "mixed",
                    "provider_note": "来源以条目 provider/model/note 为准。"})
    retries = sol.read(folder / "data/translation-sol-retries.json", {})
    for key, retry in bundle["retries"].items():
        # 新源文对应的重试记录不能被旧批次覆盖。
        source = sources.get(key)
        if retry is None:
            if key in written or (source and not sol.needs_translation(source, existing)):
                retries.pop(key, None)
        elif source and retry.get("source_hash") == sol.source_hash(source) and sol.needs_translation(source, existing):
            retries[key] = retry
    for key in written:
        retries.pop(key, None)
    remaining = sol.pending(folder, existing)
    report = {**bundle["report"], "completed": len(written), "published_ids": written,
              "skipped_already_translated": len(skipped), "deferred_source_changed": len(stale),
              "pending": len(remaining), "publication_started_at": now()}
    report["pending_papers"] = sum(item.get("type", "paper") == "paper" for item in remaining)
    report["deferred"] = report.get("deferred", 0) + len(stale)
    report["service_status"] = ("partial" if report.get("failed") or stale else "ready")
    if report.get("failed") and not written:
        report["service_status"] = "failed"
    sol.write_json(folder / "data/translations.zh-CN.json", payload)
    sol.write_json(folder / "data/translation-sol-retries.json", retries)
    sol.write_json(folder / "data/translation-run.json", report)
    sol.write_json(folder / "data/translation-queue.json", sol.queue_payload(remaining, sol.MODEL, "local_scheduled" if report["automatic"] else "manual"))
    return report


def publish(client, bundle):
    for attempt in range(3):
        with tempfile.TemporaryDirectory(prefix="nuclear-publish-") as path:
            folder = Path(path)
            base = client.snapshot(folder)
            report = merge_bundle(folder, bundle)
            try:
                return client.commit(folder, base), report
            except CommandError as error:
                if error.status not in (409, 422) or attempt == 2:
                    raise
                # 只重新合并并推送，不重新调用模型，也不强推覆盖其他提交。
    raise RuntimeError("远端持续更新，本批保留到下次重传")


def publish_incremental(client, bundle=None, legacy=None):
    for attempt in range(3):
        with tempfile.TemporaryDirectory(prefix="nuclear-feed-") as path:
            folder = Path(path)
            base = client.snapshot(folder)
            before = sol.read(folder / "data/translations.zh-CN.json")["items"]
            if legacy:
                # An old Pages outbox already committed its translations. Verify ancestry,
                # expose its current statistics, and never ask the model to redo the batch.
                client.command(["git", "merge-base", "--is-ancestor", legacy["commit"], base])
                report = dict(legacy["report"])
                after = before
            else:
                report = merge_bundle(folder, bundle)
                after = sol.read(folder / "data/translations.zh-CN.json")["items"]
            papers = [x for x in sol.records(folder) if x.get("type", "paper") == "paper"]
            pending = sum(sol.needs_translation(x, after) for x in papers)
            native = sum(not sol.needs_translation(x, {}) for x in papers)
            library = {"total": len(papers), "pending": pending, "complete": len(papers) - pending,
                       "native": native, "translated": len(papers) - pending - native}
            report.update(pending_papers=pending, publication_mode="incremental")
            changed = {key: value for key, value in after.items() if value != before.get(key)}
            manifest = sol.read(folder / MANIFEST, {"version": 1, "batches": []})
            files = [] if legacy else [x for x in PUBLISH_FILES if x != "data/translations.zh-CN.json"]
            public_files = {}
            if changed:
                batch = {"version": 1, "items": changed, "previous": {key: before.get(key) for key in changed}}
                raw = json.dumps(batch, ensure_ascii=False, indent=2) + "\n"
                digest = hashlib.sha256(raw.encode()).hexdigest()
                name = batch_path(digest)
                target = folder / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(raw, encoding="utf-8")
                if digest not in manifest["batches"]:
                    manifest["batches"].append(digest)
                files.append(name)
                public_files[name] = digest
            manifest.update(updated_at=now(), report=report, paper_library=library)
            (folder / MANIFEST).parent.mkdir(parents=True, exist_ok=True)
            sol.write_json(folder / MANIFEST, manifest)
            public_files[MANIFEST] = hashlib.sha256((folder / MANIFEST).read_bytes()).hexdigest()
            files.append(MANIFEST)
            try:
                commit = client.commit(folder, base, files=files)
                return {"phase": "feed_committed", "commit": commit, "report": report, "public_files": public_files}
            except CommandError as error:
                if error.status not in (409, 422) or attempt == 2:
                    raise
    raise RuntimeError("远端持续更新，保留本批到下次重传")


def complete_deployment(client, state, save, timeout):
    commit = state["commit"]
    run = client.find_deployment(commit)
    if run and run["status"] == "completed" and run["conclusion"] == "success":
        return run
    previous_failed_id = run["id"] if run and run["status"] == "completed" else None
    if not run or run["status"] == "completed":
        # 先记尝试时间；响应丢失时下一轮先找同一提交的工作流，避免立即重复触发。
        dispatched_at = state.get("dispatched_at")
        if (not dispatched_at or time.time() - dispatched_at > 180 or
                (previous_failed_id and state.get("dispatched_after_run") != previous_failed_id)):
            state["dispatched_at"] = time.time()
            state["dispatched_after_run"] = previous_failed_id
            save(state)
            client.dispatch(commit)
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        run = client.find_deployment(commit)
        if run and run["status"] == "completed":
            if run["id"] == previous_failed_id:
                time.sleep(10)
                continue
            if run["conclusion"] != "success":
                raise RuntimeError(f"网站发布未成功：{run['html_url']}")
            return run
        time.sleep(10)
    raise RuntimeError("译文已提交，网站发布仍待确认；下次继续检查，不重复翻译")


def run(args, root=ROOT, client=None):
    runtime = root / "output/local-translation"
    runtime.mkdir(parents=True, exist_ok=True, mode=0o700)
    runtime.chmod(0o700)
    outbox = runtime / "pending.json"
    status_file = runtime / "status.json"
    def save(value):
        sol.write_json(outbox, value)
        outbox.chmod(0o600)
    client = client or GitHub(root)
    with (runtime / "run.lock").open("a+") as lock, (root / "output/translation-worker.lock").open("a+") as model_lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            fcntl.flock(model_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return {"status": "busy", "message": "上一轮仍在运行，本轮不重复启动"}
        state = sol.read(outbox, {})
        try:
            if args.dry_run and state:
                return {"status": "pending", "phase": state["phase"], "dry_run": True}
            if not state:
                with tempfile.TemporaryDirectory(prefix="nuclear-local-") as path:
                    work = Path(path)
                    client.snapshot(work)
                    before = sol.read(work / "data/translations.zh-CN.json", {"items": {}})
                    retries = sol.read(work / "data/translation-sol-retries.json", {})
                    def checkpoint(payload, current_retries, report):
                        if report["attempted"]:
                            save({"phase": "translated", "bundle": make_bundle(
                                before, payload, retries, current_retries, report, args.scheduled)})
                    report = sol.run(args, work, on_checkpoint=checkpoint)
                    if args.dry_run or not report.get("attempted"):
                        result = {"status": "idle", "finished_at": now(), "report": report}
                        sol.write_json(status_file, result)
                        return result
                state = sol.read(outbox)
            if getattr(args, "incremental", False) and state["phase"] in ("translated", "committed"):
                state = publish_incremental(client, bundle=state.get("bundle"),
                                            legacy=state if state["phase"] == "committed" else None)
                save(state)
            if state["phase"] == "feed_committed":
                url = client.confirm_incremental(state)
                result = {"status": "published", "finished_at": now(), "commit": state["commit"],
                          "publication_mode": "incremental", "deployment_url": url, "report": state["report"]}
                sol.write_json(status_file, result)
                outbox.unlink(missing_ok=True)
                return result
            if state["phase"] == "translated":
                commit, report = publish(client, state["bundle"])
                state = {"phase": "committed", "commit": commit, "report": report}
                save(state)
                print(f"译文已提交 GitHub：{commit[:8]}；正在发布网站。", flush=True)
            deployed = complete_deployment(client, state, save, args.deploy_timeout)
            result = {"status": "published", "finished_at": now(), "commit": state["commit"],
                      "deployment_url": deployed["html_url"], "report": state["report"]}
            sol.write_json(status_file, result)
            outbox.unlink(missing_ok=True)
            return result
        except Exception as error:
            sol.write_json(status_file, {"status": "failed", "finished_at": now(),
                                        "error": str(error) if isinstance(error, RuntimeError) else type(error).__name__,
                                        "pending_retained": outbox.exists()})
            raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, default=100)
    parser.add_argument("--batch-size", type=int, default=4)
    parser.add_argument("--workers", type=int, default=1, choices=range(1, 11), help="并行模型请求数（1—10）；保存与发布仍串行")
    parser.add_argument("--max-minutes", type=float, default=30)
    parser.add_argument("--deploy-timeout", type=float, default=480)
    parser.add_argument("--ids", default="")
    parser.add_argument("--papers-only", action="store_true", help="仅翻译论文，包含全部历史分片")
    parser.add_argument("--retry-failed", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--scheduled", action="store_true")
    parser.add_argument("--incremental", action="store_true", help="只提交新增译文批次，公开读取确认后继续，不等待 Pages")
    args = parser.parse_args()
    if args.limit < 1 or not 1 <= args.batch_size <= 5 or args.max_minutes <= 0 or args.deploy_timeout <= 0:
        parser.error("数量与时间必须为正，每批 1—5 条")
    try:
        result = run(args)
        print(json.dumps(result, ensure_ascii=False, indent=2))
    except (RuntimeError, OSError, ValueError, subprocess.SubprocessError) as error:
        print(f"本轮未完成：{error if isinstance(error, RuntimeError) else type(error).__name__}；已完成译文如有则保留待重传。", flush=True)
        raise SystemExit(1)
    if result.get("report", {}).get("failed"):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
