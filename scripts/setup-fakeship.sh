#!/usr/bin/env bash
# Bootstrap a fakeship and prepare it for installing the %documents desk.
#
# Usage:
#   scripts/setup-fakeship.sh [ship_name] [http_port] [ames_port]
#
# Defaults: zod 8090 32100
#
# This script ONLY prepares the pier. To actually install the desk you
# need to be in the fakeship's dojo to run:
#   |new-desk %documents
#   |mount %documents
# then back in this shell:
#   cp -R desk/* <ship>/documents/
# then in dojo:
#   |commit %documents
#   |install our %documents

set -euo pipefail

VERE=/Users/trent/vere-v4.2-macos-aarch64
SHIP="${1:-zod}"
HTTP_PORT="${2:-8090}"
AMES_PORT="${3:-32100}"

cd "$(dirname "$0")/.."

if [ -d "$SHIP" ]; then
  echo "Pier ./$SHIP already exists. Resuming."
fi

echo ""
echo "Booting fakeship ~$SHIP"
echo "  HTTP:  http://localhost:$HTTP_PORT"
echo "  Ames:  $AMES_PORT (local-only)"
echo ""
echo "When the dojo prompt appears (~$SHIP:dojo>), run:"
echo ""
echo "  |new-desk %documents"
echo "  |mount %documents"
echo ""
echo "Then in a separate terminal:"
echo "  cp -R $(pwd)/desk/* $(pwd)/$SHIP/documents/"
echo ""
echo "Back in dojo:"
echo "  |commit %documents"
echo "  |install our %documents"
echo ""
echo "Then visit http://localhost:$HTTP_PORT/drive"
echo ""
echo "Press Ctrl-D to exit dojo, ${VERE} -F $SHIP to resume later."
echo ""

exec "$VERE" -F "$SHIP" -p "$AMES_PORT" --http-port "$HTTP_PORT"
