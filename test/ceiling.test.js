// Ceiling guard: the check that makes it safe for an unattended run to spend money.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkCeiling, scoreItem, resolveCeiling } from '../src/prefs.js';

test('no ceiling set means anything passes', () => {
  assert.equal(checkCeiling(999, null).ok, true);
  assert.equal(checkCeiling(999, undefined).ok, true);
});

test('under and exactly at the ceiling both pass', () => {
  assert.equal(checkCeiling(29.99, 30).ok, true);
  assert.equal(checkCeiling(30, 30).ok, true, 'at the ceiling is allowed, not over');
});

test('over the ceiling fails and says by how much', () => {
  const r = checkCeiling(30.01, 30);
  assert.equal(r.ok, false);
  assert.equal(r.total, 30.01);
  assert.equal(r.ceiling, 30);
  assert.match(r.reason, /30\.01.*30\.00/);
});

test('the ceiling applies to the real total, not the base price', () => {
  // A $27 item with a $4 required side is a $31 order. Checking the item price alone would
  // wave this through, which is the exact bug the separate ceiling exists to prevent.
  const base = 27, surcharge = 4;
  assert.equal(checkCeiling(base, 30).ok, true, 'base price alone looks fine');
  assert.equal(checkCeiling(base + surcharge, 30).ok, false, 'real total is over and must refuse');
});

test('an unknown total does not block ordering', () => {
  // Some clubs hide prices, so there is no total to check. Refusing would lock those users out.
  assert.equal(checkCeiling(null, 30).ok, true);
  assert.equal(checkCeiling(undefined, 30).ok, true);
  assert.equal(checkCeiling(null, 30).total, null);
});

test('a nonsense ceiling is ignored rather than blocking everything', () => {
  assert.equal(checkCeiling(50, NaN).ok, true);
  assert.equal(checkCeiling(50, 'abc').ok, true);
});

test('the saved ceiling applies when no flag is passed', () => {
  assert.equal(resolveCeiling(undefined, { maxTotal: 30 }), 30);
  assert.equal(resolveCeiling(undefined, { maxTotal: null }), null);
  assert.equal(resolveCeiling(undefined, {}), null);
});

test('an explicit flag overrides the saved ceiling', () => {
  assert.equal(resolveCeiling('45', { maxTotal: 30 }), 45);
  assert.equal(resolveCeiling(45, { maxTotal: 30 }), 45);
});

test('"none" disables the ceiling for one run without touching the saved pref', () => {
  const prefs = { maxTotal: 30 };
  assert.equal(resolveCeiling('none', prefs), null);
  assert.equal(resolveCeiling('NONE', prefs), null);
  assert.equal(resolveCeiling('off', prefs), null);
  assert.equal(resolveCeiling('0', prefs), null);
  assert.equal(prefs.maxTotal, 30, 'the saved pref is left alone');
});

test('a garbage ceiling flag is rejected loudly rather than silently ignored', () => {
  // Silently treating --max-total=abc as "no ceiling" would remove the guard exactly when
  // someone thought they were setting it.
  assert.throws(() => resolveCeiling('abc', {}), /non-negative number/);
  assert.throws(() => resolveCeiling('-5', {}), /non-negative number/);
});

test('maxTotal and maxPrice are independent guards', () => {
  // maxPrice filters candidates during ranking; maxTotal refuses at order time. Setting one
  // must not silently do the other's job.
  const item = { id: 1, menuId: 2, name: 'Pricey Bowl', price: 25, description: '', ingredientTags: [] };
  const ranked = scoreItem(item, { maxPrice: null, maxTotal: 10, avoid: [], likes: [], dislikes: [] }, 0);
  assert.equal(ranked.eligible, true, 'maxTotal must not affect ranking eligibility');

  const filtered = scoreItem(item, { maxPrice: 10, maxTotal: null, avoid: [], likes: [], dislikes: [] }, 0);
  assert.equal(filtered.eligible, false, 'maxPrice still filters on base price');
  assert.match(filtered.reason, /over \$10/);
});
