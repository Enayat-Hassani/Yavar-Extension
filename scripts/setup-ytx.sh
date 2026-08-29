#!/usr/bin/env bash
# Sets up the ytx transcript server that powers Yavar's "Add video" and
# "Search videos" features. Clones ytx into ./server/ytx and installs its
# dependencies. Safe to re-run — it updates an existing checkout.
set -euo pipefail

YTX_URL="https://github.com/Enayat-Hassani/youtube-transcript-extractor.git"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DEST="$ROOT/server/ytx"

if ! command -v uv >/dev/null 2>&1; then
  echo "❌ 'uv' is not installed (ytx uses it to manage its Python env)."
  echo "   Install it, then re-run this script:"
  echo "     curl -LsSf https://astral.sh/uv/install.sh | sh"
  echo "   (docs: https://docs.astral.sh/uv/)"
  exit 1
fi

if [ -d "$DEST/.git" ]; then
  echo "↻ Updating ytx in $DEST"
  git -C "$DEST" pull --ff-only
else
  echo "⬇︎  Cloning ytx into $DEST"
  mkdir -p "$ROOT/server"
  git clone "$YTX_URL" "$DEST"
fi

echo "📦 Installing ytx dependencies (uv sync)…"
( cd "$DEST" && uv sync --all-packages )

echo
echo "✅ ytx is ready."
echo
echo "Run it (leave it running in a terminal):"
echo "    cd \"$DEST\" && uv run uvicorn ytx_api.main:app --host 127.0.0.1 --port 8722"
echo
echo "Or keep it always-on:"
echo "  • macOS:        $SCRIPT_DIR/install-autostart-macos.sh"
echo "  • Windows/Linux: see the README (Task Scheduler / systemd)"
echo
echo "The extension expects it at http://localhost:8722 (change in Settings if needed)."
