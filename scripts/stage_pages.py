"""Stage page assets; public JSON data stays in the public repository."""
from pathlib import Path
import shutil


def stage(source, target):
    source, target = Path(source), Path(target)
    # Copy into a dedicated build artifact, never remove files from the source site.
    if target.exists():
        shutil.rmtree(target)
    def ignore(folder, names):
        return ['data'] if Path(folder) == source and 'data' in names else []
    shutil.copytree(source, target, ignore=ignore)


if __name__ == '__main__':
    root = Path(__file__).resolve().parents[1]
    stage(root / 'site', root / 'output/pages')
