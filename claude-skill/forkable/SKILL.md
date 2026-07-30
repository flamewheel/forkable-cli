---
name: forkable
description: "Order and manage Forkable lunch via the forkable-cli. Activate when the user wants to order lunch, see or change their Forkable meals, set food preferences, or auto-order a week — e.g. 'order my lunch', 'what am I getting for lunch', 'set my forkable prefs', 'pick next week's meals', 'auto-order forkable'. Wraps the forkable-cli npm package."
---

# Forkable (order lunch via forkable-cli)

Drive the `forkable` CLI (npm package `forkable-cli`) to view and place the user's Forkable lunch orders. Every command supports `--json` — prefer it and parse the result rather than scraping human output.

## Preflight (run before acting)
1. **Installed?** Run `forkable --version`. If it's missing, tell the user to install it: `npm install -g forkable-cli` (needs Node 20+). Don't try to install it for them.
2. **Logged in?** Run `forkable --json whoami`. If it returns `ok:false` or an auth error, tell the user to run `forkable login` **in a real terminal** (not via your `!` shell - the hidden password prompt needs a TTY, so an agent-run login just errors "email and password required"). They enter their own Forkable email + password; the session saves locally. If their org logs into Forkable via SSO/Okta, password login won't work - point them to Forkable's web app.

First time for this user? Once they're logged in, offer to set up their tastes conversationally ("tell me what you like and don't for lunch") and capture it into prefs - that's the fastest path to good recs.

## Reading (safe — just run and summarize)
- This week / next week's booked meals: `forkable --json week` or `forkable --json week --next`.
- A day's options ranked by the user's prefs: `forkable --json menu <deliveryId>` (get `deliveryId` from `week`).

## Preferences
- Show: `forkable --json prefs show`.
- Set (each is its own command):
  - `forkable prefs set likes "salmon,chicken,bowl"`
  - `forkable prefs set dislikes "tofu,beets"`
  - `forkable prefs set avoid "peanut,shellfish"`  (allergies / hard blocks — never selected)
  - `forkable prefs set diet pescatarian`  (omnivore | pescatarian | vegetarian | vegan | none)
  - `forkable prefs set maxPrice 20`

## Open-ended preferences (the "just talk to me" layer)
The user can express preferences in plain language instead of flags. When they do, sort them:
- **Structured / enforceable** → set the real field so the CLI enforces it: diet ("I'm pescatarian" → `prefs set diet pescatarian`), allergies/hard blocks ("peanut allergy" → `prefs set avoid peanut`), clear likes/dislikes, price cap.
- **Fuzzy / interpretive** ("lighter lunches", "more protein this week", "don't repeat a cuisine", "something warm when it's cold") → persist as a free-text note: `forkable prefs add-note "<what they said>"`.

At **order time**, apply BOTH layers:
1. Get candidates from the CLI (it already ranks by the structured prefs + Forkable's own score): `forkable --json menu <deliveryId>` per day, or `forkable --json auto --next --dry-run` for the week.
2. Read the free-text notes: `forkable --json prefs show` → `prefs.notes`.
3. Among the CLI's **eligible** items, use judgment to honor the notes (e.g. pick lighter options, spread cuisines across the week, favor higher-protein dishes). The CLI guarantees the hard constraints; you handle the nuance.
4. Place the specific picks with `forkable choose <deliveryId> --item <itemId> --menu <menuId>` (after the confirm step below).

When the user just chats a preference mid-conversation, capture it right then with `prefs add-note` (or the structured setter) so it persists for next time — don't rely on remembering it only in-session.

## Ordering (spends the user's meal budget — CONFIRM FIRST)
Placing or changing a meal is a real order. Always preview, then get an explicit yes, then commit:
1. **Preview** with `--dry-run`: `forkable --json auto --next --dry-run` (whole week) or `forkable --json choose <deliveryId> --best --dry-run` (one day).
2. **Show the user the plan** — day → meal → venue → price — and wait for confirmation.
3. **Commit** by re-running the same command WITHOUT `--dry-run`.

Never place a real order without showing the plan first, even if the user says "just order" — show the plan, then a single quick confirm.

- Auto-fill a whole week by preference: `forkable auto --next`
- Pick one day: `forkable choose <deliveryId> --best`, or an explicit item: `forkable choose <deliveryId> --item <itemId> --menu <menuId>`

## Log every decision (this is the learning loop)

After each day is settled - you placed a swap, or the user kept Forkable's suggestion or your rec - append a record to the learning log:

`forkable log '{"week":"2026-08-03","day":"2026-08-04","suggested":"<Forkable's suggestion>","recommended":"keep|swap:<item>","chose":"<final item ordered/kept>","accepted":true|false,"reason":"<why - especially why the user overrode you>"}'`

The `reason` on an override is the important signal. Capture what the user actually said, in their words if you can.

Then use it. When the user asks, or when you notice the same override recurring, run `forkable decisions` and look for patterns. If they keep steering the same way (always swaps out X, always wants lighter on a given day), promote it into a real preference - a structured field or a `prefs add-note` - so it stops recurring and the rec gets it right up front. That promotion is the loop improving itself; the log is raw signal, prefs are the learned model.

## Good to know
- Forkable also auto-orders natively from saved prefs; this tool is for *steering* it (custom picks, overrides, bulk changes), not replacing it.
- Meals lock after each day's cutoff. `week` shows `canChange:false` (🔒) for days that can no longer be changed — don't attempt those.
- Several people sharing one machine can keep separate logins with `FORKABLE_CONFIG_DIR=~/.forkable-<name>`.
