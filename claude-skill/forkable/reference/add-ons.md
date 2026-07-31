# Add-ons (sides, bases, proteins)

Terminology: these are **add-ons** in conversation. The API field is `modifiers`, and each group contains `options`. Use "add-ons" when talking to the user.

## Contents
- Reading the groups
- Seeing what's already on an order
- Choosing deliberately
- Pricing
- Validation and failure modes

## Reading the groups

Many items carry a `modifiers` array. Each group looks like:

```json
{
  "id": 12,
  "name": "Choose Side",
  "required": true,
  "min": 1, "max": 1, "free": false,
  "options": [
    {"optionId": 7, "name": "House Salad", "price": 0},
    {"optionId": 9, "name": "Sub for Caesar Salad (side)", "price": 1}
  ]
}
```

- **Required** means `required: true` or `min >= 1`. It must be answered before the item can be ordered.
- `price` on an option is a **surcharge** on top of the item's base price. `0` means included.

## Seeing what's already on an order

`current.modifiers` is the menu of what's *available*. `current.selectedAddOns` is what's actually *configured*, resolved to names and prices:

```json
[
  {"modifierId": 150, "modifier": "Choose Protein", "optionId": 147, "option": "1/2 Tuna, 1/2 Salmon", "price": 0},
  {"modifierId": 156, "modifier": "Choose Grains", "optionId": 152, "option": "Quinoa", "price": 0}
]
```

**Quote these whenever you describe a scheduled meal.** "Poke Bowl" doesn't tell the user whether it's half-tuna on quinoa or cooked salmon on brown rice, and those are different lunches. It matters most when you're recommending no change, since the user takes no action and would otherwise never see the configuration.

This is also how you confirm a change landed: modify with `--select`, then read `selectedAddOns` back.

## Choosing deliberately

If you say nothing, the CLI picks a preference-aware default for each required group and reports it as `[auto]` alongside a `needsChoice` warning. **That's a fallback, not a decision.** Pass your choices explicitly:

```
forkable choose <deliveryId> --item <itemId> --menu <menuId> --select '{"<modifierId>":[<optionId>]}'
```

Skip an optional group with `-1`, or leave it out entirely.

**Reason about add-ons the way you reason about the dish.** A fried side undercuts a "lighter lunch" note as surely as a fried entree does. A required base choice between vermicelli and white rice is a real decision, not a formality.

Watch for surcharges pushing past the user's price guidance. If the best-fitting configuration goes over, say so and explain why, rather than silently downgrading to the cheapest option.

## Pricing

`--dry-run` prints the resolved configuration and the real total:

```
Poke Bowl — Carrot Express $25.99
  Choose Protein: Fresh Salmon (included)
  Choose Grains: Quinoa (included)
  total: $25.99
```

**Quote the total to the user, not the base price.** A $20.99 item with a $6.99 side is a $27.98 order. This is also why `current.price` on a scheduled meal can exceed the menu item's base price.

## Validation and failure modes

- **Bad selections fail loudly** rather than falling back silently: unknown option id, an option that doesn't belong to that group, a required group skipped, more options than `max` allows. Fix the selection instead of dropping the flag.
- **Dietary conflicts block the order.** `choose` runs Forkable's own `mealRestrictions` check against the resolved configuration and refuses if it reports a conflict. Only pass `--force` if the user explicitly tells you to.
- **`auto` uses defaults, not judgment.** `forkable auto --next` fills a week with preference-aware defaults for every required group. It's fine for speed, but it won't reason about sides. For a considered week, choose days individually with `--select`.
