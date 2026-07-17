#!/usr/bin/env bash
# Remove transient run-piers only. NEVER touches golden piers (which are
# reused, copy-on-write clones). Safe to run anytime; no prompts once the
# repo allowlists this script. Also prunes browser test-results.
#
# Usage: scripts/clean-piers.sh
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

freed_before="$(du -sh "$ROOT/.piers/run" 2>/dev/null | cut -f1 || echo 0)"
rm -rf "$ROOT/.piers/run"/* 2>/dev/null || true
rm -rf "$ROOT/client/e2e-browser/test-results" 2>/dev/null || true
echo "cleaned run-piers under $ROOT/.piers/run (was ~${freed_before}); golden piers untouched"
