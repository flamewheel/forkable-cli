# Design note: auto-swap with opt-out

Status: scoping, nothing built. Written 2026-07-31.

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
