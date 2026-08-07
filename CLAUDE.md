# forkable-cli

George's PERSONAL side project (unofficial agent-friendly Forkable lunch-ordering CLI). Auto-memory has the API details.

Rules for this repo:
- This is a flamewheel (personal) GitHub project - use the `github-personal` MCP and the HTTPS/flamewheel git identity, NOT the Spade `github` MCP or the george-spade SSH identity.
- It wraps Forkable's private GraphQL API (reverse-engineered) - be conservative with request volume; don't hammer endpoints.
- `forkable` is NOT installed globally here. Run the local build: `node bin/forkable.js …`.

## Friday auto-review (runs headless; no Claude session needed)
launchd job `com.george.forkable-friday-review` wakes every 30 min (`StartInterval` 1800, + `RunAtLoad`) → `friday-review/run-friday-review.sh` → headless `claude` fed `friday-review/friday-review-prompt.md`. The *script* decides whether to act, not the schedule.

**It ACTS (since 2026-08-07).** It judges next week's meals against prefs + notes, **places the swaps itself**, logs each decision with `mode:"auto"`, then writes `friday-review/latest.html` (+ dated copy in `reviews/`, `.md` record) and `open`s the HTML in George's browser. Two guards make that safe, and neither is optional:
- **$30 hard ceiling** (`prefs maxTotal`), checked on the real total including add-ons, refusing rather than warning. The prompt forbids `--max-total none` and forbids raising it.
- **Every change is reversible** via `forkable revert <deliveryId>` until the day locks, and the receipt prints the command per day.

The prompt also forbids `--force` (which would override a dietary conflict). A day it wanted to change but couldn't is reported as **COULDN'T**, never silently as a keep.

- Force a run any time (bypasses day/time checks): `bash friday-review/run-friday-review.sh test` - note this now really orders, so use a `--dry-run` by hand if you only want to look.
- **Every invocation logs why it ran or didn't** to `friday-review/logs/trace.log` (trimmed to 500 lines). Read that FIRST when a run seems to have been skipped - it distinguishes "launchd never fired" from "a guard tripped".
- **Footgun:** every run writes `friday-review/<TODAY>.md`, and that file *is* the once-per-Friday marker. So a manual morning run makes the real scheduled run exit early. Delete that `.md` to re-arm.
- Auto mode self-guards: Friday only, hour >= 10 (`START_HOUR` in the script; 10:00 at George's request 2026-08-07, was noon), once/day, plus a single-instance `.review.lock` dir. All four trace their exit, so none of them fail silently.

### Settled 2026-08-07, don't re-derive: never use `StartCalendarInterval` on this machine
The job originally fired on `StartCalendarInterval` (Weekday 5, Hour 12). **macOS stopped delivering clock-based launchd events in George's GUI session, so it never once ran itself** - the Jul 31 `latest.html` came from manual `test` runs, and the Aug 7 noon run never happened.

Proven with a throwaway job whose only action was `touch`ing a file:
- calendar schedule 3 min out → never fired; re-armed 7 min out → never fired (so not a lead-time artifact)
- same job via `launchctl kickstart` → fired instantly (job body fine)
- same job on `StartInterval` 60s → **fired on time**

So launchd's own repeating timer works; the calendar-event path (delivered by `UserEventAgent-Aqua`) does not. Ruled out: Mac asleep (up 18 days, display on through noon), job disabled, stale lock, marker file, bad `claude` symlink. Fix was to move to `StartInterval` and let the script's guards filter - extra wakeups are free and it self-heals a missed tick. Don't "tidy" it back to a calendar schedule.
