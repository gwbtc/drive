#!/usr/bin/env bash
# Single-ship API-level e2e: clone the golden ~zod pier, boot it, commit the
# current desk/ (running any state migrations), then drive the HTTP API with
# bun tests (client/e2e/single.test.ts).
#
# Usage: scripts/e2e-single.sh [extra bun-test args...]
# Env:   HTTP_PORT (default 18091), KEEP_PIER=1 to keep the run pier around.

set -euo pipefail
source "$(dirname "$0")/lib.sh"

# ~nec, not ~zod: a fake ~zod binds UDP 31337, which collides with any other
# fake ~zod already running on this machine (e.g. an unrelated dev ship).
SHIP=nec
LABEL="e2e-single"
HTTP_PORT="${HTTP_PORT:-18091}"
GOLDEN="$PIERS_DIR/golden/$SHIP"
RUN_PIER="$PIERS_DIR/run/$SHIP-$$"
BASE="http://localhost:$HTTP_PORT"

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

echo "=== running e2e specs ==="
cd "$ROOT/client"
SHIP_URL="$BASE" SHIP_NAME="$SHIP" COOKIE="$COOKIE" \
  "${BUN:-$HOME/.bun/bin/bun}" test e2e/single.test.ts --timeout 60000 "$@"
