#!/bin/bash
set -euo pipefail

PY_USER_BASE="$(python3 -m site --user-base 2>/dev/null || true)"
if [ -n "$PY_USER_BASE" ]; then
  export PATH="$PY_USER_BASE/bin:$PATH"
fi
export PATH="$HOME/.local/bin:$PATH"

install_python_tool() {
  local package_name="$1"
  local first_error
  first_error="$(mktemp)"
  if python3 -m pip install --user "$package_name" --quiet > /dev/null 2>"$first_error"; then
    rm -f "$first_error"
    return 0
  fi
  if python3 -m pip install "$package_name" --break-system-packages --quiet; then
    rm -f "$first_error"
    return 0
  fi
  cat "$first_error" >&2
  rm -f "$first_error"
  return 1
}

if ! command -v streamlink >/dev/null 2>&1; then
  echo "Installing streamlink for local stream capture..."
  install_python_tool streamlink
fi

if ! command -v yt-dlp >/dev/null 2>&1; then
  echo "Installing yt-dlp fallback for local stream capture..."
  install_python_tool yt-dlp
fi

echo "Starting Clipping Office on port ${PORT:-4177}..."
exec node server.js
