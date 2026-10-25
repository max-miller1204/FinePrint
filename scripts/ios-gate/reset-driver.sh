#!/bin/bash
# Stops the agent-device daemon that drives the simulator for e2e. The daemon
# is shared by every worktree and can wedge (every request then fails with
# "Daemon request timed out"), so heavy.sh and gate.ts run this after an
# infrastructure failure. The next e2e run starts a fresh daemon.
#
#   scripts/ios-gate/reset-driver.sh [--shutdown]
#
# --shutdown also shuts down every simulator and quits Simulator.app.
set -u

daemon_pid="$(python3 -c 'import json,os;print(json.load(open(os.path.expanduser("~/.agent-device/daemon.json"))).get("pid",""))' 2>/dev/null || true)"
if [ -n "$daemon_pid" ] && kill -0 "$daemon_pid" 2>/dev/null; then
  pkill -TERM -P "$daemon_pid" 2>/dev/null || true
  kill -TERM "$daemon_pid" 2>/dev/null || true
  for _ in 1 2 3 4 5; do kill -0 "$daemon_pid" 2>/dev/null || break; sleep 1; done
  kill -0 "$daemon_pid" 2>/dev/null && kill -KILL "$daemon_pid" 2>/dev/null
  echo "[reset-driver] stopped agent-device daemon $daemon_pid"
fi

if [ "${1:-}" = --shutdown ]; then
  xcrun simctl shutdown all >/dev/null 2>&1 || true
  osascript -e 'quit app "Simulator"' >/dev/null 2>&1 || true
fi
