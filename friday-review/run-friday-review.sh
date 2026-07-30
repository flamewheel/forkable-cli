#!/bin/bash
# Automated Friday Forkable review via headless Claude Code.
# launchd fires Friday 12:00 local (+ RunAtLoad for catch-up if the Mac was asleep at noon).
# READ-ONLY: reviews next week's Forkable suggestions vs George's prefs and DMs him. Never orders.
#
#   run-friday-review.sh          -> auto: run only if today is Friday, >=12:00, not already done
#   run-friday-review.sh test     -> force a run right now (manual testing, any day)
export HOME=/Users/georgezhao
export PATH="$HOME/.local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

DIR="$HOME/work/forkable-cli/friday-review"
mkdir -p "$DIR/logs"
cd "$DIR" || exit 1

# single-instance lock (prevents the noon timer and login catch-up from overlapping)
LOCK="$DIR/.review.lock"
if ! mkdir "$LOCK" 2>/dev/null; then exit 0; fi
trap 'rmdir "$LOCK" 2>/dev/null' EXIT

run_review () {
  local D="$1"
  local LOG="$DIR/logs/$D.log"
  {
    echo "=== forkable friday review $D start $(date) ==="
    "$HOME/.local/bin/claude" -p "$(cat "$DIR/friday-review-prompt.md")" \
      --model claude-opus-4-8 \
      --dangerously-skip-permissions
    echo "=== end $D $(date) (claude exit $?) ==="
  } >> "$LOG" 2>&1
  # Open the report in George's browser (LaunchAgents run in his GUI session, so `open` works).
  [ -f "$DIR/latest.html" ] && /usr/bin/open "$DIR/latest.html" >> "$LOG" 2>&1
}

# Forced test run (bypasses day/time/done checks).
if [ "$1" = "test" ]; then run_review "$(date +%Y-%m-%d)-test"; exit 0; fi

# Auto mode: Fridays only, at/after noon, once per Friday.
dow=$(date +%u)                                    # 1=Mon .. 7=Sun
[ "$dow" -ne 5 ] && exit 0
now_h=$(date +%H); now_h=${now_h#0}; [ -z "$now_h" ] && now_h=0
[ "$now_h" -lt 12 ] && exit 0                      # not midday yet
D=$(date +%Y-%m-%d)
[ -f "$DIR/$D.md" ] && exit 0                      # already reviewed this Friday
run_review "$D"
