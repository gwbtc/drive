#!/usr/bin/env bash
# Build (or rebuild) the cached "golden" fakeship piers used by the e2e
# harness. A golden pier is a fully-booted fakeship with %documents
# installed, shut down cleanly. Test runs clone it (APFS copy-on-write)
# instead of paying the ~2-minute fresh-boot cost.
#
# Usage: scripts/refresh-golden-piers.sh [ship ...]   (default: nec bus)
# Rebuild when sys.kelvin or the vere binary changes; desk code changes do
# NOT require a rebuild (runs re-commit the current desk into the clone).
#
# We deliberately avoid ~zod: each fake ship binds a name-derived UDP port
# and a fake ~zod (31337) collides with any other fake ~zod on the machine.

set -euo pipefail
source "$(dirname "$0")/lib.sh"

if [ $# -gt 0 ]; then SHIPS=("$@"); else SHIPS=(nec bus); fi

PORT=18200
for ship in "${SHIPS[@]}"; do
  label="golden-$ship"
  pier="$PIERS_DIR/golden/$ship"
  echo "=== building golden pier for ~$ship at $pier ==="
  rm -rf "$pier"
  boot_pier "$ship" "$label" "$PORT" "$pier"
  install_desk "$label" "$pier"
  wait_for_http "http://localhost:$PORT"
  graceful_shutdown "$label"
  echo "=== golden ~$ship done ==="
  PORT=$((PORT + 1))
done
