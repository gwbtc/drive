#!/usr/bin/env bash
# Tear down the demo ships booted by demo-boot.sh.
source "$(dirname "$0")/lib.sh"
kill_pier "demo-nec" || true
kill_pier "demo-bus" || true
rm -rf "$PIERS_DIR/run/nec-demo" "$PIERS_DIR/run/bus-demo" "$PIERS_DIR/demo.env" 2>/dev/null || true
echo "demo ships down."
