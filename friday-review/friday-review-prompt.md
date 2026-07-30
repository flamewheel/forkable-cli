You are running George's automated Friday Forkable review, headless (no human in the loop this run). It's Friday, Forkable's meal suggestions for next week are up, and Forkable will auto-order them if nothing changes.

Your job: review next week's suggestions against George's preferences and write an HTML report he'll read in his browser. This run is READ-ONLY. Do NOT place or change any order. George approves swaps later, with him in the loop.

The CLI is at /Users/georgezhao/work/forkable-cli/bin/forkable.js (run with `node`). It reads George's saved session and prefs.

Steps:
1. Pull next week: `node /Users/georgezhao/work/forkable-cli/bin/forkable.js --json week --next`
   - If it returns `ok:false` / a not-logged-in or auth error: write the HTML report (see step 6) saying the Forkable session expired and he should run `forkable login`, then stop.
   - If there are no deliveries, or none have a suggested meal yet: write the HTML report saying next week's suggestions aren't posted yet and a manual check later may be worth it, then stop.
2. Read prefs: `node /Users/georgezhao/work/forkable-cli/bin/forkable.js --json prefs show` (likes, dislikes, avoid, diet, maxPrice, and the free-text `notes`).
3. For each delivery day, pull the ranked menu: `node /Users/georgezhao/work/forkable-cli/bin/forkable.js --json menu <deliveryId> --next`. Judge Forkable's currently-suggested meal for that day against George's prefs AND notes. His taste: lighter lunches (bowls, salads, grains, greens); loves fish and sushi but NO bone-in fish (deboned/filleted only); Mediterranean, Greek, and Asian all work; Mapo Tofu is a liked exception to "lighter"; he usually skips burgers and Italian at lunch; he likes cuisine variety across the week.
4. Decide per day: KEEP (the suggestion already fits - Forkable auto-orders it) or SWAP (name a specific better-fitting item from that day's menu: item name, venue, price, one-line why). Note each day's change cutoff if it's visible in the data.
5. This run is read-only. Do not place or change any order.
6. Write the report as a single self-contained HTML file (inline CSS, no external assets, no JS needed) to BOTH:
   - /Users/georgezhao/work/forkable-cli/friday-review/latest.html  (overwrite each run)
   - /Users/georgezhao/work/forkable-cli/friday-review/reviews/<TODAY-YYYY-MM-DD>.html  (dated copy; mkdir the reviews/ dir if needed)
   Also write a plain-markdown copy to /Users/georgezhao/work/forkable-cli/friday-review/<TODAY-YYYY-MM-DD>.md as a record.

HTML report layout (keep it clean and skimmable, George reads this at his desk):
- A header with "Forkable - week of <Mon date>" and the run date.
- A one-line summary up top: e.g. "3 of 5 look good, 2 I'd swap."
- One card per day: weekday + date, Forkable's suggested meal, then a clear KEEP or SWAP badge. For SWAP, show the proposed item, venue, price, and a one-line why. Show the change cutoff if known.
- A footer line: "Reply in Claude to approve any swaps and I'll place them before the cutoff."
- Neutral, readable styling. System font, generous spacing, a subtle color for KEEP (green-ish) vs SWAP (amber-ish). Do not use em dashes in the copy.

The wrapper script opens latest.html in the browser after you finish, so make sure it's written and valid.
