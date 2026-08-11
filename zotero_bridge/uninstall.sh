#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="${0:A:h}"
APP_NAME="小康康 Zotero 桥"

/usr/bin/osascript - "$APP_NAME" <<'APPLESCRIPT'
on run argv
  tell application "System Events"
    try
      delete every login item whose name is item 1 of argv
    end try
  end tell
end run
APPLESCRIPT

/usr/bin/pkill -f "$SCRIPT_DIR/bridge.py" 2>/dev/null || true
echo "Zotero 本机桥已停止，并从登录项移除。"
