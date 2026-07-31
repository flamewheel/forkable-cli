// Small shared helpers: dates, output, menu flattening.

// Forkable weeks are keyed by a Monday (the dashboard route /mc/<YYYY-MM-DD>).
export function mondayOf(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun..6=Sat
  const diff = (day === 0 ? -6 : 1 - day); // back to Monday
  d.setDate(d.getDate() + diff);
  return ymd(d);
}

export function nextMonday(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? 1 : 8 - day;
  d.setDate(d.getDate() + diff);
  return ymd(d);
}

export function ymd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function fmtDay(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

// Whether a delivery's meal can still be freely chosen/replaced.
// NB: `canRequestChanges` is a *different* signal — it governs the post-cutoff
// "change request" flow, not initial selection. In the normal pre-order window a
// delivery sits in state "initial" with canRequestChanges=false yet is fully editable.
export function isChangeable(d) {
  return !d.isReadOnly && !d.pastLateOrderDeadline;
}

// The current piece belonging to the logged-in user within a delivery.
export function userPiece(delivery, userId) {
  for (const order of delivery.orders || []) {
    for (const piece of order.pieces || []) {
      if (piece.userId === userId) return piece;
    }
  }
  // Fall back to the first piece if userId scoping finds nothing (single-user delivery).
  return delivery.orders?.[0]?.pieces?.[0] || null;
}

// Compact view of an item's add-on / customization decisions. `required` groups must be
// answered before the item can be ordered; the rest are genuinely optional. Option prices
// are surcharges (0 = included), so a caller can price out a configuration before ordering.
export function modifierView(item) {
  return (item.modifiers || []).map(m => ({
    id: m.id,
    name: m.name,
    required: Boolean(m.required || (m.min != null && m.min >= 1)),
    min: m.min ?? null,
    max: m.max ?? null,
    free: m.free ?? null,
    options: (m.options || []).map(o => ({ id: o.id, name: o.name, price: o.price ?? 0 }))
  }));
}

// Full agent-facing view of a menu item.
//
// An item's NAME is not enough to reason about food, and guessing from it produces confident
// errors: "Chicken Goddess" is a panko-crusted (fried) chicken sandwich, and "Lemongrass
// Chicken Bun/Com" is Vietnamese bun/com (vermicelli/rice), not a bread bun. So description,
// ingredientTags and imageUrl always ride along - callers that reason about suitability need
// them, and dropping them was silently forcing every agent to guess.
export function itemView(item) {
  return {
    itemId: item.id,
    menuId: item.menuId,
    name: item.name,
    venue: item.venue,
    section: item.section ?? null,
    price: item.price,
    description: item.description ?? null,
    imageUrl: item.imageUrl ?? null,
    ingredientTags: item.ingredientTags || [],
    dietLevel: item.dietLevel ?? null,
    averageRating: item.averageRating ?? null,
    modifiers: modifierView(item)
  };
}

// Flatten menus -> array of items, each annotated with venue + menuId.
export function flattenMenuItems(menus) {
  const items = [];
  for (const menu of menus || []) {
    const venue = menu.venue?.displayName || menu.venue?.name || menu.displayName || menu.name;
    for (const section of menu.sections || []) {
      for (const item of section.items || []) {
        items.push({ ...item, menuId: item.menuId ?? menu.id, venue, section: section.name });
      }
    }
  }
  return items;
}

export function money(n, hide = false) {
  if (hide) return '';
  if (n == null) return '';
  return `$${Number(n).toFixed(2)}`;
}

export function out(json, humanFn, asJson) {
  if (asJson) {
    process.stdout.write(JSON.stringify(json, null, 2) + '\n');
  } else {
    humanFn();
  }
}

export function die(err, asJson) {
  const message = err?.message || String(err);
  if (asJson) {
    process.stdout.write(JSON.stringify({ ok: false, error: message, details: err?.details ?? null }, null, 2) + '\n');
  } else {
    process.stderr.write(`\x1b[31merror:\x1b[0m ${message}\n`);
    if (err?.details) process.stderr.write(JSON.stringify(err.details, null, 2) + '\n');
  }
  process.exit(1);
}
