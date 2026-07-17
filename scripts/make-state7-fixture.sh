#!/usr/bin/env bash
# Freeze a fixture pier holding pre-migration agent state, used by the
# migration e2e to prove that on-load upgrades preserve data forever.
#
# MUST be run while desk/ still ships the OLD state version (i.e. from the
# last commit before a migration lands). The result is stored at
# .piers/golden/nec-state<N> and never rebuilt casually — if you lose it,
# check out the last pre-migration commit and re-run this script.
#
# Usage: scripts/make-state7-fixture.sh

set -euo pipefail
source "$(dirname "$0")/lib.sh"

SHIP=nec
LABEL="fixture-$SHIP"
HTTP_PORT="${HTTP_PORT:-18095}"
GOLDEN="$PIERS_DIR/golden/$SHIP"
FIXTURE="$PIERS_DIR/golden/$SHIP-state7"
BASE="http://localhost:$HTTP_PORT"

if [ -d "$FIXTURE" ]; then
  echo "Fixture already exists at $FIXTURE — refusing to overwrite." >&2
  echo "(rm -rf it first if you really mean to rebuild from a state-7 desk.)" >&2
  exit 1
fi
if [ ! -d "$GOLDEN" ]; then
  "$ROOT/scripts/refresh-golden-piers.sh" "$SHIP"
fi

cleanup() { kill_pier "$LABEL"; }
trap cleanup EXIT

clone_pier "$GOLDEN" "$FIXTURE"
boot_pier "$SHIP" "$LABEL" "$HTTP_PORT" "$FIXTURE"
wait_for_http "$BASE"
commit_desk "$LABEL" "$FIXTURE"

CODE="$(get_code "$LABEL")"
COOKIE="$(login "$BASE" "$CODE")"

echo "=== seeding fixture data ==="
cd "$ROOT/client"
SHIP_URL="$BASE" SHIP_NAME="$SHIP" COOKIE="$COOKIE" SEED=1 \
  "${BUN:-$HOME/.bun/bin/bun}" test e2e/fixture-seed.test.ts --timeout 60000

echo "=== shutting down cleanly ==="
graceful_shutdown "$LABEL"
echo "Fixture pier frozen at $FIXTURE"
