---
name: forkable
description: "Order and manage Forkable lunch via the forkable-cli. Activate when the user wants to order lunch, see or change their Forkable meals, set food preferences, or auto-order a week — e.g. 'order my lunch', 'what am I getting for lunch', 'set my forkable prefs', 'pick next week's meals', 'auto-order forkable'. Wraps the forkable-cli npm package."
---

# Forkable (order lunch via forkable-cli)

Drive the `forkable` CLI (npm package `forkable-cli`) to view and place the user's Forkable lunch orders. Every command supports `--json` — prefer it and parse the result rather than scraping human output.

## Preflight (run before acting)
1. **Installed?** Run `forkable --version`. If it's missing, tell the user to install it: `npm install -g forkable-cli` (needs Node 20+). Don't try to install it for them.
2. **Logged in?** Run `forkable --json whoami`. If it returns `ok:false` or an auth error, tell the user to run `forkable login` themselves (they enter their own Forkable email + password; the session saves locally). If their org logs into Forkable via SSO/Okta, password login won't work — point them to Forkable's web app.

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

## Ordering (spends the user's meal budget — CONFIRM FIRST)
Placing or changing a meal is a real order. Always preview, then get an explicit yes, then commit:
1. **Preview** with `--dry-run`: `forkable --json auto --next --dry-run` (whole week) or `forkable --json choose <deliveryId> --best --dry-run` (one day).
2. **Show the user the plan** — day → meal → venue → price — and wait for confirmation.
3. **Commit** by re-running the same command WITHOUT `--dry-run`.

Never place a real order without showing the plan first, even if the user says "just order" — show the plan, then a single quick confirm.

- Auto-fill a whole week by preference: `forkable auto --next`
- Pick one day: `forkable choose <deliveryId> --best`, or an explicit item: `forkable choose <deliveryId> --item <itemId> --menu <menuId>`

## Good to know
- Forkable also auto-orders natively from saved prefs; this tool is for *steering* it (custom picks, overrides, bulk changes), not replacing it.
- Meals lock after each day's cutoff. `week` shows `canChange:false` (🔒) for days that can no longer be changed — don't attempt those.
- Several people sharing one machine can keep separate logins with `FORKABLE_CONFIG_DIR=~/.forkable-<name>`.
