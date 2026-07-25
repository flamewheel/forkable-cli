# forkable-cli — Quickstart

Order your Forkable lunch from the terminal, or by just asking your AI agent.

## 1. Install

Needs Node 20+ (`node --version` to check). Then:

```bash
npm install -g forkable-cli
```

## 2. Log in

```bash
forkable login
```

Enter your own Forkable email + password. The session is saved locally (`~/.config/forkable/`) and your credentials never leave your machine.

> If your organization signs into Forkable via SSO / Okta, password login won't work — use Forkable's web app instead.

## 3. Set your tastes (once)

```bash
forkable prefs set diet pescatarian        # omnivore | pescatarian | vegetarian | vegan | none
forkable prefs set likes "salmon,chicken,bowl"
forkable prefs set dislikes "tofu,beets"
forkable prefs set avoid "peanut"           # allergies / hard blocks
forkable prefs set maxPrice 20
```

## 4. Order

Preview first, then commit:

```bash
forkable auto --next --dry-run     # shows next week's plan, orders nothing
forkable auto --next               # places it
```

See what's booked with `forkable week --next`. Browse one day's options with `forkable menu <deliveryId>`.

## Even easier: just ask Claude Code

If you use Claude Code, install the skill and skip the commands:

```bash
mkdir -p ~/.claude/skills/forkable && \
  curl -fsSL -o ~/.claude/skills/forkable/SKILL.md \
  https://raw.githubusercontent.com/flamewheel/forkable-cli/main/claude-skill/forkable/SKILL.md
```

Then just say: **"set my Forkable prefs to pescatarian, no tofu, and auto-order next week."** Claude runs the CLI, shows you the plan, and confirms before it orders anything.

## Prefer a UI, or not into terminals?

Forkable's own web app auto-orders from your saved preferences with zero setup. This tool is for *steering* that — custom picks, bulk changes, and letting an agent do it for you.
