You are running George's automated Friday Forkable review, headless (no human in the loop this run). It's Friday, Forkable's meal suggestions for next week are up, and Forkable will auto-order them if nothing changes.

Your job: review next week's suggestions against George's preferences and write an HTML report he'll read in his browser. This run is READ-ONLY. Do NOT place or change any order. George approves swaps later, with him in the loop.

The CLI is at /Users/georgezhao/work/forkable-cli/bin/forkable.js (run with `node`). It reads George's saved session and prefs.

Steps:
1. Pull next week: `node /Users/georgezhao/work/forkable-cli/bin/forkable.js --json week --next`
   - If it returns `ok:false` / a not-logged-in or auth error: write the HTML report (see step 6) saying the Forkable session expired and he should run `forkable login`, then stop.
   - If there are no deliveries, or none have a suggested meal yet: write the HTML report saying next week's suggestions aren't posted yet and a manual check later may be worth it, then stop.
2. Read prefs: `node /Users/georgezhao/work/forkable-cli/bin/forkable.js --json prefs show` (likes, dislikes, avoid, diet, maxPrice, and the free-text `notes`).
3. For each delivery day, pull the ranked menu: `node /Users/georgezhao/work/forkable-cli/bin/forkable.js --json menu <deliveryId> --next`. Judge Forkable's currently-suggested meal for that day against George's prefs AND notes. His taste: lighter lunches (bowls, salads, grains, greens); loves fish and sushi but NO bone-in fish (deboned/filleted only); Mediterranean, Greek, and Asian all work; Mapo Tofu is a liked exception to "lighter"; he usually skips burgers and Italian at lunch; he likes cuisine variety across the week.

   **Never judge a dish by its name. Read the `description` and `ingredientTags`.** Names are actively misleading and guessing from them has already produced wrong verdicts: "Chicken Goddess" sounds like a green-goddess bowl but is panko-crusted (fried) chicken on ciabatta, and "Lemongrass Chicken Bun/Com" is Vietnamese bun/com (vermicelli/rice), not a bread bun. Each item in the payload carries `description`, `ingredientTags` (watch for `high_carb`, `fried`, `gluten`, `dairy`), `dietLevel`, `averageRating`, `imageUrl`, and a `modifiers` list. Use them.

   The payload also has a `current` block: the meal Forkable has scheduled for that day, resolved to its full menu item (description, imageUrl, rating, modifiers). Use `current` for the suggested meal rather than hunting the ranked list, because Forkable's own suggestion often ranks outside the top 15. Note that `current.price` may include paid modifiers, so it can exceed the item's base price.
4. Decide per day: KEEP (the suggestion already fits - Forkable auto-orders it) or SWAP (name a specific better-fitting item from that day's menu: item name, venue, price, one-line why). Note each day's change cutoff if it's visible in the data.
5. This run is read-only. Do not place or change any order.
6. Write the report as a single HTML file (inline CSS in one `<style>` block, no JS) to BOTH:
   Food photos are the one exception to self-containment: link them directly with `<img src="<imageUrl>">` pointing at Forkable's CDN. Those URLs are public (no auth needed) and George opens this locally with a network connection, so do not try to download or base64-inline them.
   - /Users/georgezhao/work/forkable-cli/friday-review/latest.html  (overwrite each run)
   - /Users/georgezhao/work/forkable-cli/friday-review/reviews/<TODAY-YYYY-MM-DD>.html  (dated copy; mkdir the reviews/ dir if needed)
   Also write a plain-markdown copy to /Users/georgezhao/work/forkable-cli/friday-review/<TODAY-YYYY-MM-DD>.md as a record.

HTML report layout (keep it clean and skimmable, George reads this at his desk):
- A header with "Forkable - week of <Mon date>" and the run date.
- A one-line summary up top: e.g. "3 of 5 look good, 2 I'd swap."
- One card per day: weekday + date and a clear KEEP or SWAP badge, then the suggested meal. For SWAP, follow it with the proposed item under a "SWAP TO" label. Show the change cutoff if known.
- A footer line telling him how to act on it (see "Footer" below).
- Neutral, readable styling. System font, generous spacing, a subtle color for KEEP (green-ish) vs SWAP (amber-ish). Do not use em dashes in the copy.

**Every meal is a horizontal media row: photo on the LEFT, text column on the RIGHT.** Do not stack the
photo above the text - that makes the page tall and George has to scroll past pictures to compare days.
Inside the right-hand column the order is: item name (bold, largest), then a muted meta line
(venue - price - rating), then the description and your commentary underneath. Use this structure for
BOTH the suggested meal and the proposed swap, so the two are visually comparable.

Use this exact skeleton so the layout stays consistent week to week:

```html
<style>
  .meal { display: flex; gap: 16px; align-items: flex-start; }
  .meal img { width: 150px; height: 112px; object-fit: cover; border-radius: 8px;
              flex: 0 0 150px; background: #eee; }
  .meal .body { flex: 1 1 auto; min-width: 0; }
  .meal .name { font-weight: 700; font-size: 1.15rem; margin: 0 0 2px; }
  .meal .meta { color: #6b7280; font-size: 0.9rem; margin: 0 0 8px; }
  .meal .why  { margin: 0; line-height: 1.5; }
  @media (max-width: 560px) { .meal { flex-direction: column; } .meal img { width: 100%; flex: none; } }
</style>

<div class="meal">
  <img src="IMAGE_URL" alt="ITEM NAME">
  <div class="body">
    <p class="name">ITEM NAME</p>
    <p class="meta">VENUE &middot; $PRICE &middot; RATING&#9733;</p>
    <p class="why">Description, then why it fits or does not.</p>
  </div>
</div>
```

If an item has no `imageUrl`, omit the `<img>` entirely and let the text fill the row. Never emit a
broken image or a placeholder file path.

Footer: tell him he can act on this in one step, with the file path so a fresh session has context:
"To approve swaps or answer any questions above, start a Claude Code session in
~/work/forkable-cli and point it at friday-review/latest.html - it has everything it needs."

The wrapper script opens latest.html in the browser after you finish, so make sure it's written and valid.
