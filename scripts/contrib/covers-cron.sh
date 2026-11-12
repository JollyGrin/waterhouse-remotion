#!/bin/bash
# EXAMPLE launchd wrapper (macOS only) for a scheduled cover sync. It is not part
# of the normal workflow: it is how one Mac runs `bun scripts/sync-covers.ts` on a
# timer, kept here as a starting point. Point a LaunchAgent plist of your own
# (e.g. ~/Library/LaunchAgents/nl.waterhouse.covers.plist) at this file.
#
# launchd gives a job almost no environment, so PATH is set explicitly — bun,
# node and Remotion's browser all need to be found without a login shell. The
# repo is found relative to this script, so it works from any clone. Set BUN to
# override which bun is used. Notifications go through osascript.

set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOG="$REPO/out/covers-sync.log"

export PATH="$HOME/.bun/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export HOME
BUN="${BUN:-$(command -v bun)}"

cd "$REPO" || { echo "$(date '+%F %T')  repo not found at $REPO" >>"$LOG"; exit 1; }
mkdir -p "$REPO/out"
[ -n "$BUN" ] || { echo "$(date '+%F %T')  bun not found on PATH (set BUN)" >>"$LOG"; exit 1; }

before=$(ls out/posters/session-*.png out/posters/upcoming/*.png 2>/dev/null | wc -l | tr -d ' ')

{
  echo ""
  echo "===== $(date '+%F %T') ====="
} >>"$LOG"

"$BUN" scripts/sync-covers.ts >>"$LOG" 2>&1
status=$?

after=$(ls out/posters/session-*.png out/posters/upcoming/*.png 2>/dev/null | wc -l | tr -d ' ')
new=$((after - before))

if [ $status -ne 0 ]; then
  echo "$(date '+%F %T')  FAILED (exit $status)" >>"$LOG"
  /usr/bin/osascript -e 'display notification "Cover sync failed — see out/covers-sync.log" with title "Waterhouse Radio"' 2>/dev/null
elif [ "$new" -gt 0 ]; then
  echo "$(date '+%F %T')  $new new cover(s)" >>"$LOG"
  /usr/bin/osascript -e "display notification \"$new new cover(s) in out/posters\" with title \"Waterhouse Radio\"" 2>/dev/null
else
  echo "$(date '+%F %T')  nothing new" >>"$LOG"
fi

# Keep the log from growing without bound.
if [ -f "$LOG" ] && [ "$(wc -l <"$LOG")" -gt 2000 ]; then
  tail -n 800 "$LOG" >"$LOG.tmp" && mv "$LOG.tmp" "$LOG"
fi

exit $status
