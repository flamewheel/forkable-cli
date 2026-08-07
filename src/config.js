import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync, appendFileSync, existsSync, chmodSync } from 'node:fs';

// Config dir is overridable so multiple users/agents can keep isolated sessions on one machine.
// e.g. FORKABLE_CONFIG_DIR=/tmp/agent-alice forkable whoami
export function configDir() {
  if (process.env.FORKABLE_CONFIG_DIR) return process.env.FORKABLE_CONFIG_DIR;
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
  return join(base, 'forkable');
}

function ensureDir() {
  const dir = configDir();
  mkdirSync(dir, { recursive: true });
  return dir;
}

const SESSION_FILE = () => join(configDir(), 'session.json');
const PREFS_FILE = () => join(configDir(), 'preferences.json');

export function loadSession() {
  const f = SESSION_FILE();
  if (!existsSync(f)) return null;
  try {
    return JSON.parse(readFileSync(f, 'utf8'));
  } catch {
    return null;
  }
}

export function saveSession(session) {
  ensureDir();
  const f = SESSION_FILE();
  writeFileSync(f, JSON.stringify(session, null, 2));
  // Session holds auth cookies — keep it private.
  try { chmodSync(f, 0o600); } catch { /* best effort on non-posix */ }
}

export function clearSession() {
  const f = SESSION_FILE();
  if (existsSync(f)) writeFileSync(f, JSON.stringify({}, null, 2));
}

const DEFAULT_PREFS = {
  // Free-text likes/dislikes matched against item name + description + ingredients.
  likes: [],
  dislikes: [],
  // Ingredient tags / keywords that are hard blocks (allergies etc).
  avoid: [],
  // "omnivore" | "pescatarian" | "vegetarian" | "vegan" | null
  diet: null,
  // Skip items priced above this (in dollars). null = no cap. This is a RANKING filter on an
  // item's BASE price: over it, the item stops being an eligible candidate at all.
  maxPrice: null,
  // Hard ceiling on the REAL total of an order (base + add-on surcharges), in dollars.
  // null = no ceiling. Deliberately separate from `maxPrice`: this one does not filter
  // candidates, it refuses to place an order that costs more than this, which is what makes it
  // safe for an unattended agent to act on. A soft "aim for about $X" belongs in `notes`.
  maxTotal: null,
  // How much to trust Forkable's own meal-generation score vs. local keyword matching (0..1).
  forkableScoreWeight: 0.6,
  // Free-text, open-ended preferences an AI agent interprets at order time (e.g. "lighter
  // lunches", "more protein this week", "don't repeat a cuisine"). The deterministic scorer
  // ignores these; they're for the agent layer. See the `forkable` Claude Code skill.
  notes: []
};

export function loadPrefs() {
  const f = PREFS_FILE();
  if (!existsSync(f)) return { ...DEFAULT_PREFS };
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(readFileSync(f, 'utf8')) };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(prefs) {
  ensureDir();
  writeFileSync(PREFS_FILE(), JSON.stringify(prefs, null, 2));
}

// Append-only learning log: one decision per line (JSONL). Each record captures what Forkable
// suggested, what the agent recommended, and what the user actually chose (and why). Over time
// this is what surfaces recurring overrides so they can be promoted into real preferences.
const DECISIONS_FILE = () => join(configDir(), 'decisions.jsonl');

export function appendDecision(record) {
  ensureDir();
  const line = JSON.stringify({ loggedAt: new Date().toISOString(), ...record });
  appendFileSync(DECISIONS_FILE(), line + '\n');
}

export function loadDecisions(limit) {
  const f = DECISIONS_FILE();
  if (!existsSync(f)) return [];
  const recs = readFileSync(f, 'utf8').split('\n').filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
  return typeof limit === 'number' && limit > 0 ? recs.slice(-limit) : recs;
}

// Append-only undo log. Every order that REPLACES an existing meal records the meal it displaced,
// in enough detail to put it back exactly: item, menu, the add-on `selections` and the special
// instructions. Reversibility is the safety property that makes acting without a human present
// defensible, and "you can change it back in the web app" is a claim rather than a command.
//
// Newest-last, like decisions.jsonl. Reverting appends nothing, so a revert is not itself
// undoable via this log - that is deliberate, since the alternative is a loop.
const UNDO_FILE = () => join(configDir(), 'undo.jsonl');

export function appendUndo(record) {
  ensureDir();
  const line = JSON.stringify({ savedAt: new Date().toISOString(), ...record });
  appendFileSync(UNDO_FILE(), line + '\n');
}

export function loadUndoLog(limit) {
  const f = UNDO_FILE();
  if (!existsSync(f)) return [];
  const recs = readFileSync(f, 'utf8').split('\n').filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
  return typeof limit === 'number' && limit > 0 ? recs.slice(-limit) : recs;
}

// Most recent undo record for one delivery, or null. Most recent wins because a day can be
// swapped more than once; reverting should step back to the meal that was there before the
// LAST change, not before the first.
export function latestUndoFor(deliveryId) {
  const id = Number(deliveryId);
  const recs = loadUndoLog();
  for (let i = recs.length - 1; i >= 0; i--) {
    if (Number(recs[i].deliveryId) === id) return recs[i];
  }
  return null;
}

export { DEFAULT_PREFS };
