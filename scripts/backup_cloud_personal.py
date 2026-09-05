#!/usr/bin/env python3
"""将指定的公开 EdgeOne 个人快照备份到仓库；默认不连接任何未知地址。"""
import datetime as dt
import json
import os
import urllib.parse
import urllib.request
from pathlib import Path

from sync_github_issue import clean_state

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / 'data/personal/state.json'


def validated_snapshot(payload):
    if not isinstance(payload, dict) or payload.get('version') != 1 or not isinstance(payload.get('personal'), dict):
        raise ValueError('云端不是有效的个人快照，拒绝覆盖仓库')
    value = payload['personal']
    for field in ('favorites', 'readStatus', 'notes', 'translationFavorites'):
        if not isinstance(value.get(field), dict):
            raise ValueError('云端快照字段不完整，拒绝覆盖仓库')
    for field in ('keywords', 'translationGlossary', 'codeItems', 'resources', 'hiddenPublicFavorites', 'ignoredItems'):
        if not isinstance(value.get(field), list):
            raise ValueError('云端快照字段不完整，拒绝覆盖仓库')
    timestamp = dt.datetime.fromisoformat(str(payload.get('updated_at', '')).replace('Z', '+00:00'))
    if timestamp.tzinfo is None:
        raise ValueError('快照时间缺少时区')
    return clean_state(payload), timestamp


def main():
    endpoint = os.environ.get('PERSONAL_STATE_URL', '').strip()
    if not endpoint:
        print('未配置国内主站公开快照地址；本次不改动个人数据。')
        return
    parsed = urllib.parse.urlsplit(endpoint)
    if parsed.scheme != 'https' or parsed.path.rstrip('/') != '/api/personal-state' or parsed.username or parsed.password or parsed.query:
        raise ValueError('请配置国内主站的 HTTPS /api/personal-state 地址')
    request = urllib.request.Request(endpoint, headers={'Accept': 'application/json', 'User-Agent': 'NuclearFrontierBackup/1.0'})
    with urllib.request.urlopen(request, timeout=30) as response:
        if response.headers.get('X-Nuclear-Frontier-Cloud') != 'edgeone':
            raise ValueError('不是已知云同步接口，未修改仓库数据')
        raw = response.read(2 * 1024 * 1024 + 1)
    if len(raw) > 2 * 1024 * 1024:
        raise ValueError('云端快照超过大小限制')
    payload = json.loads(raw)
    if not payload.get('updated_at'):
        print('云端尚无已保存快照，保留仓库现有数据。')
        return
    cleaned, cloud_time = validated_snapshot(payload)
    previous = json.loads(TARGET.read_text()) if TARGET.exists() else {}
    previous_time = dt.datetime.fromisoformat(previous['updated_at'].replace('Z', '+00:00')) if previous.get('updated_at') else dt.datetime.min.replace(tzinfo=dt.timezone.utc)
    if cloud_time <= previous_time:
        print('仓库快照不旧于云端，无需覆盖。')
        return
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    temporary = TARGET.with_suffix('.tmp')
    temporary.write_text(json.dumps(cleaned, ensure_ascii=False, indent=2) + '\n')
    temporary.replace(TARGET)
    print('云端个人快照已写入仓库工作区，提交后可通过 Git 历史恢复。')


if __name__ == '__main__':
    main()
