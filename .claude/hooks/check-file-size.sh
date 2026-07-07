#!/usr/bin/env bash
# PostToolUse hook: warn when an edited file exceeds the line limit.
# Non-blocking (always exits 0). Reads tool JSON on stdin.
set -euo pipefail
LIMIT="${FILE_LINE_LIMIT:-400}"
input="$(cat)"
path=""
if command -v jq >/dev/null 2>&1; then
  path="$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty' 2>/dev/null || true)"
else
  for P in python3 python py; do
    command -v "$P" >/dev/null 2>&1 || continue
    path="$(printf '%s' "$input" | "$P" -c 'import json,sys
try: print(json.load(sys.stdin).get("tool_input",{}).get("file_path","") or "")
except Exception: pass' 2>/dev/null || true)"
    [ -n "$path" ] && break
  done
fi
[ -n "$path" ] && [ -f "$path" ] || exit 0
lines="$(wc -l < "$path" | tr -d ' ')"
if [ "$lines" -gt "$LIMIT" ]; then
  echo "WARN: $path = $lines lines (limit $LIMIT). Consider decomposing." >&2
fi
exit 0
