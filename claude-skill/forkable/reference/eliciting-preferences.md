# Eliciting preferences (how taste actually gets learned)

## Contents
- The core stance
- The pattern, in order
- Choosing a question format
- Rules of engagement
- Persisting what you learn

## The core stance

**Saved preferences are a sketch, not a spec.** They will always be thin and slightly stale, because food is subjective and nobody can enumerate their own taste on demand. Ask someone to describe their preferences cold and you get a short, generic list that turns out not to describe them.

So don't treat `prefs` as a complete model of the user, and don't refuse to act when they're sparse. Make the best call you can from what you have, say what you were unsure about, and ask something that would sharpen the next call.

This inverts normal onboarding. Instead of the user configuring the system before it's useful, the system makes a decision and then guides the user into refining it.

## The pattern, in order

1. **Decide anyway.** Pick using judgment over descriptions, tags and ratings. Never stall for more preferences.
2. **Say where you were guessing.** One concrete line: "I kept the noodle bowl over the poke because you haven't told me how you feel about cold fish." Stated uncertainty beats false confidence.
3. **Ask at most one or two questions**, in whatever form is cheapest for this person to answer.

## Choosing a question format

**A concrete binary is the best default.** It works on someone who has told you nothing, because choosing between two real dishes takes a second and requires no self-analysis:

- "Tuesday: crispy chicken sandwich, or grain bowl with grilled chicken?"
- "Same great salmon bowl twice this week, or force variety and take a worse Thursday?"
- "$26 poke that scores best, or $18 noodle bowl that's nearly as good?"

**But match how the person actually talks.** The right question is the one they'll answer, not the one that's easiest to score:

| What they do | What to do next |
|---|---|
| Answers in prose, volunteers reasons, tells you about a meal they had | Stop handing them menus. Ask openly, or just listen |
| Terse, one-word answers, or brand new to this | Stay binary |
| Volunteers a paragraph unprompted | Take it, thank them, don't quiz them to fill in a form |
| Answers sideways: "I just don't want to think about lunch" | That IS the answer. Note it and stop asking |

Read the *shape* of the reply as signal about how to ask next time, and persist that too. "Prefers to just be told, doesn't want options" is as useful a note as anything about fish. This generalizes past food - it's how to elicit any subjective preference.

The only genuinely bad questions are ones that can't change a decision: "What are your food preferences?", "Do you like Asian food?" Too broad to act on. Allergies and diet are the exception worth asking directly, once, up front.

## Rules of engagement

- **At most two questions per interaction, and zero is often right.** Progressive disclosure, not an intake form. Someone who feels interrogated stops answering.
- **Only ask what would change a real decision.** If both answers lead to the same order, don't ask.
- **Prefer contrasts from this week's actual menu** over hypotheticals.
- **Never let asking gate an order.** Ask alongside the recommendation, never before it. If they don't answer, or answer something unrelated, order with what you have and move on. An unanswered question isn't a blocker, it's a question you didn't need. Acting on partial information and being corrected later beats stalling for completeness.

## Persisting what you learn

An answer you don't persist is worse than not asking, because you'll ask again next week.

- Hard block or diet → structured field: `forkable prefs set avoid peanut`, `forkable prefs set diet pescatarian`
- Everything softer → `forkable prefs add-note "<what they said>"`

Use the user's own phrasing. "Fried stuff feels heavy at my desk" carries more signal than "dislikes fried", because it tells you *when* the preference applies.
