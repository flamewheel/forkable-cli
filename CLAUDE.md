# forkable-cli

George's PERSONAL side project (unofficial agent-friendly Forkable lunch-ordering CLI). Auto-memory has the API details.

Rules for this repo:
- This is a flamewheel (personal) GitHub project — use the `github-personal` MCP and the HTTPS/flamewheel git identity, NOT the Spade `github` MCP or the george-spade SSH identity.
- It wraps Forkable's private GraphQL API (reverse-engineered) — be conservative with request volume; don't hammer endpoints.
- `forkable` is NOT installed globally here. Run the local build: `node bin/forkable.js …`.

## Friday auto-review (runs headless; no Claude session needed)
launchd job `com.george.forkable-friday-review` wakes every 30 min (`StartInterval` 1800, + `RunAtLoad`) → `friday-review/run-friday-review.sh` → headless `claude` fed `friday-review/friday-review-prompt.md`. The *script* decides whether to act, not the schedule. READ-ONLY: judges next week's Forkable suggestions against prefs + notes, writes `friday-review/latest.html` (+ dated copy in `reviews/`, `.md` record) and `open`s the HTML in George's browser. It never places orders — George approves swaps in a session afterward.

- Force a run any time (bypasses day/time checks): `bash friday-review/run-friday-review.sh test`
- **Every invocation logs why it ran or didn't** to `friday-review/logs/trace.log` (trimmed to 500 lines). Read that FIRST when a run seems to have been skipped — it distinguishes "launchd never fired" from "a guard tripped".
- **Footgun:** every run writes `friday-review/<TODAY>.md`, and that file *is* the once-per-Friday marker. So a manual morning run makes the real noon run exit early. Delete that `.md` to re-arm noon.
- Auto mode self-guards: Friday only, hour >= 12, once/day, plus a single-instance `.review.lock` dir. All four now trace their exit, so none of them fail silently any more.

### Settled 2026-08-07, don't re-derive: never use `StartCalendarInterval` on this machine
The job originally fired on `StartCalendarInterval` (Weekday 5, Hour 12). **macOS stopped delivering clock-based launchd events in George's GUI session, so it never once ran itself** — the Jul 31 `latest.html` came from manual `test` runs, and the Aug 7 noon run never happened.

Proven with a throwaway job whose only action was `touch`ing a file:
- calendar schedule 3 min out → never fired; re-armed 7 min out → never fired (so not a lead-time artifact)
- same job via `launchctl kickstart` → fired instantly (job body fine)
- same job on `StartInterval` 60s → **fired on time**

So launchd's own repeating timer works; the calendar-event path (delivered by `UserEventAgent-Aqua`) does not. Ruled out: Mac asleep (up 18 days, display on through noon), job disabled, stale lock, marker file, bad `claude` symlink. Fix was to move to `StartInterval` and let the script's guards filter — extra wakeups are free and it self-heals a missed tick. Don't "tidy" it back to a calendar schedule.
