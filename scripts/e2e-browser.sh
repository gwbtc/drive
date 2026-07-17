#!/usr/bin/env bash
# Browser-level e2e: clone the golden ~nec pier, boot it, commit the current
# desk/, then drive the real SPA in headless Chromium with Playwright
# (client/e2e-browser/). Complements the API-level harness (e2e-single.sh)
# with the things only a real browser can prove: Tiptap editing, SSE live
# collab across tabs, y-indexeddb offline durability, the save-state pip.
#
# Usage: scripts/e2e-browser.sh [extra playwright args...]
# Env:   HTTP_PORT (default 18110), KEEP_PIER=1 to keep the run pier around.

set -euo pipefail
source "$(dirname "$0")/lib.sh"

# ~nec, not ~zod: a fake ~zod binds UDP 31337, which collides with any other
# fake ~zod already running on this machine (e.g. an unrelated dev ship).
SHIP=nec
LABEL="e2e-browser"
HTTP_PORT="${HTTP_PORT:-18110}"
GOLDEN="$PIERS_DIR/golden/$SHIP"
RUN_PIER="$PIERS_DIR/run/$SHIP-browser-$$"
BASE="http://localhost:$HTTP_PORT"

# Playwright's CLI runs on node, not bun; make sure homebrew node wins.
export PATH="/opt/homebrew/bin:$PATH"

PLAYWRIGHT_BIN="$ROOT/client/node_modules/.bin/playwright"
if [ ! -x "$PLAYWRIGHT_BIN" ]; then
  echo "@playwright/test not installed — run: cd client && bun add -d @playwright/test" >&2
  exit 1
fi

if [ ! -d "$GOLDEN" ]; then
  echo "No golden pier at $GOLDEN — building it first."
  "$ROOT/scripts/refresh-golden-piers.sh" "$SHIP"
fi

cleanup() {
  kill_pier "$LABEL"
  if [ "${KEEP_PIER:-0}" != "1" ]; then
    rm -rf "$RUN_PIER"
  else
    echo "Kept run pier at $RUN_PIER"
  fi
}
trap cleanup EXIT

echo "=== cloning golden pier ==="
clone_pier "$GOLDEN" "$RUN_PIER"

echo "=== booting ==="
boot_pier "$SHIP" "$LABEL" "$HTTP_PORT" "$RUN_PIER"
wait_for_http "$BASE"

echo "=== committing current desk ==="
commit_desk "$LABEL" "$RUN_PIER"

echo "=== logging in ==="
CODE="$(get_code "$LABEL")"
if [ -z "$CODE" ]; then
  echo "could not read +code from dojo" >&2
  exit 1
fi
COOKIE="$(login "$BASE" "$CODE")"

echo "=== running browser e2e specs ==="
cd "$ROOT/client/e2e-browser"
SHIP_URL="$BASE" SHIP_NAME="$SHIP" COOKIE="$COOKIE" SHIP_CODE="$CODE" \
  "$PLAYWRIGHT_BIN" test "$@"
