// Preference engine: turn a user's stated preferences + Forkable's own meal-generation
// scores into a single ranking over the available menu items for a given day.
//
// This is the DETERMINISTIC layer: diet, avoid, likes/dislikes keywords, price cap. The
// free-text `prefs.notes` (open-ended things like "lighter" or "more variety") are NOT used
// here — they're interpreted by the agent layer (see the `forkable` Claude Code skill), which
// picks among the eligible candidates this ranking produces.

const DIET_RANK = { omnivore: 0, pescatarian: 1, vegetarian: 2, vegan: 3 };

function itemText(item) {
  return [
    item.name,
    item.description,
    ...(item.ingredientTags || [])
  ].filter(Boolean).join(' ').toLowerCase();
}

// Does the item satisfy a diet constraint? Forkable tags items with a `dietLevel`
// where higher = stricter (vegan). A vegetarian can eat vegetarian+vegan, etc.
export function meetsDiet(item, diet) {
  if (!diet) return true;
  const want = DIET_RANK[diet];
  if (want == null) return true;
  const lvl = item.dietLevel;
  if (lvl == null) return want === 0; // untagged only ok for omnivore
  return lvl >= want;
}

// Resolve the hard spend ceiling for a run: an explicit --max-total flag wins, otherwise the saved
// `maxTotal` pref. "none" / "off" / 0 removes it for that run only, which keeps the escape hatch
// visible in the command line instead of buried in a config file.
export function resolveCeiling(flag, prefs = {}) {
  if (flag === undefined || flag === null) return prefs.maxTotal ?? null;
  const s = String(flag).trim().toLowerCase();
  if (s === 'none' || s === 'off' || s === '0') return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error('--max-total must be a non-negative number, or "none".');
  }
  return n;
}

// Hard ceiling check against the REAL total of a configured order (base + add-on surcharges).
//
// Distinct from `prefs.maxPrice`, which filters candidates during ranking on their base price.
// This runs at order time on the priced-out total, because that is the number actually charged:
// a $19 item with a $4 required side is a $23 order, and a ceiling that only looked at the item
// would wave it through.
//
// Returns { ok, ceiling, total, reason }. `ok: true` when there is no ceiling, when the total is
// unknown, or when the total is at or under it. Being at the ceiling exactly is allowed.
export function checkCeiling(total, ceiling) {
  if (ceiling == null) return { ok: true, ceiling: null, total: total ?? null, reason: null };
  const limit = Number(ceiling);
  if (!Number.isFinite(limit)) return { ok: true, ceiling: null, total: total ?? null, reason: null };
  if (total == null || !Number.isFinite(Number(total))) {
    // No priced total to check (e.g. a club that hides prices). Refusing here would block
    // ordering entirely for those users, so allow it and let the caller surface the unknown.
    return { ok: true, ceiling: limit, total: null, reason: null };
  }
  const t = Number(total);
  if (t <= limit) return { ok: true, ceiling: limit, total: t, reason: null };
  return {
    ok: false, ceiling: limit, total: t,
    reason: `total $${t.toFixed(2)} is over the $${limit.toFixed(2)} ceiling`
  };
}

export function hasAvoided(item, avoid) {
  if (!avoid || !avoid.length) return false;
  const text = itemText(item);
  return avoid.some(a => text.includes(String(a).toLowerCase()));
}

function keywordScore(item, prefs) {
  const text = itemText(item);
  let s = 0;
  for (const like of prefs.likes || []) if (text.includes(String(like).toLowerCase())) s += 1;
  for (const dis of prefs.dislikes || []) if (text.includes(String(dis).toLowerCase())) s -= 1.5;
  return s;
}

// Returns { item, score, breakdown, eligible, reason } for one item.
export function scoreItem(item, prefs, forkableScore) {
  const eligible = meetsDiet(item, prefs.diet) && !hasAvoided(item, prefs.avoid) &&
    (prefs.maxPrice == null || item.price == null || item.price <= prefs.maxPrice);

  let reason = null;
  if (!meetsDiet(item, prefs.diet)) reason = `fails diet (${prefs.diet})`;
  else if (hasAvoided(item, prefs.avoid)) reason = 'contains avoided ingredient';
  else if (prefs.maxPrice != null && item.price != null && item.price > prefs.maxPrice) reason = `over $${prefs.maxPrice}`;

  const kw = keywordScore(item, prefs);
  // `forkableScore` here is expected already-normalized to ~0..1 (rankItems does that per
  // day). Forkable's raw meal-generation scores are unbounded and ~3x the magnitude of the
  // keyword signal, so without normalization they'd swamp the user's likes/dislikes.
  const fk = typeof forkableScore === 'number' ? forkableScore : 0;
  const w = Math.min(1, Math.max(0, prefs.forkableScoreWeight ?? 0.6));
  // Blend: Forkable's recommendation (weighted) + local keyword signal + a nudge from rating.
  const rating = typeof item.averageRating === 'number' ? item.averageRating / 5 : 0;
  const score = w * fk + (1 - w) * (kw + 0.5 * rating);

  return { item, score, eligible, reason, breakdown: { forkable: fk, keyword: kw, rating } };
}

// Rank all items. `scoresByKey` maps `${menuId}:${itemId}` -> Forkable's raw meal-generation
// score. Those raw scores are normalized to 0..1 across this item set before blending, so the
// user's keyword prefs aren't swamped by Forkable's larger-magnitude score.
export function rankItems(items, prefs, scoresByKey = {}) {
  const rawFor = it => {
    const v = scoresByKey[`${it.menuId}:${it.id}`];
    return typeof v === 'number' ? v : 0;
  };
  const maxFk = Math.max(0, ...items.map(rawFor));
  return items
    .map(it => scoreItem(it, prefs, maxFk > 0 ? rawFor(it) / maxFk : 0))
    .sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.score - a.score);
}

export function pickBest(items, prefs, scoresByKey = {}) {
  const ranked = rankItems(items, prefs, scoresByKey);
  return ranked.find(r => r.eligible) || null;
}

// ---- modifier / add-on selection -------------------------------------------

export function isRequiredModifier(mod) {
  return Boolean(mod.required || (mod.min != null && mod.min >= 1));
}

function optionScore(option, prefs) {
  const text = String(option.name || '').toLowerCase();
  let s = 0;
  for (const like of prefs.likes || []) if (text.includes(String(like).toLowerCase())) s += 1;
  for (const dis of prefs.dislikes || []) if (text.includes(String(dis).toLowerCase())) s -= 1.5;
  return s;
}

// Pick an option for a required group. Treats `avoid` as a hard block, then prefers likes over
// dislikes, and only falls back to price as a tiebreak.
//
// The old behaviour was cheapest-wins, which silently discarded real choices: with two $0
// options ("House Salad" and "No Side") it took whichever happened to sort first, so ordering
// through this CLI could quietly drop a side the user was already getting.
export function defaultOptionFor(mod, prefs = {}) {
  const avoid = prefs.avoid || [];
  const isAvoided = o => avoid.some(a => String(o.name || '').toLowerCase().includes(String(a).toLowerCase()));
  const allowed = (mod.options || []).filter(o => !isAvoided(o));
  const pool = allowed.length ? allowed : (mod.options || []);
  if (!pool.length) return null;
  return [...pool].sort((a, b) =>
    optionScore(b, prefs) - optionScore(a, prefs) || (a.price || 0) - (b.price || 0)
  )[0];
}

// Build a selectionsHash that satisfies an item's required modifiers, skipping optional
// groups with `-1`. Kept for callers that want a no-judgment default (e.g. `auto`).
export function buildDefaultSelections(item, prefs = {}) {
  const sel = {};
  for (const mod of item.modifiers || []) {
    if (isRequiredModifier(mod)) {
      const pick = defaultOptionFor(mod, prefs);
      sel[mod.id] = pick ? [pick.id] : [-1];
    } else {
      sel[mod.id] = [-1];
    }
  }
  return sel;
}

// Merge an explicit `{modifierId: [optionId, ...]}` request with the item's modifier groups.
// Explicit choices win; groups the caller left out fall back to the preference-aware default.
//
// Returns the priced-out configuration and any problems found, so a caller can refuse to order
// a bad selection rather than quietly sending something Forkable rejects. `needsChoice` lists
// required groups with a real decision still open - the hook for asking the user rather than
// guessing on their behalf.
export function resolveSelections(item, requested = null, prefs = {}) {
  const groups = item.modifiers || [];
  const req = requested || {};
  const known = new Set(groups.map(m => String(m.id)));
  const issues = [];
  for (const key of Object.keys(req)) {
    if (!known.has(String(key))) issues.push(`unknown modifier group ${key} for "${item.name}"`);
  }

  const selectionsHash = {};
  const chosen = [];
  const needsChoice = [];

  for (const mod of groups) {
    const raw = req[String(mod.id)] ?? req[mod.id];
    const explicit = raw != null;
    const ids = explicit ? (Array.isArray(raw) ? raw : [raw]).map(Number) : null;
    const required = isRequiredModifier(mod);

    if (ids) {
      const real = ids.filter(id => id !== -1);
      for (const id of real) {
        if (!(mod.options || []).some(o => o.id === id)) issues.push(`option ${id} is not valid for "${mod.name}"`);
      }
      if (mod.max != null && real.length > mod.max) issues.push(`"${mod.name}" takes at most ${mod.max} option(s)`);
      if (required && !real.length) issues.push(`"${mod.name}" is required but was skipped`);
      selectionsHash[mod.id] = real.length ? real : [-1];
      for (const id of real) {
        const opt = (mod.options || []).find(o => o.id === id);
        if (opt) chosen.push({ modifierId: mod.id, modifier: mod.name, optionId: opt.id, option: opt.name, price: opt.price || 0 });
      }
    } else if (required) {
      const pick = defaultOptionFor(mod, prefs);
      selectionsHash[mod.id] = pick ? [pick.id] : [-1];
      if (pick) {
        chosen.push({ modifierId: mod.id, modifier: mod.name, optionId: pick.id, option: pick.name, price: pick.price || 0, auto: true });
      }
      if ((mod.options || []).length > 1) {
        needsChoice.push({ modifierId: mod.id, modifier: mod.name, autoPicked: pick ? pick.name : null,
          options: (mod.options || []).map(o => ({ optionId: o.id, name: o.name, price: o.price || 0 })) });
      }
    } else {
      selectionsHash[mod.id] = [-1];
    }
  }

  const base = item.price || 0;
  const surcharge = chosen.reduce((n, c) => n + (c.price || 0), 0);
  const pricing = {
    base: Number(base.toFixed(2)),
    surcharge: Number(surcharge.toFixed(2)),
    total: Number((base + surcharge).toFixed(2))
  };

  return { selectionsHash, chosen, pricing, issues, needsChoice };
}
