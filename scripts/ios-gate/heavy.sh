#!/bin/bash
# Runs one heavy job (xcodebuild, the simulator, the Firebase emulators) at a
# time across every worktree of this repo. An 8 GB Mac fits one simulator, and
# the iOS emulator ports are fixed, so parallel workers queue here.
#
#   scripts/ios-gate/heavy.sh <label> <command> [args...]
#
# - The lock and the queue live in the git common dir, so all worktrees share
#   them. Jobs run first come, first served. HEAVY_PRIORITY (0 to 9, default 5)
#   lets an urgent job go first; it never interrupts a running job.
# - Warm handoff: when another job is queued, the simulator stays booted for
#   it. When the queue is empty, the simulator is shut down, Simulator.app
#   quits, and the agent-device daemon stops.
# - A job that exits 3 (an infrastructure failure, see gate.ts) always resets
#   the driver: the daemon is shared by every worktree and wedges after a
#   simulator shutdown.
# - A lock left by a dead process is taken over, and emulators a crashed run
#   left on the iOS ports are stopped on release.
#
# The exit code is the command's. Every acquire and release is appended to
# heavy.log next to the lock, so `tail` it to see who has the simulator.
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
COMMON="$(cd "$(git -C "$HERE" rev-parse --git-common-dir)" && pwd)"
DIR="$COMMON/fineprint-heavy"
LOCK="$DIR/lock"
WAITERS="$DIR/waiters"
LOG="$DIR/heavy.log"
LABEL="${1:?usage: heavy.sh <label> <command> [args...]}"; shift
PRIORITY="${HEAVY_PRIORITY:-5}"
# Everything runs inside main, so bash has read the whole file before the job
# starts: editing this script while a job runs cannot change what that job does.
main() {
  mkdir -p "$WAITERS"

  say() { echo "[heavy] $LABEL: $*"; echo "$(date '+%F %T') $LABEL: $*" >> "$LOG"; }

  # A waiter file holds "<priority> <epoch seconds> <pid>"; the lowest goes first.
  ME="$PRIORITY $(date +%s) $$"
  echo "$ME" > "$WAITERS/$$"

  live_waiters() {
    for f in "$WAITERS"/*; do
      [ -e "$f" ] || continue
      pid="$(basename "$f")"
      if kill -0 "$pid" 2>/dev/null; then cat "$f"; else rm -f "$f"; fi
    done
  }

  my_turn() {
    best="$(live_waiters | sort -k1,1n -k2,2n -k3,3n | head -1)"
    [ "$best" = "$ME" ]
  }

  holder() { echo "$(cat "$LOCK/label" 2>/dev/null) since $(cat "$LOCK/since" 2>/dev/null)"; }

  waited=0
  while true; do
    if my_turn && mkdir "$LOCK" 2>/dev/null; then break; fi
    holder_pid="$(cat "$LOCK/pid" 2>/dev/null || true)"
    if [ -n "$holder_pid" ] && ! kill -0 "$holder_pid" 2>/dev/null; then
      say "taking a stale lock from pid $holder_pid ($(holder))"
      rm -rf "$LOCK"
      continue
    fi
    # Print once a minute, not every poll.
    if [ $((waited % 60)) -eq 0 ]; then
      if [ -d "$LOCK" ]; then echo "[heavy] $LABEL: waiting; held by $(holder)"; else echo "[heavy] $LABEL: waiting behind an earlier job"; fi
    fi
    sleep 5; waited=$((waited + 5))
  done
  rm -f "$WAITERS/$$"
  echo $$ > "$LOCK/pid"; echo "$LABEL" > "$LOCK/label"; date '+%T' > "$LOCK/since"

  anyone_waiting() { [ -n "$(live_waiters)" ]; }

  cleanup() {
    rc=$?
    if [ "$rc" != 3 ] && anyone_waiting; then
      say "exit $rc; another job is queued, keeping the simulator booted"
    else
      "$HERE/reset-driver.sh" --shutdown
      say "exit $rc; driver stopped and simulators shut down"
    fi
    # The runner stops the emulators it started, but a crashed firebase-tools leaves its JVMs
    # behind on the fixed iOS ports (firebase.ios.json), and the next run then cannot start.
    # Only these three: the hub and logging ports are shared with the web emulators.
    for port in 9199 8190 9290; do
      for pid in $(lsof -nP -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null); do
        if ps -o command= -p "$pid" | grep -qE 'firebase|cloud-firestore-emulator|cloud-storage'; then
          kill "$pid" 2>/dev/null && say "stopped a leftover emulator on :$port (pid $pid)"
        fi
      done
    done
    rm -rf "$LOCK"
    say "released the lock after holding it $((SECONDS - HELD_FROM))s"
  }
  trap cleanup EXIT
  trap 'exit 130' INT TERM

  HELD_FROM=$SECONDS
  say "acquired the lock after ${waited}s in the queue"
  "$@"
}

main "$@"; exit
