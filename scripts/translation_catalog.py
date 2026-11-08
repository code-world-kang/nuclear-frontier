"""读取日常与历史翻译源；只读源文件，沿用网站的论文身份归并。"""
from functools import lru_cache
import json
from pathlib import Path


def source_paths(data):
    data = Path(data)
    return [data / f"{name}.json" for name in ("papers", "news", "notices")] + sorted(
        (data / "history" / "papers").glob("*/*.json"))


@lru_cache(maxsize=1)
def _read_sources(signature):
    # 延迟导入，避免 paper_identity -> translate_content 的循环初始化。
    from paper_identity import merge_papers
    values = [json.loads(Path(path).read_text(encoding="utf-8")) if modified is not None else []
              for path, modified, _ in signature]
    papers, news, notices, *history = values
    if history:
        # 日常库在前，和网站构建一样保留日常 ID 及跨月份版本别名。
        papers = merge_papers([*papers, *(item for month in history for item in month)])
    return papers + news + notices


def source_records(root=None, *, data=None):
    # 每批检查源文件状态，既避免反复解析全库，也能发现翻译期间的源文修改。
    signature = []
    for index, path in enumerate(source_paths(data if data is not None else Path(root) / "data")):
        try:
            stat = path.stat()
        except FileNotFoundError:
            if index >= 3:
                raise
            signature.append((str(path.resolve()), None, None))
        else:
            signature.append((str(path.resolve()), stat.st_mtime_ns, stat.st_size))
    return _read_sources(tuple(signature))
