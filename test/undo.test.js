// Undo log: reversibility is the property that makes acting without a human present defensible,
// so these tests care most about whether a restore would be EXACT rather than approximate.
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The config dir is env-overridable, which is what makes this testable without mocks.
const dir = mkdtempSync(join(tmpdir(), 'forkable-test-'));
process.env.FORKABLE_CONFIG_DIR = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { appendUndo, loadUndoLog, latestUndoFor } = await import('../src/config.js');

const record = (deliveryId, name, over = {}) => ({
  deliveryId,
  day: '2026-08-11T12:01:00.000Z',
  replaced: {
    pieceId: 'piece-' + name, itemId: 53, menuId: 13597, name,
    price: 17.95, selections: { '12': [9], '15': [-1] }, instructions: 'no onions'
  },
  orderedInstead: { itemId: 7, menuId: 17263, name: 'Salmon Bowl', total: 19.3 },
  ...over
});

beforeEach(() => rmSync(join(dir, 'undo.jsonl'), { force: true }));

test('an empty log reads as empty, not as a crash', () => {
  assert.deepEqual(loadUndoLog(), []);
  assert.equal(latestUndoFor(1236409), null);
});

test('a record round-trips with the detail needed for an exact restore', () => {
  appendUndo(record(1236409, 'Carne Asada Bowl'));
  const rec = latestUndoFor(1236409);
  assert.ok(rec);
  // Item and menu alone are not enough: the add-ons and instructions are part of the order.
  assert.equal(rec.replaced.itemId, 53);
  assert.equal(rec.replaced.menuId, 13597);
  assert.deepEqual(rec.replaced.selections, { '12': [9], '15': [-1] });
  assert.equal(rec.replaced.instructions, 'no onions');
  assert.ok(rec.savedAt, 'every record is stamped');
});

test('reverting a twice-swapped day steps back one change, not all the way', () => {
  appendUndo(record(1236409, 'Original Pick'));
  appendUndo(record(1236409, 'Second Pick'));
  assert.equal(latestUndoFor(1236409).replaced.name, 'Second Pick');
});

test('records are scoped per delivery', () => {
  appendUndo(record(1236409, 'Tuesday Meal'));
  appendUndo(record(1236411, 'Wednesday Meal'));
  assert.equal(latestUndoFor(1236409).replaced.name, 'Tuesday Meal');
  assert.equal(latestUndoFor(1236411).replaced.name, 'Wednesday Meal');
  assert.equal(latestUndoFor(999999), null, 'an unknown delivery has nothing to revert');
});

test('a delivery id given as a string still matches', () => {
  appendUndo(record(1236409, 'Carne Asada Bowl'));
  assert.ok(latestUndoFor('1236409'), 'CLI args arrive as strings');
});

test('a corrupt line does not take the whole log down', () => {
  appendUndo(record(1236409, 'Good Record'));
  appendFileSync(join(dir, 'undo.jsonl'), 'not json at all\n');
  appendUndo(record(1236411, 'Later Record'));
  assert.equal(loadUndoLog().length, 2, 'the unparseable line is dropped, the rest survive');
  assert.equal(latestUndoFor(1236411).replaced.name, 'Later Record');
});

test('limit returns the most recent records', () => {
  appendUndo(record(1, 'a'));
  appendUndo(record(2, 'b'));
  appendUndo(record(3, 'c'));
  const recent = loadUndoLog(2);
  assert.equal(recent.length, 2);
  assert.equal(recent[0].replaced.name, 'b');
  assert.equal(recent[1].replaced.name, 'c');
});
