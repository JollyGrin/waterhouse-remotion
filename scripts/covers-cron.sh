#!/bin/bash
# Scheduled cover sync. Run by ~/Library/LaunchAgents/nl.waterhouse.covers.plist.
#
# launchd gives a job almost no environment, so every path here is absolute and
# PATH is set explicitly — bun, node and Remotion's browser all need to be found
# without a login shell.

set -uo pipefail

REPO="$HOME/WH stuff/waterhouse-remotion-main"
BUN="/opt/homebrew/bin/bun"
LOG="$REPO/out/covers-sync.log"

export PATH="/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export HOME

cd "$REPO" || { echo "$(date '+%F %T')  repo not found at $REPO" >>"$LOG"; exit 1; }
mkdir -p "$REPO/out"

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
