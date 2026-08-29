#!/usr/bin/env bash
# Installs a macOS LaunchAgent so the ytx server starts at login and stays up.
# Run scripts/setup-ytx.sh first. Usage: ./scripts/install-autostart-macos.sh [port]
set -euo pipefail

PORT="${1:-8722}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
YTX="$ROOT/server/ytx"
UVICORN="$YTX/.venv/bin/uvicorn"
LABEL="com.yavar.ytx"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

if [ ! -x "$UVICORN" ]; then
  echo "❌ ytx isn't set up yet ($UVICORN not found)."
  echo "   Run this first:  $SCRIPT_DIR/setup-ytx.sh"
  exit 1
fi

# Include Homebrew's bin only if it exists, so this works on Intel + Apple Silicon.
BREW_PATH=""
[ -d /opt/homebrew/bin ] && BREW_PATH="/opt/homebrew/bin:"
[ -d /usr/local/bin ] && BREW_PATH="${BREW_PATH}/usr/local/bin:"

mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$LABEL</string>
    <key>ProgramArguments</key>
    <array>
        <string>$UVICORN</string>
        <string>ytx_api.main:app</string>
        <string>--host</string>
        <string>127.0.0.1</string>
        <string>--port</string>
        <string>$PORT</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$YTX</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>${BREW_PATH}/usr/bin:/bin:/usr/sbin:/sbin</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>$HOME/Library/Logs/ytx.out.log</string>
    <key>StandardErrorPath</key>
    <string>$HOME/Library/Logs/ytx.err.log</string>
</dict>
</plist>
EOF

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load -w "$PLIST"

echo "✅ ytx auto-start installed (port $PORT)."
echo "   Verify:  curl -s http://127.0.0.1:$PORT/health"
echo "   Logs:    ~/Library/Logs/ytx.out.log  and  ytx.err.log"
echo "   Remove:  launchctl unload -w \"$PLIST\" && rm \"$PLIST\""
