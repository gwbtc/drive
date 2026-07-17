#!/usr/bin/env bash
# Boot ~nec and ~bus, install the desk into both, verify ames, log in, and
# LEAVE THEM RUNNING. Writes connection env to .piers/demo.env for the demo
# driver to source. Tear down later with scripts/demo-kill.sh.
set -euo pipefail
source "$(dirname "$0")/lib.sh"

SHIP_A=nec; SHIP_B=bus
PORT_A="${PORT_A:-18098}"; PORT_B="${PORT_B:-18099}"
LABEL_A="demo-$SHIP_A"; LABEL_B="demo-$SHIP_B"
RUN_A="$PIERS_DIR/run/$SHIP_A-demo"; RUN_B="$PIERS_DIR/run/$SHIP_B-demo"
BASE_A="http://localhost:$PORT_A"; BASE_B="http://localhost:$PORT_B"

for s in "$SHIP_A" "$SHIP_B"; do
  [ -d "$PIERS_DIR/golden/$s" ] || "$ROOT/scripts/refresh-golden-piers.sh" "$s"
done

rm -rf "$RUN_A" "$RUN_B"
echo "=== cloning piers ==="
clone_pier "$PIERS_DIR/golden/$SHIP_A" "$RUN_A"
clone_pier "$PIERS_DIR/golden/$SHIP_B" "$RUN_B"

echo "=== booting ==="
boot_pier "$SHIP_A" "$LABEL_A" "$PORT_A" "$RUN_A"
boot_pier "$SHIP_B" "$LABEL_B" "$PORT_B" "$RUN_B"
wait_for_http "$BASE_A"; wait_for_http "$BASE_B"

echo "=== committing desk into both ==="
commit_desk "$LABEL_A" "$RUN_A"
commit_desk "$LABEL_B" "$RUN_B"

echo "=== verifying ames (|hi) ==="
dojo "$LABEL_B" "|hi ~$SHIP_A" 5
capture_pane "$LABEL_B" 60 | grep -q "hi ~$SHIP_A successful" || { echo "FATAL: no ames" >&2; exit 1; }

echo "=== logging in ==="
CODE_A="$(get_code "$LABEL_A")"; CODE_B="$(get_code "$LABEL_B")"
COOKIE_A="$(login "$BASE_A" "$CODE_A")"; COOKIE_B="$(login "$BASE_B" "$CODE_B")"

cat > "$PIERS_DIR/demo.env" <<ENV
export SHIP_A_URL="$BASE_A"
export SHIP_B_URL="$BASE_B"
export SHIP_A_NAME="$SHIP_A"
export SHIP_B_NAME="$SHIP_B"
export COOKIE_A="$COOKIE_A"
export COOKIE_B="$COOKIE_B"
ENV
echo "=== READY — both ships up. env → $PIERS_DIR/demo.env ==="
echo "  ~$SHIP_A $BASE_A   ~$SHIP_B $BASE_B"
