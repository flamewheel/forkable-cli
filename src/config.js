import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';

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
  // Skip items priced above this (in dollars). null = no cap.
  maxPrice: null,
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

export { DEFAULT_PREFS };
