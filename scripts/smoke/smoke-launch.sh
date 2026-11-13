#!/usr/bin/env bash
# Headless launch smoke: runs <binary> with SHIR_SMOKE=1 and requires exit 0 plus a
# line exactly "SHIR_READY" before SMOKE_TIMEOUT seconds (default 120).
# Callers wrap this script in xvfb-run when a display is needed.
set -euo pipefail

if [ "$#" -lt 1 ] || [ ! -f "$1" ] || [ ! -x "$1" ]; then
  echo "usage: smoke-launch.sh <binary>  (env SMOKE_TIMEOUT=seconds, default 120)" >&2
  exit 2
fi

binary="$1"
limit="${SMOKE_TIMEOUT:-120}"
log="$(mktemp)"
trap 'rm -f "$log"' EXIT

start=$SECONDS
rc=0
SHIR_SMOKE=1 timeout -k 5 "$limit" "$binary" >"$log" 2>&1 || rc=$?
elapsed=$((SECONDS - start))

reason=""
if [ "$rc" -eq 124 ] || { [ "$rc" -eq 137 ] && [ "$elapsed" -ge "$limit" ]; }; then
  reason="timeout"
elif [ "$rc" -ne 0 ]; then
  reason="exit $rc"
elif ! tr -d '\r' <"$log" | grep -x 'SHIR_READY' >/dev/null; then
  reason="no SHIR_READY marker"
fi

if [ -n "$reason" ]; then
  echo "smoke: FAIL - $reason"
  tail -n 50 "$log"
  exit 1
fi

echo "smoke: PASS (${elapsed}s)"
