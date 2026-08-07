#!/bin/bash
# Automated Friday Forkable review via headless Claude Code.
# launchd wakes this every 30 min (StartInterval); the guards below decide whether to actually run.
# We deliberately do NOT use StartCalendarInterval: macOS stopped delivering those clock events on
# this machine (proven 2026-08-07 with a throwaway job that fired on kickstart and on StartInterval
# but never on a calendar schedule), so a once-a-week instant silently cost a whole week.
# It ACTS: reviews next week's Forkable meals against George's prefs, PLACES the swaps itself, and
# writes an HTML receipt with a per-day revert command. Guarded by a $30 ceiling (prefs maxTotal) and
# by every change being undoable via `forkable revert` until the day locks.
#
#   run-friday-review.sh          -> auto: run only if today is Friday, >=10:00, not already done
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

# Skips repeat every 30 min all week, and 48 identical lines a day would bury the one line that
# matters. So collapse a consecutive run of the same reason into one line carrying a count and the
# most recent timestamp. The timer still fires - that is what retries a run that died before writing
# its marker - this only stops it shouting about it.
trace_skip () {
  local msg="$1" lastmsg lastn
  if [ -s "$TRACE" ]; then
    lastmsg=$(tail -n 1 "$TRACE" | sed -E 's/^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9:]{8} //; s/ \(x[0-9]+\)$//')
    if [ "$lastmsg" = "$msg" ]; then
      lastn=$(tail -n 1 "$TRACE" | sed -nE 's/.* \(x([0-9]+)\)$/\1/p')
      [ -z "$lastn" ] && lastn=1
      sed -i '' -e '$d' "$TRACE" 2>/dev/null
      echo "$(date '+%Y-%m-%d %H:%M:%S') $msg (x$((lastn + 1)))" >> "$TRACE"
      return
    fi
  fi
  trace "$msg"
}

# single-instance lock (prevents overlapping invocations of a long review)
LOCK="$DIR/.review.lock"
if ! mkdir "$LOCK" 2>/dev/null; then
  trace_skip "skip: lock held ($LOCK) - another run in progress, or a stale lock to remove"
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

# Auto mode: Fridays only, at/after 10:00 local, once per Friday.
# 10:00 rather than noon at George's request, 2026-08-07: it fits his schedule better. Next week's
# suggestions are already visible by then.
START_HOUR=10
dow=$(date +%u)                                    # 1=Mon .. 7=Sun
if [ "$dow" -ne 5 ]; then trace_skip "skip: not Friday (dow=$dow)"; trim_trace; exit 0; fi
now_h=$(date +%H); now_h=${now_h#0}; [ -z "$now_h" ] && now_h=0
if [ "$now_h" -lt "$START_HOUR" ]; then trace_skip "skip: before ${START_HOUR}:00 (hour=$now_h)"; trim_trace; exit 0; fi
D=$(date +%Y-%m-%d)
if [ -f "$DIR/$D.md" ]; then trace_skip "skip: already reviewed $D (marker $D.md exists)"; trim_trace; exit 0; fi
trace "run: auto review for $D"
trim_trace
run_review "$D"
trace "done: $D (see logs/$D.log)"
