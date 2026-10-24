import test from 'node:test';
import assert from 'node:assert/strict';
import { MockCart } from '../src/mocks/cart.ts';
import { CartStore } from '../src/stores/cart.ts';
import { CartError, cartSubtotal, emptyCart } from '../src/lib/cart.ts';
import { productDetails } from '../src/mocks/product.ts';

function fixture() {
  const catalog = structuredClone(productDetails);
  let snapshot = null, sequence = 0;
  const options = { catalog: () => catalog, load: () => snapshot, save: value => { snapshot = value; }, id: () => `row-${++sequence}` };
  return { catalog, engine: new MockCart(options), options };
}
const request = (quantity = 1) => ({ sku_id: 'lamp_white-usb', quantity });
const first = engine => engine.read().groups[0].items[0];
const gatewayFor = engine => ({ read: async () => engine.read(), add: async (body, key) => engine.add(body, key) });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test('same SKU increments merge; distinct variants remain separate and charge actual SKU cents', () => {
  const { engine, catalog } = fixture();
  catalog.find(product => product.product_id === 'lamp').display_price = 100;
  engine.add(request(3), 'a'); engine.add(request(2), 'b');
  engine.add({ sku_id: 'lamp_white-battery', quantity: 1 }, 'c');
  engine.add({ sku_id: 'keyboard_ivory', quantity: 1 }, 'd');
  const view = engine.read();
  assert.equal(view.item_count, 3); assert.equal(view.quantity_total, 7); assert.equal(view.groups.length, 2);
  assert.equal(first(engine).quantity, 5); assert.equal(first(engine).unit_price, 5900);
  assert.equal(cartSubtotal(view), 50300);
});

test('final merged stock is checked atomically and sold-out, missing or malformed quantities cannot add', () => {
  const { engine } = fixture(); engine.add(request(7), 'first');
  assert.throws(() => engine.add(request(2), 'overflow'), error => error.code === 'INSUFFICIENT_STOCK');
  assert.equal(first(engine).quantity, 7);
  for (const sku_id of ['lamp_black-usb', 'retired']) assert.throws(() => engine.add({ sku_id, quantity: 1 }, sku_id), error => error.code === 'ITEM_NOT_PURCHASABLE');
  for (const quantity of [0, -1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => engine.add(request(quantity), 'invalid'));
  assert.equal(engine.read().item_count, 1);
});

test('idempotency replay does not increment and changed payload conflicts', () => {
  const { engine } = fixture(); const result = engine.add(request(2), 'key');
  result.quantity = 100;
  assert.equal(engine.add(request(2), 'key').quantity, 2);
  assert.equal(first(engine).quantity, 2);
  assert.throws(() => engine.add(request(3), 'key'), error => error.code === 'IDEMPOTENCY_CONFLICT');
});

test('valid demo cart survives reload; malformed or duplicate stored rows start empty', () => {
  const { engine, options } = fixture(); engine.add(request(2), 'a');
  assert.equal(first(new MockCart(options)).quantity, 2);
  for (const data of ['invalid json', '{"version":2,"items":[]}', JSON.stringify({ version: 1, items: [null] })]) {
    assert.equal(new MockCart({ ...options, load: () => data }).read().item_count, 0);
  }
  const persisted = JSON.parse(options.load()); persisted.items.push(persisted.items[0]);
  assert.equal(new MockCart({ ...options, load: () => JSON.stringify(persisted) }).read().item_count, 0);
});

test('live inventory, retired SKU, off-sale and unavailable products preserve original choice and navigation', () => {
  const { engine, catalog } = fixture(); engine.add(request(3), 'a');
  const index = catalog.findIndex(product => product.product_id === 'lamp'), product = catalog[index];
  product.skus[0].available_stock = 2;
  assert.equal(first(engine).purchase_status, 'INSUFFICIENT_STOCK'); assert.equal(cartSubtotal(engine.read()), 0);
  product.skus[0].available_stock = 0;
  assert.equal(first(engine).purchase_status, 'SOLD_OUT'); assert.equal(first(engine).navigation.type, 'PRODUCT');
  product.skus.shift();
  assert.equal(first(engine).purchase_status, 'SPEC_DISABLED'); assert.equal(first(engine).sku_id, 'lamp_white-usb');
  assert.equal(first(engine).navigation.type, 'STORE'); assert.equal(first(engine).image_disabled, true); assert.equal(first(engine).unit_price, null);
  catalog[index] = { product_id: product.product_id, store: product.store, view_status: 'OFF_SALE' };
  assert.equal(first(engine).purchase_status, 'PRODUCT_OFF_SALE'); assert.equal(first(engine).navigation.type, 'OFF_SALE_PRODUCT');
  catalog.splice(index, 1);
  assert.equal(first(engine).purchase_status, 'NOT_AVAILABLE'); assert.equal(first(engine).navigation.type, 'NONE');
});

test('storage failure leaves data untouched and retry with the same key can succeed once', () => {
  const { options } = fixture(); let fail = true;
  const engine = new MockCart({ ...options, save: value => { if (fail) throw Error('quota'); options.save(value); } });
  assert.throws(() => engine.add(request(), 'a'), error => error.code === 'SERVICE_UNAVAILABLE');
  assert.equal(engine.read().item_count, 0); fail = false;
  engine.add(request(), 'a'); assert.equal(first(engine).quantity, 1);
});

test('aggregate quantity is constrained by stock, not the detail single-add limit of 99', () => {
  const { engine, catalog } = fixture(); catalog.find(product => product.product_id === 'lamp').skus[0].available_stock = 200;
  engine.add(request(99), 'a'); engine.add(request(99), 'b'); assert.equal(first(engine).quantity, 198);
});

test('read requests coalesce; an initial stale read completes before add and cannot overwrite its result', async () => {
  const { engine } = fixture(), gate = deferred(); let reads = 0;
  const store = new CartStore({ ...gatewayFor(engine), read: async () => { reads++; if (reads === 1) { await gate.promise; return emptyCart(); } return engine.read(); } }, () => 'key');
  const read = store.load(); assert.equal(store.load(), read);
  const add = store.add(request(2)); gate.resolve(); await Promise.all([read, add]);
  assert.equal(store.getSnapshot().view.quantity_total, 2); assert.equal(reads, 2);
});

test('duplicate add clicks share one in-flight write and a different pending payload is rejected', async () => {
  const { engine } = fixture(), gate = deferred(); let writes = 0;
  const store = new CartStore({ ...gatewayFor(engine), add: async (body, key) => { writes++; await gate.promise; return engine.add(body, key); } }, () => 'key');
  const add = store.add(request(2)); assert.equal(store.add(request(2)), add);
  await assert.rejects(store.add(request(1)), error => error.code === 'REQUEST_IN_PROGRESS');
  gate.resolve(); await add; assert.equal(writes, 1); assert.equal(first(engine).quantity, 2);
});

test('an unknown write response retries the original key without double incrementing', async () => {
  const { engine } = fixture(); let fail = true, sequence = 0; const keys = [];
  const store = new CartStore({ ...gatewayFor(engine), add: async (body, key) => { keys.push(key); const result = engine.add(body, key); if (fail) { fail = false; throw Error('network lost'); } return result; } }, () => `key-${++sequence}`);
  await assert.rejects(store.add(request(2))); assert.equal(store.getSnapshot().retryPending, true);
  await store.retry(); assert.deepEqual(keys, ['key-1', 'key-1']); assert.equal(first(engine).quantity, 2); assert.equal(store.getSnapshot().retryPending, false);
});

test('confirmed write with failed refresh retries only the read', async () => {
  const { engine } = fixture(); let writes = 0, reads = 0;
  const store = new CartStore({ read: async () => { if (++reads === 1) throw Error('refresh failed'); return engine.read(); }, add: async (body, key) => { writes++; return engine.add(body, key); } }, () => 'key');
  await assert.rejects(store.add(request(2))); assert.equal(store.getSnapshot().retryPending, true);
  await store.retry(); assert.equal(writes, 1); assert.equal(store.getSnapshot().view.quantity_total, 2);
});

test('a definitive rejection shows no success and releases the operation for an adjusted request', async () => {
  const { engine } = fixture(); let sequence = 0;
  const store = new CartStore(gatewayFor(engine), () => `key-${++sequence}`);
  await store.add(request(7)); await assert.rejects(store.add(request(2)), CartError);
  assert.equal(store.getSnapshot().notice, null); assert.equal(store.getSnapshot().retryPending, false);
  assert.equal(store.getSnapshot().view.quantity_total, 7);
  await store.add(request(1)); assert.equal(store.getSnapshot().view.quantity_total, 8);
});


test('sequential writes from separate demo instances refresh the shared snapshot before merging', () => {
  const { engine, options } = fixture(); const another = new MockCart({ ...options, id: () => 'another-row' });
  engine.add(request(2), 'first'); another.add({ sku_id: 'keyboard_ivory', quantity: 1 }, 'second');
  engine.add(request(3), 'third');
  assert.equal(engine.read().quantity_total, 6); assert.equal(another.read().quantity_total, 6);
  assert.equal(first(engine).quantity, 5); assert.equal(engine.read().item_count, 2);
});
