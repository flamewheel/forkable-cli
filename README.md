# forkable-cli

An **unofficial** command-line client for [Forkable](https://forkable.com) lunch ordering.
Forkable has no public API — this CLI drives the same private GraphQL API the Member
Console web app uses. Built to be usable both by humans and by **AI agents** (every
command supports `--json`).

> ⚠️ Unofficial and unsupported. It talks to an internal API that can change without
> notice. Use responsibly and only with your own account.

**New here?** See [QUICKSTART.md](QUICKSTART.md) for the 4-step setup, or install the
[Claude Code skill](claude-skill/forkable/SKILL.md) to order lunch by just asking your agent.

## Install

```bash
npm install -g forkable-cli
forkable init      # installs the Claude Code skill + prints setup steps
forkable login     # your own Forkable account (run in a real terminal)
```

Requires Node ≥ 20 (uses built-in `fetch` + cookie handling). After `forkable init`, restart
Claude Code so it loads the skill, then just talk to it (see [QUICKSTART.md](QUICKSTART.md)).

Working from a clone instead: `npm install`, then `node bin/forkable.js <command>`.

## Quick start

```bash
forkable login                 # prompts for email + password
forkable week --next           # see next week's scheduled meals
forkable menu <deliveryId>      # see ranked options for a day
forkable choose <deliveryId> --best   # auto-pick your top match
forkable auto --next            # fill the whole week by preference
```

## Authentication

Login establishes a session cookie that's saved to
`~/.config/forkable/session.json` (mode 600). Credentials can be supplied three ways:

- Interactive prompt: `forkable login`
- Flags: `forkable login --email you@co.com --password secret`
- Env vars: `FORKABLE_EMAIL` and `FORKABLE_PASSWORD` (preferred for agents/CI)

MFA: `forkable login --mfa 123456` if your account requires it.

Each user/agent can keep an isolated session by setting `FORKABLE_CONFIG_DIR`:

```bash
FORKABLE_CONFIG_DIR=~/.forkable-alice forkable whoami
```

## Commands

| Command | What it does |
|---|---|
| `init` | Install the Claude Code skill + print setup steps |
| `login` | Authenticate and save the session |
| `logout` | Clear the saved session |
| `whoami` | Show the current user + settings |
| `week` (alias `upcoming`) | Scheduled meals for a week (`--next`, `--week YYYY-MM-DD`) |
| `menu <deliveryId>` | Ranked menu options for a delivery (`--all` for full list) |
| `choose <deliveryId>` | Pick a meal: `--best`, or `--item <id> --menu <id>`. Add-ons via `--select '{"<modifierId>":[<optionId>]}'`; `--dry-run` to preview the priced configuration |
| `auto` | Auto-pick the best match for every changeable day (`--next`, `--dry-run`) |
| `prefs show` / `prefs set <field> <value>` | View / edit ordering preferences |
| `log <json>` / `decisions` | Append to / read the learning log (suggested → recommended → chosen) |

Add `--json` **before** the command for machine-readable output, e.g.
`forkable --json week --next`. Errors also print as JSON in that mode, and the process
exits non-zero on failure — so agents can branch on both the exit code and `ok:false`.

## Preferences

Stored at `~/.config/forkable/preferences.json`. The ranking blends **Forkable's own
per-item recommendation score** with your local signals:

```bash
forkable prefs set likes "chicken,salmon,bowl"
forkable prefs set dislikes "tofu,mushroom"
forkable prefs set avoid "peanut,shellfish"     # hard blocks (allergies)
forkable prefs set diet pescatarian             # omnivore|pescatarian|vegetarian|vegan|none
forkable prefs set maxPrice 18                   # skip anything pricier (none to disable)
forkable prefs set maxTotal 30                    # never place an order over this (none to disable)
forkable prefs set forkableScoreWeight 0.6       # 0..1: trust in Forkable's score vs. your keywords
```

`maxPrice` and `maxTotal` are different guards and both are useful:

| | `maxPrice` | `maxTotal` |
|---|---|---|
| Checks | an item's **base** price | the **real total**, base + add-on surcharges |
| When | while ranking candidates | at order time |
| Effect | the item stops being eligible | the order is **refused** |

`maxPrice` shapes what gets suggested. `maxTotal` is a hard ceiling that stops a bad order
landing, which is what makes it safe for an unattended agent to act. A $27 item with a $4
required side is a $31 order, and only `maxTotal` sees that. Override for one run with
`--max-total <n>`, or `--max-total none` to ignore the saved ceiling.

## Undoing a swap

Any order that replaces an existing meal records what it displaced, so it can be put back
exactly — same item, same add-ons, same special instructions:

```bash
forkable undo-log                    # swaps that can still be reverted
forkable revert 1236409              # put one day back
forkable revert 1236409 --dry-run    # preview it first
forkable revert --next               # revert every day next week that has a record
```

Only works while the day is still changeable. Forkable locks a day before delivery and
exposes no cutoff timestamp, so revert early rather than counting on a deadline.

Scoring model (see `src/prefs.js`):
`score = w·forkableScore + (1−w)·(keywordScore + 0.5·rating)`, where items failing your
diet / avoid / price constraints are marked ineligible and never auto-selected.

## Agent usage example

```bash
export FORKABLE_EMAIL=... FORKABLE_PASSWORD=...
forkable login --json >/dev/null
# Order the whole of next week according to saved prefs, capturing the plan:
forkable --json auto --next | jq '.results'
```

## How it works

See [`notes/api-spec.md`](notes/api-spec.md) for the full reverse-engineered API contract.
In short:

- Auth is a cookie-based session (`_easyorder_session`, HttpOnly) plus a CSRF token from
  `GET /api/v2/csrf_token` sent back as `X-CSRF-Token`, with a `Forkable-Referrer: mc` header.
- Reads/writes go to `POST /api/v2/graphql`. Key operations: `me`, `myDeliveries(from:)`,
  `menus(ids, clubId)`, `mealGenerationScores(...)`, and the `replacePiece` mutation to
  choose a meal. Login is the `createSession` mutation.

## Layout

```
bin/forkable.js     CLI entry (commander)
src/client.js       API client: CSRF, login, cookie jar, GraphQL, mutations
src/queries.js      GraphQL operation strings
src/prefs.js        preference scoring + modifier-selection builder
src/util.js         dates, formatting, menu flattening, change-eligibility
src/config.js       session + preferences persistence
src/prompt.js       interactive (hidden) prompts
notes/api-spec.md   reverse-engineered API documentation
```

## Troubleshooting

- **`Not authenticated`** — run `forkable login` again; sessions expire.
- **Login fails but credentials are right** — the account may use SSO (no password login),
  or require MFA (`--mfa`). The CLI auto-retries login against the public GraphQL endpoint.
- **`This delivery can no longer be changed`** — you're past the ordering cutoff for that day.
