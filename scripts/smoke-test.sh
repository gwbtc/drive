#!/usr/bin/env bash
# Smoke test the %documents desk on a fresh fakeship via tmux.
#
# Boots a fakeship in a tmux session, runs the install commands, and
# checks for compile / install errors in the dojo output.
#
# Usage: scripts/smoke-test.sh [ship_name]

set -euo pipefail

SHIP="${1:-bus}"
SESSION="docs-smoke-$SHIP"
HTTP_PORT="${HTTP_PORT:-8090}"
VERE="${VERE:-$(command -v vere || echo /Users/trent/vere-v4.2-macos-aarch64)}"
if [ ! -x "$VERE" ]; then
  echo "VERE binary not found at $VERE — set VERE=/path/to/vere"
  exit 1
fi
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Clean any previous run
tmux kill-session -t "$SESSION" 2>/dev/null || true
rm -rf "$ROOT/$SHIP"

# Create new tmux session running vere
tmux new-session -d -s "$SESSION" -x 200 -y 50 \
  "cd $ROOT && $VERE -F $SHIP --http-port $HTTP_PORT 2>&1"

echo "Started fakeship ~$SHIP in tmux session $SESSION on port $HTTP_PORT"

# Wait for the dojo prompt
echo -n "Waiting for dojo prompt"
for i in $(seq 1 90); do
  if tmux capture-pane -p -t "$SESSION" -S -200 2>/dev/null \
       | grep -q "~$SHIP:dojo>"; then
    echo " ready."
    break
  fi
  sleep 2
  echo -n "."
done

if ! tmux capture-pane -p -t "$SESSION" -S -200 2>/dev/null \
       | grep -q "~$SHIP:dojo>"; then
  echo " TIMED OUT."
  tmux capture-pane -p -t "$SESSION" -S -100
  tmux kill-session -t "$SESSION" 2>/dev/null || true
  exit 1
fi

# Helper: send a line and wait for prompt.
send_dojo() {
  local cmd="$1"
  echo "  > $cmd"
  tmux send-keys -t "$SESSION" "$cmd" Enter
  sleep 3
}

send_dojo "|new-desk %documents"
send_dojo "|mount %documents"

# Copy desk files into the mounted pier
echo "Copying desk files into $ROOT/$SHIP/documents/"
cp -R "$ROOT/desk"/* "$ROOT/$SHIP/documents/"

send_dojo "|commit %documents"
sleep 4
send_dojo "|install our %documents"
sleep 5

# Capture final pane
OUTPUT=$(tmux capture-pane -p -t "$SESSION" -S -300)
echo ""
echo "===== final dojo output ====="
echo "$OUTPUT" | tail -60
echo "============================="

# Look for error markers
if echo "$OUTPUT" | grep -qE "(crud:|/sys/vane|nest-fail|find-fork|mismatch|leaf:|cell-text|^!!|hoon-syntax)"; then
  echo ""
  echo "FAIL — errors detected in dojo output."
  echo "Inspect with: tmux attach -t $SESSION"
  exit 2
fi

# Probe HTTP — should redirect or serve
if curl -sI -m 5 "http://localhost:$HTTP_PORT/drive" \
     | grep -qE "^HTTP/1.1 (200|307|302)"; then
  echo ""
  echo "PASS — desk installed, HTTP responsive."
  echo "Visit http://localhost:$HTTP_PORT/drive (after logging in)"
  echo "Login code: get with 'tmux send-keys -t $SESSION \"+code\" Enter' in the dojo"
  echo "Stop ship: tmux kill-session -t $SESSION"
else
  echo ""
  echo "WARN — install seems OK but HTTP didn't respond."
  exit 3
fi
