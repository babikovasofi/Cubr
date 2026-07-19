#!/usr/bin/env bash
# SessionStart hook: print the Memory Bank index into the agent's context.
# Defensive: prints nothing and exits 0 if the index is missing.
set -euo pipefail
INDEX=".memory-bank/index.md"
[ -f "$INDEX" ] || exit 0
echo "===== PROJECT MEMORY BANK (auto-injected) ====="
cat "$INDEX"
echo "===== END MEMORY BANK ====="
