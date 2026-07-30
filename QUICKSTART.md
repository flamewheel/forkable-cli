# forkable-cli — Quickstart

Order your Forkable lunch by chatting with Claude Code, or straight from the terminal.

## Setup (about a minute)

Needs Node 20+ (`node --version`). Then:

```bash
npm install -g forkable-cli
forkable init          # installs the Claude Code skill + prints next steps
forkable login         # your own Forkable email + password (run in a real terminal)
```

`forkable login` saves your session locally (`~/.config/forkable/`) and your credentials never leave your machine. If your org signs into Forkable via SSO / Okta, password login won't work - use Forkable's web app instead.

After `forkable init`, restart Claude Code so it picks up the skill.

## Use it: just talk to Claude Code

Once the skill's installed, say things like:

- "set my Forkable prefs to pescatarian, no tofu, under $20"
- "what's for lunch next week?"
- "order me next week, keep it light"

Claude runs the CLI, shows you a plan, and confirms before it orders anything. You can also give it open-ended preferences it can't get from flags - *"lighter on meeting-heavy days," "more protein this week," "don't repeat a cuisine."* It saves those and applies judgment when it picks your meals.

## Or drive it by hand

```bash
forkable prefs set diet pescatarian     # omnivore | pescatarian | vegetarian | vegan | none
forkable prefs set likes "salmon,bowl,greens"
forkable prefs set dislikes "fried,bone-in"
forkable prefs set avoid "peanut"        # allergies / hard blocks
forkable prefs set maxPrice 20

forkable week --next                     # see next week's meals
forkable menu <deliveryId>               # browse a day, ranked by your prefs
forkable auto --next --dry-run           # preview a full-week plan (orders nothing)
forkable auto --next                     # place it
```

## Prefer a UI, or not into terminals?

Forkable's own web app auto-orders from your saved preferences with zero setup. This tool is for *steering* that - custom picks, bulk changes, and letting an agent do it for you.
