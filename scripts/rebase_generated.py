"""Rebase a CI snapshot; regenerate derived files instead of merging stale statistics."""
import subprocess


def rebase(ref="origin/main", cwd=None):
    def git(*args, **kwargs):
        return subprocess.run(["git", *args], cwd=cwd, text=True, **kwargs)
    result = git("rebase", ref)
    if not result.returncode:
        return
    conflicted = git("diff", "--name-only", "--diff-filter=U", "-z", capture_output=True, check=True).stdout.rstrip("\0").split("\0")
    def generated(path):
        return path == "data/translation-queue.json" or path.startswith(("site/data/", "site/wechat-digest/", "wechat-official-account/"))
    if not conflicted or not all(generated(path) for path in conflicted):
        raise RuntimeError("Non-generated data conflict; refusing automatic replacement")
    # During rebase, ours is the latest upstream version. The caller rebuilds all
    # derived data after this step using the newly merged sources and feed.
    git("checkout", "--ours", "--", *conflicted, check=True)
    git("add", "--", *conflicted, check=True)
    empty = git("diff", "--cached", "--quiet").returncode == 0
    git("-c", "core.editor=true", "rebase", "--skip" if empty else "--continue", check=True)


if __name__ == "__main__":
    rebase()
