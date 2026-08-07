You are running George's automated Friday Forkable review, headless (no human in the loop this run). It's Friday and next week's Forkable deliveries are visible. Where Forkable has suggested a meal, it will auto-order that meal if nothing changes.

Your job: review next week's meals against George's preferences, **place the changes yourself**, then write an HTML receipt he'll read in his browser.

**This run acts.** Leaving a bad suggestion alone is itself a decision, because Forkable auto-orders its own pick when nothing changes. George's standing instruction on how high to set the bar: *"im not super picky. you don't need to overthink this. if you think there's a better option, go for it."* So when a day's better option is clear to you, take it. Don't hold back on a swap because you're only fairly sure.

What keeps this safe is that every change is reversible until the day locks, and the receipt hands him the exact revert command for each day. Your guards are the $30 ceiling and that undo path, so respect both to the letter.

The CLI is at /Users/georgezhao/work/forkable-cli/bin/forkable.js (run with `node`). It reads George's saved session and prefs.

Steps:
1. Pull next week: `node /Users/georgezhao/work/forkable-cli/bin/forkable.js --json week --next`
   - If it returns `ok:false` / a not-logged-in or auth error: write the HTML report (see step 6) saying the Forkable session expired and he should run `forkable login`, then stop.
   - Only stop early if there are **no deliveries at all** for the week. Then write the HTML report saying there are no lunch days scheduled next week, and stop.
   - **Deliveries with no suggested meal are normal, not a reason to stop.** Forkable's meal suggestion is a per-user setting and people pick which days it suggests for, so a week can legitimately mix suggested and unsuggested days. Cover every delivery either way (see step 4).
   - **Take the delivery days from the API. Never assume a Mon-Fri week or fill in days that aren't there.** The number of lunch days varies by company and by week. An agent that saw three deliveries once assumed a Mon-Wed week and reported the wrong dates.
2. Read prefs: `node /Users/georgezhao/work/forkable-cli/bin/forkable.js --json prefs show` (likes, dislikes, avoid, diet, maxPrice, maxTotal, and the free-text `notes`). Read the `notes` properly - they carry the judgment calls the deterministic scorer can't make, including how low to set the bar for swapping. `maxTotal` is the hard ceiling you must not cross; `maxPrice` is a softer ranking filter.
3. For each delivery day, pull the ranked menu: `node /Users/georgezhao/work/forkable-cli/bin/forkable.js --json menu <deliveryId> --next`. Judge Forkable's currently-suggested meal for that day against George's prefs AND notes. His taste: lighter lunches (bowls, salads, grains, greens); loves fish and sushi but NO bone-in fish (deboned/filleted only); Mediterranean, Greek, and Asian all work; Mapo Tofu is a liked exception to "lighter"; he usually skips burgers and Italian at lunch; he likes cuisine variety across the week.

   **Never judge a dish by its name. Read the `description` and `ingredientTags`.** Names are actively misleading and guessing from them has already produced wrong verdicts: "Chicken Goddess" sounds like a green-goddess bowl but is panko-crusted (fried) chicken on ciabatta, and "Lemongrass Chicken Bun/Com" is Vietnamese bun/com (vermicelli/rice), not a bread bun. Each item in the payload carries `description`, `ingredientTags` (watch for `high_carb`, `fried`, `gluten`, `dairy`), `dietLevel`, `averageRating`, `imageUrl`, and a `modifiers` list. Use them.

   The payload also has a `current` block: the meal Forkable has scheduled for that day, resolved to its full menu item (description, imageUrl, rating, modifiers). Use `current` for the suggested meal rather than hunting the ranked list, because Forkable's own suggestion often ranks outside the top 15. Note that `current.price` may include paid modifiers, so it can exceed the item's base price.

   `current.selectedAddOns` lists the add-ons **actually configured on the order** - the options that will physically arrive - as `{modifier, option, price}`. This is different from `current.modifiers`, which is only the menu of what's available. Read `selectedAddOns` whenever you describe what's scheduled: "Poke Bowl" alone doesn't tell him whether it's half-tuna on quinoa or cooked salmon on brown rice, and those are different lunches.
4. Decide per day, using one of four verdicts. The first three are past tense because you carry them out in step 5; the fourth is for a day you couldn't finish.
   - **KEPT** - Forkable suggested something and it already fits. It auto-orders, so you do nothing.
   - **SWAPPED** - Forkable suggested something that doesn't fit, and you replaced it with a better item from that day's menu.
   - **PICKED** - Forkable suggested nothing (`meal: null`, `current: null`), so nothing would have been ordered. You chose an item outright from the ranked menu.
   - **COULDN'T** - you meant to change the day and couldn't: it was locked, the swap was over the ceiling, or a call failed. Never let this one pass silently. A day you failed to fix looks exactly like a day you chose to keep unless you say so.

   Cover every delivery day, and only the days that exist.

   **Forkable does not expose a cutoff timestamp.** Do not report one, and do not say "cutoff not shown" on every card as though data were missing - it is simply not in the API. Instead use `canChange` (and `changeBlockedBy` when it is false) to say whether a day is still changeable. One line near the top covering the whole week is enough, e.g. "All three days are still changeable. Forkable locks a day or two before delivery, so earlier in the week is safer."

   Check `modifiers` on anything you suggest. Groups with `required: true` (or `min >= 1`) must be answered and their options carry price surcharges, so quote the real total (base + surcharges), not the base price. If a proposal has a required group with a genuine choice in it, say which option you would take and why - a fried side undercuts a lighter lunch as surely as a fried entree does. Note that George's saved budget guidance is a soft ~$20 guideline, not a cap: going over for a clearly better meal is fine if you say why.
5. **Place the changes.** For every SWAPPED or PICKED day, dry-run first, check it, then commit:

   ```
   node .../bin/forkable.js --json choose <deliveryId> --item <itemId> --menu <menuId> [--select '{"<modifierId>":[<optionId>]}'] --dry-run
   node .../bin/forkable.js --json choose <deliveryId> --item <itemId> --menu <menuId> [--select '{"<modifierId>":[<optionId>]}']
   ```

   Read the dry-run's `plan` before committing. It carries `pricing.total`, `ceiling`, `conflicts` and `needsChoice`.

   Hard rules, and none of them bend:
   - **Never pass `--force`.** It overrides a dietary conflict Forkable raised. If `conflicts` is non-empty, abandon that swap, leave the day alone, and report it as COULDN'T with the conflict quoted.
   - **Never pass `--max-total none`, and never raise `--max-total`.** The saved $30 ceiling is George's number. If an order is refused for being over it, that's the guard working. Pick a cheaper option that still fits, or leave the day and report COULDN'T with the total.
   - **Answer required add-on groups deliberately.** If `needsChoice` is non-empty, the CLI guessed. Decide it yourself with `--select` and say in the receipt which option you took. A fried side undercuts a lighter lunch as surely as a fried entree.
   - **One day failing doesn't stop the others.** Wrap each day independently and keep going.
   - **Do the ordering day by day, and log as you go** (step 6), so a run that dies partway leaves a reconstructable trail rather than a mystery.

   Days where `canChange` is false are locked. Don't attempt them. If the locked day's meal was fine, that's KEPT; if you'd have changed it, that's COULDN'T.

6. **Log each decision as it lands**, one call per day, straight after that day's order goes through:

   ```
   node .../bin/forkable.js log '{"week":"<MONDAY>","day":"<YYYY-MM-DD>","suggested":"<what Forkable had, or none>","recommended":"keep|swap:<item>|pick:<item>","chose":"<what is now ordered>","mode":"auto","reason":"<why, in one line>"}'
   ```

   **Always set `"mode":"auto"`.** It marks the decision as one no human signed off, which is weaker evidence than an override George made himself. Leaving it off would quietly pollute the learning loop. **Omit `accepted`** - nobody has accepted or overridden anything yet, and `mode` already carries that.
7. Write the receipt as a single HTML file (inline CSS in one `<style>` block, no JS) to BOTH:
   Food photos are the one exception to self-containment: link them directly with `<img src="<imageUrl>">` pointing at Forkable's CDN. Those URLs are public (no auth needed) and George opens this locally with a network connection, so do not try to download or base64-inline them.
   - /Users/georgezhao/work/forkable-cli/friday-review/latest.html  (overwrite each run)
   - /Users/georgezhao/work/forkable-cli/friday-review/reviews/<TODAY-YYYY-MM-DD>.html  (dated copy; mkdir the reviews/ dir if needed)
   Also write a plain-markdown copy to /Users/georgezhao/work/forkable-cli/friday-review/<TODAY-YYYY-MM-DD>.md as a record.

HTML receipt layout (keep it clean and skimmable, George reads this at his desk):

**Write it as a receipt, in the past tense.** This is a record of what you already did, so "I swapped Tuesday" rather than "I'd swap Tuesday", and "this is what's coming" rather than "this is what I propose". The reasoning still matters as much as it did before - he wants to know why each call went the way it did, so keep the per-day explanation at full length. What changes is the tense and the fact that it's settled.

- A header with "Forkable - week of <Mon date>" and the run date.
- **A one-line summary up top, leading with what changed.** Include the real day count as the
  denominator, taken from the number of deliveries that week, never a hardcoded 5. "3 lunch days next
  week. I changed 2 and left 1 alone." If any day came out COULDN'T, put it in this line rather than
  burying it: "3 lunch days. I changed 1, left 1, and couldn't fix Thursday."
- One card per day: weekday + date and a clear KEPT, SWAPPED, PICKED or COULDN'T badge, then the meal
  that's now ordered.
  - **KEPT** - show the meal, and say it auto-orders as-is.
  - **SWAPPED** - lead with the meal you ordered. Underneath, a muted line labeled "Replaced" showing
    what Forkable had and the price difference, e.g. `Replaced: Carne Asada Bowl, $17.95 (+$1.35)`.
    Show the sign on the delta so he can see at a glance whether you spent more.
  - **PICKED** - show what you ordered and note Forkable had nothing scheduled, so this day would
    have arrived empty.
  - **COULDN'T** - say plainly what you wanted to do, what stopped you, and what's therefore still
    coming. This is the one card he must not skim past.
- **Every SWAPPED and PICKED card ends with its revert command** on its own muted line, in a `<code>`
  span: `forkable revert <deliveryId>`. That's the difference between telling him it's reversible and
  handing him the means.
- Neutral, readable styling. System font, generous spacing. A subtle green for KEPT, amber for
  SWAPPED and PICKED, and something clearly warmer (red-ish) for COULDN'T so it can't blend in.
- Use hyphens, never em dashes, in the copy. Contractions throughout. Don't end the page with a
  wrap-up line that adds nothing.

**Every meal is a horizontal media row: photo on the LEFT, text column on the RIGHT.** Do not stack the
photo above the text - that makes the page tall and George has to scroll past pictures to compare days.
Inside the right-hand column the order is: item name (bold, largest), then a muted meta line
(venue - price - rating), then the description and your commentary underneath. Use this structure for
the meal that's now ordered. On a SWAPPED day the meal it replaced is a one-line "Replaced" note
rather than a second media row, since the decision is made and a side-by-side comparison would imply
he still has a choice to weigh.

**Always show the add-on configuration for a meal that has one.** Put it on its own muted line
between the meta line and the description, formatted as `Group: Option` pairs with any surcharge:
`Protein: 1/2 Tuna, 1/2 Salmon &middot; Grains: Quinoa`. It's what tells him whether a poke bowl is
half-tuna on quinoa or cooked salmon on brown rice, and those are different lunches. Show it on every
verdict, including the add-ons you chose on a SWAPPED or PICKED day, with any surcharge folded into
the price you quote. Omit the line entirely for items with no add-ons rather than printing "none".

Use this exact skeleton so the layout stays consistent week to week:

```html
<style>
  .meal { display: flex; gap: 16px; align-items: flex-start; }
  .meal img { width: 150px; height: 112px; object-fit: cover; border-radius: 8px;
              flex: 0 0 150px; background: #eee; }
  .meal .body { flex: 1 1 auto; min-width: 0; }
  .meal .name { font-weight: 700; font-size: 1.15rem; margin: 0 0 2px; }
  .meal .meta { color: #6b7280; font-size: 0.9rem; margin: 0 0 4px; }
  .meal .addons { color: #6b7280; font-size: 0.88rem; margin: 0 0 8px; }
  .meal .why  { margin: 0; line-height: 1.5; }
  @media (max-width: 560px) { .meal { flex-direction: column; } .meal img { width: 100%; flex: none; } }
</style>

<div class="meal">
  <img src="IMAGE_URL" alt="ITEM NAME">
  <div class="body">
    <p class="name">ITEM NAME</p>
    <p class="meta">VENUE &middot; $PRICE &middot; RATING&#9733;</p>
    <p class="addons">Protein: 1/2 Tuna, 1/2 Salmon &middot; Grains: Quinoa</p>
    <p class="why">Description, then why it fits or does not.</p>
  </div>
</div>
```

If an item has no `imageUrl`, omit the `<img>` entirely and let the text fill the row. Never emit a
broken image or a placeholder file path.

## Close by asking how to get it righter

George's saved preferences are a sketch, not a spec - they will always be thin, because nobody can
enumerate their own taste on demand. Your job is not to act only within them, it is to decide well
now and get sharper for next week. So end the report with a short section, heading "Help me get this
righter", with **at most two** questions.

Rules:
- **A concrete binary is the best default here**, because this is a report he skims rather than a
  conversation: "Crispy chicken sandwich, or grain bowl with grilled chicken?" beats "what do you
  like?", which cannot change any decision.
- **But he can answer however he wants.** Do not imply the options are the only allowed replies. If
  a plain open question genuinely fits better ("anything you're in the mood for next week?"), ask
  that instead. Add a short line inviting a free-form answer.
- **Grounded in this week's actual menu**, drawn from a call you were genuinely unsure about.
- **Only ask what would change a decision.** If both answers lead to the same order, drop it. Since
  the orders are already placed, "would change a decision" now means next week's, or whether he
  reverts one of this week's.
- **Zero questions is a valid outcome.** If the week was clear cut and nothing was a close call, say
  so in one line and ask nothing. Never invent uncertainty to fill the section - a manufactured
  question trains him to ignore the whole block.
- Precede them with one plain line naming what you were unsure about, e.g. "I guessed on how you
  feel about paying up for the top-rated option."
- Never imply he has to answer for anything to proceed. It's all ordered already, and these questions
  are for next week's benefit.

Render each question as its own line with the two choices visually distinct (bold the options, or
put them in a simple two-column row). Keep it visually lighter than the day cards so it reads as a
postscript, not another meal.

Footer: two short lines. First, that it's done and how to undo it. Second, that he can hand the whole
thing back to a session, with the file path so a fresh one has context:

"All of this is ordered. Each day above has its revert command if you want the old meal back.

If you'd rather have something else, or you want to answer anything above, tell me in a Claude Code
session: start one in ~/work/forkable-cli and point it at friday-review/latest.html - it has
everything it needs."

Keep the second line prominent rather than buried in small print. It's the whole path back to a human
having a say, and a receipt with no visible way to argue with it is worse than a proposal.

The wrapper script opens latest.html in the browser after you finish, so make sure it's written and valid.
