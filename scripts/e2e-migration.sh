#!/usr/bin/env bash
# Migration e2e: clone the frozen state-7 fixture pier, commit the CURRENT
# desk into it (running the on-load state upgrade), and assert every piece
# of seeded data survived. See scripts/make-state7-fixture.sh for how the
# fixture is produced.
#
# Usage: scripts/e2e-migration.sh
# Env:   HTTP_PORT (default 18093), EXPECTED_STATE_VERSION (default 8)

set -euo pipefail
source "$(dirname "$0")/lib.sh"

SHIP=nec
LABEL="e2e-migration"
HTTP_PORT="${HTTP_PORT:-18093}"
FIXTURE="$PIERS_DIR/golden/$SHIP-state7"
RUN_PIER="$PIERS_DIR/run/$SHIP-mig-$$"
BASE="http://localhost:$HTTP_PORT"

if [ ! -d "$FIXTURE" ]; then
  echo "No fixture pier at $FIXTURE." >&2
  echo "Build it from the last pre-migration commit: scripts/make-state7-fixture.sh" >&2
  exit 1
fi

cleanup() {
  kill_pier "$LABEL"
  rm -rf "$RUN_PIER"
}
trap cleanup EXIT

clone_pier "$FIXTURE" "$RUN_PIER"
boot_pier "$SHIP" "$LABEL" "$HTTP_PORT" "$RUN_PIER"
wait_for_http "$BASE"

echo "=== committing current desk (runs the state migration) ==="
commit_desk "$LABEL" "$RUN_PIER"

CODE="$(get_code "$LABEL")"
COOKIE="$(login "$BASE" "$CODE")"

cd "$ROOT/client"
SHIP_URL="$BASE" SHIP_NAME="$SHIP" COOKIE="$COOKIE" \
EXPECTED_STATE_VERSION="${EXPECTED_STATE_VERSION:-12}" \
  "${BUN:-$HOME/.bun/bin/bun}" test e2e/migration.test.ts --timeout 60000
