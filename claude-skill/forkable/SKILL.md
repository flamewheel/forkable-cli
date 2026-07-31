---
name: forkable
description: "Views and places Forkable lunch orders through the forkable-cli, manages food preferences, and picks meals for a week. Use when the user wants to order lunch, see or change their Forkable meals, set food preferences, or auto-order a week - for example 'order my lunch', 'what am I getting for lunch', 'set my forkable prefs', 'pick next week's meals', 'auto-order forkable'."
---

# Forkable (order lunch via forkable-cli)

Drive the `forkable` CLI (npm package `forkable-cli`) to view and place the user's Forkable lunch orders. Every command supports `--json` - prefer it and parse the result rather than scraping human output.

**Detailed guides, read when the task calls for them:**
- **Learning what someone likes, and how to ask:** [reference/eliciting-preferences.md](reference/eliciting-preferences.md)
- **Add-ons (sides, bases, proteins) and their surcharges:** [reference/add-ons.md](reference/add-ons.md)

## Preflight (run before acting)
1. **Installed?** Run `forkable --version`. If it's missing, check for a local checkout first - inside a `forkable-cli` working copy run `node bin/forkable.js` instead (same CLI, no global install). Otherwise tell the user to install it: `npm install -g forkable-cli` (needs Node 20+). Don't install it for them.
2. **Logged in?** Run `forkable --json whoami`. On `ok:false` or an auth error, tell the user to run `forkable login` **in a real terminal**. The hidden password prompt needs a TTY, so an agent-run login just errors "email and password required". If their org uses SSO/Okta, password login won't work - point them at Forkable's web app.

First time for this user? Ask only about allergies and diet up front, since those are unsafe to get wrong. Learn everything else from their reactions to real picks - see [reference/eliciting-preferences.md](reference/eliciting-preferences.md).

## Reading (safe - just run and summarize)
- Booked meals: `forkable --json week`, or `forkable --json week --next`.
- A day's options ranked by preference: `forkable --json menu <deliveryId>` (get `deliveryId` from `week`).

**Read `description` and `ingredientTags`. Never judge a dish by its name.** Every item carries `description`, `ingredientTags` (`high_carb`, `fried`, `gluten`, `dairy` are the useful ones), `dietLevel`, `averageRating`, `imageUrl` and `modifiers`. The `menu` payload also has a `current` block: the meal already scheduled that day, resolved to its full item, because Forkable's own suggestion often ranks outside the top 15.

### Never assume which days, or how many
**Read the delivery days out of `week`.** Companies order on different schedules (three days a week, five, one), and the set changes week to week. Never assume Monday to Friday, and never fill in days that aren't there.

**A delivery with `meal: null` has no meal scheduled, which is normal.** Forkable's meal *suggestion* is a per-user setting, and plenty of people never turn it on. Handle both cases, per day, in one week:

- **Suggestion present** → judge it, then keep it or propose a swap. Forkable auto-orders it, so saying nothing is itself a decision.
- **No suggestion** (`meal: null`) → nothing gets auto-ordered. Propose a pick outright, and say it's your suggestion rather than a change to Forkable's.

## Preferences
- Show: `forkable --json prefs show`
- Structured fields the CLI enforces: `likes`, `dislikes`, `avoid` (hard blocks, never selected), `diet`, `maxPrice`. Set with `forkable prefs set <field> <value>`.
- Free-text notes for anything fuzzy: `forkable prefs add-note "<what they said>"`

Sort what you hear: hard blocks and diet become structured fields, everything interpretive becomes a note. "Lighter lunches", "more protein this week", "don't repeat a cuisine" are notes - the CLI can't enforce them, you interpret them at order time.

Capture preferences the moment they're mentioned, mid-conversation, in the user's own phrasing. Don't rely on remembering them in-session.

## Ordering (spends the user's meal budget - CONFIRM FIRST)
1. **Preview** with `--dry-run`: `forkable --json choose <deliveryId> --best --dry-run`, or `forkable --json auto --next --dry-run` for a week.
2. **Show the plan** - day, meal, venue, and the real total including add-on surcharges - and wait for an explicit yes.
3. **Commit** by re-running without `--dry-run`.

Never place a real order without showing the plan first, even if the user says "just order".

- Whole week: `forkable auto --next`
- One day: `forkable choose <deliveryId> --best`, or `forkable choose <deliveryId> --item <itemId> --menu <menuId>`
- With chosen add-ons: add `--select '{"<modifierId>":[<optionId>]}'`. See [reference/add-ons.md](reference/add-ons.md).

## Log every decision (the learning loop)
After a day is settled, record it:

`forkable log '{"week":"2026-08-03","day":"2026-08-04","suggested":"<Forkable's suggestion>","recommended":"keep|swap:<item>","chose":"<what was ordered>","accepted":true|false,"reason":"<why, especially why the user overrode you>"}'`

The `reason` on an override is the signal that matters. Capture the user's own words.

Then use it. Run `forkable decisions` when the user asks, or when the same override keeps recurring. If they steer the same way repeatedly, promote it into a real preference so it stops recurring. The log is raw signal, prefs are the distilled model, and promotion is the loop improving itself.

## Gotchas
- **Item names mislead, constantly.** "Chicken Goddess" is panko-crusted fried chicken on ciabatta, not a green-goddess bowl. "Lemongrass Chicken Bun/Com" is Vietnamese bun/com, meaning vermicelli or rice, not a bread bun. Both produced backwards recommendations before descriptions were being read.
- **`current.price` can exceed the item's base price**, because it includes paid add-ons already configured. A `$21.99` scheduled meal was a `$20.99` item plus a `$1.00` Caesar side.
- **Forkable exposes no cutoff timestamp.** Only the `canChange` boolean, plus `changeBlockedBy` when it's false. Don't report a deadline you can't see.
- **Days lock after their cutoff.** `week` shows `canChange:false` (🔒). Don't attempt those.
- **Forkable auto-orders from its own saved prefs too.** This tool steers that, rather than replacing it. Leaving a suggestion alone means it gets ordered.
- **Several people on one machine** keep separate logins with `FORKABLE_CONFIG_DIR=~/.forkable-<name>`.
