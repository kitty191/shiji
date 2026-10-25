import test from 'node:test';
import assert from 'node:assert/strict';
import { MockCart } from '../src/mocks/cart.ts';
import { CartStore } from '../src/stores/cart.ts';
import { productDetails } from '../src/mocks/product.ts';

function fixture() {
  let snapshot = null, fail = false, writes = 0, seq = 0;
  const options = { catalog: () => productDetails, load: () => { if (fail) throw Error('read failed'); return snapshot; },
    save: data => { writes++; snapshot = data; }, id: () => `row-${++seq}` };
  const engine = new MockCart(options);
  return { engine, options, fail: value => { fail = value; }, snapshot: () => snapshot, writes: () => writes };
}
const lamp = { sku_id: 'lamp_white-usb', quantity: 1 };
const unavailable = error => error.code === 'SERVICE_UNAVAILABLE';

test('construction performs no storage IO; unreadable initial storage is an error rather than an empty cart', () => {
  const f = fixture(); f.fail(true); const engine = new MockCart(f.options);
  assert.throws(() => engine.read(), unavailable); assert.equal(f.writes(), 0);
  f.fail(false); assert.equal(engine.read().item_count, 0);
});

test('a failed fresh read cannot overwrite another page; the same uncommitted key succeeds after recovery', () => {
  const f = fixture(); f.engine.add(lamp, 'lamp');
  new MockCart(f.options).add({ sku_id: 'keyboard_ivory', quantity: 1 }, 'keyboard');
  const saved = f.snapshot(); f.fail(true);
  assert.throws(() => f.engine.read(), unavailable);
  assert.throws(() => f.engine.add(lamp, 'retry'), unavailable);
  assert.equal(f.snapshot(), saved); assert.equal(f.writes(), 2);
  f.fail(false); f.engine.add(lamp, 'retry');
  assert.equal(f.engine.read().item_count, 2); assert.equal(f.engine.read().quantity_total, 3);
});

test('fresh update, delete and restore all stop before writing on read failure', () => {
  const f = fixture(); const row = f.engine.add(lamp, 'lamp');
  const deletion = f.engine.remove([row.item_id], 'delete'); f.engine.add(lamp, 'readd');
  const current = f.engine.read().groups[0].items[0], saved = f.snapshot(), writes = f.writes(); f.fail(true);
  for (const operation of [() => f.engine.update(current.item_id, { quantity: 2, expected_quantity: 1 }, 'update'),
    () => f.engine.remove([current.item_id], 'remove'), () => f.engine.restore(deletion.restore_token, 'restore')]) assert.throws(operation, unavailable);
  assert.equal(f.snapshot(), saved); assert.equal(f.writes(), writes);
  f.fail(false); f.engine.restore(deletion.restore_token, 'restore'); assert.equal(f.engine.read().quantity_total, 2);
});

test('confirmed receipts remain recoverable without fresh IO and never apply twice', () => {
  const f = fixture(); const row = f.engine.add(lamp, 'lamp'); const deletion = f.engine.remove([row.item_id], 'delete');
  f.engine.restore(deletion.restore_token, 'restore'); const writes = f.writes(); f.fail(true);
  assert.equal(f.engine.add(lamp, 'lamp').item_id, row.item_id);
  assert.deepEqual(f.engine.remove([row.item_id], 'delete'), deletion);
  assert.equal(f.engine.restore(deletion.restore_token, 'restore').items[0].quantity, 1);
  assert.equal(f.writes(), writes);
});

test('shared store exposes failed reads, retains confirmed view, and recovers the latest cart', async () => {
  const f = fixture(); f.engine.add(lamp, 'lamp');
  const store = new CartStore({ read: async () => f.engine.read(), add: async (body, key) => f.engine.add(body, key) });
  await store.load(); f.fail(true); const saved = f.snapshot();
  await assert.rejects(store.add(lamp), unavailable);
  assert.equal(store.getSnapshot().status, 'error'); assert.equal(store.getSnapshot().view.quantity_total, 1);
  assert.equal(store.getSnapshot().retryPending, false); assert.equal(f.snapshot(), saved);
  f.fail(false); await store.retry(); assert.equal(store.getSnapshot().status, 'ready');
  await store.add(lamp); assert.equal(store.getSnapshot().view.quantity_total, 2);
});
