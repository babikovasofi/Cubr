#!/usr/bin/env bash
# SessionStart hook: inject the Memory Bank micro-digest into the agent's context.
# Defensive: prints nothing and exits 0 if the index is missing.
# Bloat guard: index must stay a pointer map (<= 25 lines); past LIMIT lines only
# the head is injected plus a warning, so a bloated index can't silently tax
# every session.
set -euo pipefail
INDEX=".memory-bank/index.md"
LIMIT=40
[ -f "$INDEX" ] || exit 0
echo "===== PROJECT MEMORY BANK (auto-injected) ====="
if [ "$(wc -l < "$INDEX")" -gt "$LIMIT" ]; then
  head -n "$LIMIT" "$INDEX"
  echo "[index.md exceeds ${LIMIT} lines — truncated. Shrink it back to a pointer map (max 25 lines); rules: steerings/development-conventions.md.]"
else
  cat "$INDEX"
fi
echo "===== END MEMORY BANK ====="
