# Design note: auto-swap with opt-out

Status: **rails built in 0.7.0, behaviour unchanged.** Written 2026-07-31, updated 2026-08-07.

The safety rails this design needs now exist, and nothing acts on its own yet. The Friday review is
still read-only. Flipping it is a one-line change to `friday-review/friday-review-prompt.md`, which
npm never sees, so no release is involved in that step.

**Shipped in 0.7.0:**
- `forkable revert <deliveryId>` / `revert --week` / `--next`, plus `forkable undo-log`. Restores the
  exact displaced order, including add-on `selections` and instructions. Verified by round-tripping
  two real orders, one of which had a configured add-on.
- Guard 1 and 2 below are done: every replacing order records what it displaced, and there is a real
  undo command rather than a claim that you could change it back.
- Guard 3 is done: `prefs maxTotal` plus `--max-total`, checked at order time against the real total
  including surcharges, refusing rather than warning. Deliberately NOT waived by `--force`, which is
  only about dietary conflicts. George set his ceiling at $30 on 2026-08-07, with the $20 note
  staying a soft guideline: *"i don't care too much about 'hard capping' on price for a swap. just
  use judgment and stay within the range, soft guideline. if you really need something, don't go over
  $30."* No max-delta cap was built, on the same instruction.
- Open question 5 is answered: decisions carry `mode: "auto" | "approved"`, defaulting to approved.

**Correction to "phase it, safest case first" below.** Shipping phase 1 alone does nothing for
George: his account has a Forkable suggestion on every delivery day (checked across the weeks of
Aug 3 and Aug 10), so there are no empty days to auto-pick into. Phase 1 is a real win for users who
never turned suggestions on, but it is not a stepping stone to phase 2 for him and buys no
observation time on the risky path. Hence rails first, which is neither phase.

**Still open before flipping:** what makes a swap auto-worthy (question 1). Recommendation is to fire
only on a deterministic rule violation - an `avoid`/`dislikes` hit in `ingredientTags` or the
description - and never on a preference improvement, since picks are non-deterministic across runs
and "the model liked this one better today" is a weak basis for spending money. Everything short of a
clear violation stays a suggestion in the report.

This is an internal design note, not a product spec. If it needs sharing beyond George, promote it
into the standard spec format.

## The change

**Today:** the Friday review is read-only. It proposes swaps, George approves them in a session, and
Claude places them. If George never reads the report, Forkable's own picks get auto-ordered.

**Proposed:** the review places its swaps itself. George intervenes only to override, via a Claude
Code session pointed at the report.

## Why this is better UX, precisely

Reframe what's actually changing. **Something already gets ordered without George's involvement** -
Forkable auto-orders its own suggestion today. So this doesn't add autonomy, it changes *whose
default wins* when nobody acts.

That reframe matters for risk. "The agent might order something bad" has to be measured against
"Forkable orders something bad," which demonstrably happens: it suggested a panko-fried chicken
sandwich to someone whose stated dislikes are `fried` and `burger`, and would have shipped it
unchallenged. The read-only design protects the wrong default.

Nick's framing from testing: "ready for a world where I can just trust the suggestions."

## Phase it, safest case first

**Phase 1: auto-PICK on days with no suggestion.** This is strictly additive. Nothing is being
overwritten, because Forkable has scheduled nothing and will order nothing. The counterfactual is no
lunch. Lowest risk in the whole design, and it's the case that helps users who never turned
suggestions on.

**Phase 2: auto-SWAP over an existing suggestion.** Genuinely destructive, since it discards a choice
that would otherwise have shipped. Needs every guard below.

Shipping phase 1 alone is a real improvement and buys observation time.

## Guards phase 2 needs

1. **Reversibility is the core safety property.** Swaps are undoable until the day locks. Record the
   original `pieceId`, `itemId` and `menuId` so a revert restores exactly, not approximately.
2. **A real undo path.** `forkable revert <deliveryId>` and `--week`. Without this, "you can change
   it back" is a claim rather than a command, and George would have to reconstruct the original from
   a report.
3. **A hard budget ceiling, separate from the soft guideline.** The ~$20 note is judgment guidance.
   Autonomous action needs a number it will not cross without asking, plus a cap on the delta versus
   the current pick. Auto-swapping a $18 meal to a $32 one is not in the spirit of the ask.
4. **Confidence gating: when in doubt, leave it alone.** A marginal swap should become a suggestion
   in the report rather than an action. Note that today's picks are non-deterministic across runs, so
   "the model preferred X this time" is a weak basis for spending money.
5. **Dietary conflicts stay hard blocks.** `mealRestrictions` already refuses; auto mode must never
   pass `--force`.
6. **Opt-in per user, default off.** Nick should not inherit George's risk tolerance.
7. **The report becomes a receipt, not a proposal.** Past tense, what changed, what it replaced, the
   cost delta, and the exact revert command.

## Failure modes to handle explicitly

| Situation | Behavior |
|---|---|
| Session expired | Change nothing, report that login is needed |
| Day already locked | Skip, note it |
| Required add-on group with a real choice | Use the preference-aware default, or skip the swap if the choice is material |
| Menu fetch fails for one day | Leave that day alone, continue with the others |
| Agent run dies partway | Log each action as it lands, so a partial week is reconstructable |

## Open questions for George

1. **What makes a swap auto-worthy?** Rating gap, an explicit dislike hit, price, or something else?
   The Chicken Goddess case is easy, since it hits a stated dislike. A 3.5-star soup versus a 4.0-star
   bowl is not.
2. **Hard ceiling number** for autonomous spend, and max delta over the existing pick.
3. **Ship phase 1 alone first?** My recommendation is yes.
4. **Notification.** A passive HTML report is fine for proposals. If the system has already spent
   money, does that warrant a push? Earlier decision was local HTML over Slack because self-DMs
   don't notify and felt janky, but acting autonomously changes the calculus.
5. **Does auto mode log to `decisions.jsonl` differently?** An unreviewed auto-swap is weaker signal
   than an approved one, and mixing them would pollute the learning loop.

## Prerequisites already in place

- `choose --select` with validation and `mealRestrictions` blocking
- Priced-out configurations, so a budget guard has a real total to check
- `canChange` / `changeBlockedBy` for lock detection
- `decisions.jsonl` via `forkable log`, though it does not yet record the original piece ids needed
  for an exact revert
