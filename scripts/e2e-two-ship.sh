#!/usr/bin/env bash
# Two-ship cross-ship e2e: boot cloned golden ~nec (owner) and ~bus
# (collaborator), commit the current desk into both, verify fake-ames
# connectivity with |hi, then run e2e/two-ship.test.ts against both HTTP
# APIs. Fakeships discover each other on loopback as long as no ames port
# is forced.
#
# Usage: scripts/e2e-two-ship.sh [extra bun-test args...]
# Env:   PORT_A (default 18096), PORT_B (default 18097), KEEP_PIER=1

set -euo pipefail
source "$(dirname "$0")/lib.sh"

SHIP_A=nec   # owner
SHIP_B=bus   # collaborator
PORT_A="${PORT_A:-18096}"
PORT_B="${PORT_B:-18097}"
LABEL_A="e2e2-$SHIP_A"
LABEL_B="e2e2-$SHIP_B"
RUN_A="$PIERS_DIR/run/$SHIP_A-two-$$"
RUN_B="$PIERS_DIR/run/$SHIP_B-two-$$"
BASE_A="http://localhost:$PORT_A"
BASE_B="http://localhost:$PORT_B"

for ship in "$SHIP_A" "$SHIP_B"; do
  if [ ! -d "$PIERS_DIR/golden/$ship" ]; then
    "$ROOT/scripts/refresh-golden-piers.sh" "$ship"
  fi
done

cleanup() {
  kill_pier "$LABEL_A"
  kill_pier "$LABEL_B"
  if [ "${KEEP_PIER:-0}" != "1" ]; then
    rm -rf "$RUN_A" "$RUN_B"
  else
    echo "Kept piers at $RUN_A and $RUN_B"
  fi
}
trap cleanup EXIT

echo "=== cloning golden piers ==="
clone_pier "$PIERS_DIR/golden/$SHIP_A" "$RUN_A"
clone_pier "$PIERS_DIR/golden/$SHIP_B" "$RUN_B"

echo "=== booting both ships ==="
boot_pier "$SHIP_A" "$LABEL_A" "$PORT_A" "$RUN_A"
boot_pier "$SHIP_B" "$LABEL_B" "$PORT_B" "$RUN_B"
wait_for_http "$BASE_A"
wait_for_http "$BASE_B"

echo "=== committing current desk into both ==="
commit_desk "$LABEL_A" "$RUN_A"
commit_desk "$LABEL_B" "$RUN_B"

echo "=== verifying fake-ames connectivity (|hi) ==="
dojo "$LABEL_B" "|hi ~$SHIP_A" 5
if ! capture_pane "$LABEL_B" 60 | grep -q "hi ~$SHIP_A successful"; then
  echo "FATAL: ~$SHIP_B cannot reach ~$SHIP_A over fake ames." >&2
  echo "Check that no other fake ~$SHIP_A / ~$SHIP_B is running on this machine." >&2
  capture_pane "$LABEL_B" 40 >&2
  exit 1
fi

echo "=== logging in to both ==="
CODE_A="$(get_code "$LABEL_A")"
CODE_B="$(get_code "$LABEL_B")"
COOKIE_A="$(login "$BASE_A" "$CODE_A")"
COOKIE_B="$(login "$BASE_B" "$CODE_B")"

echo "=== running two-ship specs ==="
cd "$ROOT/client"
SHIP_A_URL="$BASE_A" SHIP_B_URL="$BASE_B" \
SHIP_A_NAME="$SHIP_A" SHIP_B_NAME="$SHIP_B" \
COOKIE_A="$COOKIE_A" COOKIE_B="$COOKIE_B" \
  "${BUN:-$HOME/.bun/bin/bun}" test e2e/two-ship.test.ts --timeout 120000 "$@"
