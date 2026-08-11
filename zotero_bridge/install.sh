#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="${0:A:h}"
APP_NAME="小康康 Zotero 桥"
APP_PATH="$SCRIPT_DIR/$APP_NAME.app"

chmod +x "$APP_PATH/Contents/MacOS/bridge-launcher"

# 用 macOS 登录项启动，避免修改用户 LaunchAgents 目录权限。
/usr/bin/osascript - "$APP_NAME" "$APP_PATH" <<'APPLESCRIPT'
on run argv
  set appName to item 1 of argv
  set appPath to item 2 of argv
  tell application "System Events"
    try
      delete every login item whose name is appName
    end try
    make login item at end with properties {name:appName, path:appPath, hidden:true}
  end tell
end run
APPLESCRIPT

/usr/bin/open "$APP_PATH"
echo "Zotero 本机桥已启动，并设为登录后自动运行。"
