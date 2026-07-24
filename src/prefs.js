// Preference engine: turn a user's stated preferences + Forkable's own meal-generation
// scores into a single ranking over the available menu items for a given day.

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
  // Normalize Forkable's score (observed roughly 0..1-ish; guard anyway).
  const fk = typeof forkableScore === 'number' ? forkableScore : 0;
  const w = Math.min(1, Math.max(0, prefs.forkableScoreWeight ?? 0.6));
  // Blend: Forkable's recommendation (weighted) + local keyword signal + a nudge from rating.
  const rating = typeof item.averageRating === 'number' ? item.averageRating / 5 : 0;
  const score = w * fk + (1 - w) * (kw + 0.5 * rating);

  return { item, score, eligible, reason, breakdown: { forkable: fk, keyword: kw, rating } };
}

// Rank all items. `scoresByKey` maps `${menuId}:${itemId}` -> forkable score.
export function rankItems(items, prefs, scoresByKey = {}) {
  return items
    .map(it => scoreItem(it, prefs, scoresByKey[`${it.menuId}:${it.id}`]))
    .sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.score - a.score);
}

export function pickBest(items, prefs, scoresByKey = {}) {
  const ranked = rankItems(items, prefs, scoresByKey);
  return ranked.find(r => r.eligible) || null;
}

// Build a selectionsHash that satisfies an item's required modifiers.
// For each modifier group: pick the cheapest option if required (min>=1), else `-1` (skip).
export function buildDefaultSelections(item) {
  const sel = {};
  for (const mod of item.modifiers || []) {
    const required = mod.required || (mod.min && mod.min >= 1);
    if (required && mod.options?.length) {
      const cheapest = [...mod.options].sort((a, b) => (a.price || 0) - (b.price || 0))[0];
      sel[mod.id] = [cheapest.id];
    } else {
      sel[mod.id] = [-1];
    }
  }
  return sel;
}
