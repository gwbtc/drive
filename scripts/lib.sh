#!/usr/bin/env bash
# Shared library for fakeship test harnesses. Source this; don't execute it.
#
# Conventions:
#   - Every booted ship lives in its own tmux session named "drive-<label>".
#   - Piers live under $PIERS_DIR (default $ROOT/.piers), never in $ROOT.
#   - Fakeships are booted WITHOUT -p/--ames-port: fakeships derive their fake
#     ames port from the ship name and discover each other on loopback only
#     when the default is left alone. Overriding it silently breaks
#     inter-ship pokes/subscriptions.

LIB_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="${ROOT:-$LIB_ROOT}"
PIERS_DIR="${PIERS_DIR:-$ROOT/.piers}"
VERE="${VERE:-$(command -v vere || echo /Users/trent/vere-v4.2-macos-aarch64)}"
DESK_NAME="documents"

require_vere() {
  if [ ! -x "$VERE" ]; then
    echo "VERE binary not found at $VERE — set VERE=/path/to/vere" >&2
    return 1
  fi
}

session_for() { echo "drive-$1"; }

# capture_pane <label> [lines]
capture_pane() {
  tmux capture-pane -p -t "$(session_for "$1")" -S "-${2:-300}" 2>/dev/null
}

# wait_for_dojo <ship> <label> [tries]
# Polls the tmux pane for the dojo prompt. 2s per try.
wait_for_dojo() {
  local ship="$1" label="$2" tries="${3:-90}"
  echo -n "[$label] waiting for ~$ship dojo"
  for _ in $(seq 1 "$tries"); do
    if capture_pane "$label" 200 | grep -q "~$ship:dojo>"; then
      echo " ready."
      return 0
    fi
    sleep 2
    echo -n "."
  done
  echo " TIMED OUT." >&2
  capture_pane "$label" 100 >&2
  return 1
}

# boot_pier <ship> <label> <http_port> <pier_dir>
# Boots (creating if absent, resuming if present) a fakeship in tmux.
boot_pier() {
  local ship="$1" label="$2" port="$3" pier="$4"
  require_vere || return 1
  local session; session="$(session_for "$label")"
  tmux kill-session -t "$session" 2>/dev/null || true
  mkdir -p "$(dirname "$pier")"
  if [ -d "$pier" ]; then
    tmux new-session -d -s "$session" -x 220 -y 50 \
      "$VERE $pier --http-port $port 2>&1"
  else
    tmux new-session -d -s "$session" -x 220 -y 50 \
      "$VERE -F $ship -c $pier --http-port $port 2>&1"
  fi
  wait_for_dojo "$ship" "$label"
}

# dojo <label> <command> [settle_seconds]
dojo() {
  local label="$1" cmd="$2" settle="${3:-3}"
  echo "  [$label] > $cmd"
  tmux send-keys -t "$(session_for "$label")" "$cmd" Enter
  sleep "$settle"
}

# assert_no_compile_errors <label>
# Greps recent dojo output for Hoon compile/install failure markers.
assert_no_compile_errors() {
  local label="$1"
  local out; out="$(capture_pane "$label" 400)"
  if echo "$out" | grep -qE "(crud:|/sys/vane|nest-fail|find-fork|mismatch|leaf:|cell-text|^!!|hoon-syntax|mint-vain|mint-nice|fish-loop)"; then
    echo "[$label] FAIL — compile/install errors in dojo output:" >&2
    echo "$out" | tail -60 >&2
    return 1
  fi
}

# install_desk <label> <pier_dir>
# First-time install: |new-desk, |mount, copy files, |commit, |install.
install_desk() {
  local label="$1" pier="$2"
  dojo "$label" "|new-desk %$DESK_NAME" 4
  dojo "$label" "|mount %$DESK_NAME" 4
  cp -R "$ROOT/desk"/* "$pier/$DESK_NAME/"
  dojo "$label" "|commit %$DESK_NAME" 6
  dojo "$label" "|install our %$DESK_NAME" 8
  assert_no_compile_errors "$label"
}

# commit_desk <label> <pier_dir>
# Re-commit the current working desk into an already-installed pier
# (picks up code changes; runs state migrations via the running agent).
commit_desk() {
  local label="$1" pier="$2"
  if [ ! -d "$pier/$DESK_NAME" ]; then
    echo "[$label] pier has no mounted $DESK_NAME desk" >&2
    return 1
  fi
  # rsync --delete so file deletions in desk/ propagate; plain cp would
  # leave stale .hoon files behind and shadow renames.
  rsync -a --delete "$ROOT/desk/" "$pier/$DESK_NAME/"
  dojo "$label" "|commit %$DESK_NAME" 8
  assert_no_compile_errors "$label"
}

# get_code <label>
# Extracts the web login code from the dojo (+code). Echoes it.
get_code() {
  local label="$1"
  tmux send-keys -t "$(session_for "$label")" "+code" Enter
  sleep 3
  capture_pane "$label" 50 | grep -oE '[a-z]{6}-[a-z]{6}-[a-z]{6}-[a-z]{6}' | tail -1
}

# login <base_url> <code>
# Logs into the ship's web interface; echoes the auth Cookie header value.
login() {
  local base="$1" code="$2"
  local jar; jar="$(mktemp)"
  curl -sS -c "$jar" -o /dev/null -d "password=$code" "$base/~/login"
  # Cookie jar line: <domain> ... <name> <value>
  local cookie
  cookie="$(awk '$6 ~ /^urbauth/ { printf "%s=%s", $6, $7 }' "$jar")"
  rm -f "$jar"
  if [ -z "$cookie" ]; then
    echo "login to $base failed (no urbauth cookie)" >&2
    return 1
  fi
  echo "$cookie"
}

# wait_for_http <base_url> [tries]
wait_for_http() {
  local base="$1" tries="${2:-30}"
  for _ in $(seq 1 "$tries"); do
    if curl -s -m 2 -o /dev/null "$base/drive/api/health"; then
      return 0
    fi
    sleep 1
  done
  echo "HTTP never came up at $base" >&2
  return 1
}

# graceful_shutdown <label>
# Ctrl-D in the dojo checkpoints and exits vere cleanly.
graceful_shutdown() {
  local label="$1"
  local session; session="$(session_for "$label")"
  tmux send-keys -t "$session" C-d
  for _ in $(seq 1 30); do
    tmux has-session -t "$session" 2>/dev/null || return 0
    sleep 1
  done
  echo "[$label] did not exit cleanly; killing" >&2
  tmux kill-session -t "$session" 2>/dev/null || true
}

kill_pier() {
  tmux kill-session -t "$(session_for "$1")" 2>/dev/null || true
}

# clone_pier <src> <dst> — APFS copy-on-write clone (near-instant).
clone_pier() {
  local src="$1" dst="$2"
  mkdir -p "$(dirname "$dst")"
  cp -Rc "$src" "$dst" 2>/dev/null || cp -R "$src" "$dst"
}
