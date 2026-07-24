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
