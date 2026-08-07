#!/bin/bash
# Automated Friday Forkable review via headless Claude Code.
# launchd wakes this every 30 min (StartInterval); the guards below decide whether to actually run.
# We deliberately do NOT use StartCalendarInterval: macOS stopped delivering those clock events on
# this machine (proven 2026-08-07 with a throwaway job that fired on kickstart and on StartInterval
# but never on a calendar schedule), so a once-a-week instant silently cost a whole week.
# READ-ONLY: reviews next week's Forkable suggestions vs George's prefs and DMs him. Never orders.
#
#   run-friday-review.sh          -> auto: run only if today is Friday, >=12:00, not already done
#   run-friday-review.sh test     -> force a run right now (manual testing, any day)
export HOME=/Users/georgezhao
export PATH="$HOME/.local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

DIR="$HOME/work/forkable-cli/friday-review"
mkdir -p "$DIR/logs"
cd "$DIR" || exit 1

# Every invocation says why it did or didn't run. Without this a missed launchd event and a tripped
# guard look identical from the outside, which is what made the 2026-08-07 miss need forensics.
TRACE="$DIR/logs/trace.log"
trace () { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "$TRACE"; }
trim_trace () { tail -n 500 "$TRACE" > "$TRACE.tmp" 2>/dev/null && mv "$TRACE.tmp" "$TRACE"; }

# single-instance lock (prevents overlapping invocations of a long review)
LOCK="$DIR/.review.lock"
if ! mkdir "$LOCK" 2>/dev/null; then
  trace "skip: lock held ($LOCK) - another run in progress, or a stale lock to remove"
  trim_trace
  exit 0
fi
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
# NOTE: the agent writes $DIR/<TODAY>.md either way, and that file IS the once-per-Friday marker,
# so a manual test on a Friday morning disarms the real run. Delete that .md to re-arm.
if [ "$1" = "test" ]; then
  trace "run: forced test"
  trim_trace
  run_review "$(date +%Y-%m-%d)-test"
  exit 0
fi

# Auto mode: Fridays only, at/after noon, once per Friday.
dow=$(date +%u)                                    # 1=Mon .. 7=Sun
if [ "$dow" -ne 5 ]; then trace "skip: not Friday (dow=$dow)"; trim_trace; exit 0; fi
now_h=$(date +%H); now_h=${now_h#0}; [ -z "$now_h" ] && now_h=0
if [ "$now_h" -lt 12 ]; then trace "skip: before noon (hour=$now_h)"; trim_trace; exit 0; fi
D=$(date +%Y-%m-%d)
if [ -f "$DIR/$D.md" ]; then trace "skip: already reviewed $D (marker $D.md exists)"; trim_trace; exit 0; fi
trace "run: auto review for $D"
trim_trace
run_review "$D"
trace "done: $D (see logs/$D.log)"
