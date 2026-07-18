#!/usr/bin/env bash
# End-to-end proof: create a repo + commit a file via %code, then `git clone`
# it from the ship with a STOCK git client. Clones authenticated (git passes
# the ship's session cookie via http.extraHeader).
set -euo pipefail
source "$(dirname "$0")/lib.sh"

SHIP=nec; LABEL="git-clone"; PORT="${HTTP_PORT:-18470}"
PIER="$PIERS_DIR/run/$SHIP-gitclone-$$"
BASE="http://localhost:$PORT"
CLONE_DIR="$(mktemp -d)/demo"

cleanup() { kill_pier "$LABEL" 2>/dev/null; rm -rf "$PIER" "$(dirname "$CLONE_DIR")"; }
trap cleanup EXIT

[ -d "$PIERS_DIR/golden/$SHIP" ] || "$(dirname "$0")/refresh-golden-piers.sh" "$SHIP"
echo "=== cloning golden pier + booting ==="
clone_pier "$PIERS_DIR/golden/$SHIP" "$PIER"
boot_pier "$SHIP" "$LABEL" "$PORT" "$PIER"
wait_for_http "$BASE"
commit_desk "$LABEL" "$PIER"

echo "=== logging in ==="
COOKIE=""
for _ in 1 2 3 4 5; do
  CODE="$(get_code "$LABEL")"
  C="$(login "$BASE" "$CODE" 2>/dev/null || true)"
  if [ "$(curl -s -H "cookie: $C" -o /dev/null -w '%{http_code}' "$BASE/~/scry/drive/health.json")" = "200" ]; then
    COOKIE="$C"; break
  fi
  sleep 2
done
[ -n "$COOKIE" ] || { echo "FATAL: login failed" >&2; exit 1; }

action() { curl -sS -H "cookie: $COOKIE" -H 'content-type: application/json' -d "$1" "$BASE/code/action"; echo; }

echo "=== create repo + commit a file (via %code actions) ==="
action '{"create-repo":{"name":"demo","description":"clone me","public":true}}'
action '{"commit-files":{"name":"demo","branch":"main","message":"initial commit","files":[{"path":"README.md","body":"# Demo repo\n\nHosted on an Urbit ship, cloned with stock git.\n"},{"path":"hello.txt","body":"hello from ~nec\n"}]}}'

echo "=== repo state (scry) ==="
curl -s -H "cookie: $COOKIE" "$BASE/~/scry/code/repos.json"; echo

echo "=== git clone http://…/code/demo (stock git, authed) ==="
git -c http.extraHeader="Cookie: $COOKIE" \
    -c http.sslVerify=false \
    clone "$BASE/code/demo" "$CLONE_DIR" 2>&1

echo "=== cloned working tree ==="
ls -la "$CLONE_DIR"
echo "--- README.md ---"; cat "$CLONE_DIR/README.md"
echo "--- git log ---"; git -C "$CLONE_DIR" log --oneline --stat | head -20
echo "--- object format ---"; git -C "$CLONE_DIR" rev-parse --show-object-format

if [ -f "$CLONE_DIR/README.md" ] && grep -q "Hosted on an Urbit ship" "$CLONE_DIR/README.md"; then
  echo "=== ✅ CLONE SUCCEEDED — real git cloned a repo from the ship ==="
else
  echo "=== ❌ clone incomplete ==="; exit 1
fi
