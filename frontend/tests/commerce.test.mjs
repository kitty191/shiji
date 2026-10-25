import test from 'node:test';
import assert from 'node:assert/strict';
import { MockCommerce } from '../src/mocks/commerce.ts';
import { MockCart } from '../src/mocks/cart.ts';
import { MockAddresses } from '../src/mocks/address.ts';
import { CommerceStore } from '../src/stores/commerce.ts';
import { CommerceError, checkoutPath, readCheckoutSelection, addressReturnPath, readOrderQuery } from '../src/lib/commerce.ts';
import { productDetails } from '../src/mocks/product.ts';

function fixture() {
  let data = null, writes = 0, seq = 0, clock = 1000000, fail = false, readFail = false;
  const catalog = structuredClone(productDetails), addresses = new MockAddresses({ id: () => 'address', now: () => clock });
  const address = addresses.create({ recipient_name: '演示人', recipient_phone: '00000000000', province: '示例省', city: '示例市', district: '示例区', detail_address: '演示路一号' }, 'address');
  const options = { catalog: () => catalog, addresses: () => addresses.read(), load: () => { if (readFail) throw Error('read'); return data; },
    save: value => { if (fail) throw Error('quota'); writes++; data = value; }, id: () => `id-${++seq}`, now: () => clock, previewMs: 500, paymentMs: 1000 };
  const engine = new MockCommerce(options), cart = new MockCart({ ...options, catalog: () => engine.catalog() });
  const lamp = cart.add({ sku_id: 'lamp_white-usb', quantity: 2 }, 'lamp'), keyboard = cart.add({ sku_id: 'keyboard_ivory', quantity: 1 }, 'keyboard');
  const request = { source: 'CART', cart_item_ids: [lamp.item_id, keyboard.item_id], address_id: address.address_id };
  const direct = { source: 'DIRECT', items: [{ sku_id: 'lamp_white-usb', quantity: 1 }], address_id: address.address_id };
  return { engine, cart, catalog, addresses, address, lamp, keyboard, request, direct, options, writes: () => writes, snapshot: () => data,
    fail: v => { fail = v; }, failRead: v => { readFail = v; }, advance: ms => { clock += ms; } };
}
const all = { status: '', order_no: '', page: 1, page_size: 12 };
const code = value => error => error.code === value;

test('preview charges actual SKU cents, groups stores and does not write or reserve', () => {
  const f = fixture(), writes = f.writes(); f.catalog[1].display_price = 1;
  const quote = f.engine.preview(f.request);
  assert.equal(quote.total_amount, 24700); assert.equal(quote.groups.length, 2); assert.equal(f.writes(), writes);
  assert.equal(f.engine.catalog()[1].skus[0].available_stock, 8); assert.equal(f.engine.orders(all).total, 0);
});
test('one snapshot submission creates linked orders and removes only selected cart rows', () => {
  const f = fixture(); f.cart.add({ sku_id: 'mug_default', quantity: 1 }, 'unselected');
  const quote = f.engine.preview(f.request), writes = f.writes(), payment = f.engine.submit(quote.preview_token, 'submit');
  assert.equal(f.writes(), writes + 1); assert.equal(payment.total_amount, 24700); assert.equal(payment.shop_orders.length, 2);
  assert.equal(f.engine.orders(all).total, 2); assert.equal(f.cart.read().item_count, 1); assert.equal(f.cart.read().groups[0].items[0].sku_id, 'mug_default');
  assert.equal(f.engine.catalog()[1].skus[0].available_stock, 6);
});
test('same preview with new key or reloaded engine has one effect, even after closure and expiry', () => {
  const f = fixture(), quote = f.engine.preview(f.request), first = f.engine.submit(quote.preview_token, 'submit'), writes = f.writes();
  assert.equal(f.engine.submit(quote.preview_token, 'submit').payment_group_id, first.payment_group_id);
  assert.equal(new MockCommerce(f.options).submit(quote.preview_token, 'different').payment_group_id, first.payment_group_id);
  assert.equal(f.writes(), writes + 1);
  assert.throws(() => f.engine.submit(f.engine.preview(f.direct).preview_token, 'different'), code('IDEMPOTENCY_CONFLICT'));
  f.engine.cancel(first.payment_group_id, 'cancel'); f.advance(3000);
  assert.equal(new MockCommerce(f.options).submit(quote.preview_token, 'later').status, 'CLOSED'); assert.equal(f.engine.orders(all).total, 2);
});
test('DIRECT reserves the chosen SKU without consuming cart rows', () => {
  const f = fixture(), saved = f.cart.read(), quote = f.engine.preview(f.direct); f.engine.submit(quote.preview_token, 'submit');
  assert.deepEqual(f.cart.read().groups.map(g => g.items.map(i => [i.item_id, i.quantity])), saved.groups.map(g => g.items.map(i => [i.item_id, i.quantity])));
  assert.equal(f.engine.catalog()[1].skus[0].available_stock, 7);
});
test('invalid selections, missing address and missing cart rows do not generate partial orders', () => {
  const f = fixture(), writes = f.writes();
  for (const r of [{ ...f.request, cart_item_ids: [] }, { ...f.request, cart_item_ids: [f.lamp.item_id, f.lamp.item_id] }, { ...f.direct, items: [{ sku_id: 'lamp_white-usb', quantity: 0 }] }]) assert.throws(() => f.engine.preview(r), code('INVALID_ARGUMENT'));
  assert.throws(() => f.engine.preview({ ...f.request, address_id: 'missing' }), code('ADDRESS_CHANGED'));
  assert.throws(() => f.engine.preview({ ...f.request, cart_item_ids: ['missing'] }), code('CART_CHANGED')); assert.equal(f.writes(), writes);
});
test('one unavailable or insufficient line rejects the entire checkout', () => {
  const f = fixture(); f.catalog[1].skus[0].available_stock = 1;
  assert.throws(() => f.engine.preview(f.request), code('INSUFFICIENT_STOCK'));
  f.catalog[1].skus.shift(); assert.throws(() => f.engine.preview(f.request), code('ITEM_NOT_PURCHASABLE')); assert.equal(f.engine.orders(all).total, 0);
});
test('both price increases and decreases require a new preview without any write', () => {
  for (const price of [5800, 6000]) {
    const f = fixture(), quote = f.engine.preview(f.request), saved = f.snapshot(); f.catalog[1].skus[0].price = price;
    assert.throws(() => f.engine.submit(quote.preview_token, 'submit'), code('PRICE_CHANGED')); assert.equal(f.snapshot(), saved); assert.equal(f.engine.orders(all).total, 0);
  }
});
test('edited or deleted address cannot silently replace a preview snapshot', () => {
  const f = fixture(), quote = f.engine.preview(f.request);
  f.addresses.update(f.address.address_id, { ...f.address, detail_address: '演示路二号' }, 'edit');
  assert.throws(() => f.engine.submit(quote.preview_token, 'submit'), code('ADDRESS_CHANGED'));
  f.addresses.remove(f.address.address_id, 'delete'); assert.throws(() => f.engine.submit(quote.preview_token, 'submit'), code('ADDRESS_CHANGED'));
  assert.equal(f.engine.orders(all).total, 0);
});
test('changed quantity or deleted cart rows requires explicit re-preview', () => {
  const f = fixture(), quote = f.engine.preview(f.request);
  f.cart.update(f.lamp.item_id, { quantity: 3, expected_quantity: 2 }, 'change');
  assert.throws(() => f.engine.submit(quote.preview_token, 'submit'), code('CART_CHANGED'));
  f.cart.remove([f.keyboard.item_id], 'remove'); assert.throws(() => f.engine.submit(quote.preview_token, 'submit'), code('CART_CHANGED')); assert.equal(f.engine.orders(all).total, 0);
});
test('expired preview cannot submit; fresh preview remains read only', () => {
  const f = fixture(), quote = f.engine.preview(f.request), saved = f.snapshot(); f.advance(500);
  assert.throws(() => f.engine.submit(quote.preview_token, 'submit'), code('PREVIEW_EXPIRED')); assert.equal(f.snapshot(), saved);
  assert.equal(f.engine.preview(f.request).groups[0].items[0].quantity, 2);
});
test('failed save preserves cart, orders and stock; original preview can retry', () => {
  const f = fixture(), quote = f.engine.preview(f.request), saved = f.snapshot(); f.fail(true);
  assert.throws(() => f.engine.submit(quote.preview_token, 'submit'), code('SERVICE_UNAVAILABLE'));
  assert.equal(f.snapshot(), saved); assert.equal(f.engine.orders(all).total, 0); assert.equal(f.cart.read().item_count, 2);
  f.fail(false); f.engine.submit(quote.preview_token, 'submit'); assert.equal(f.engine.orders(all).total, 2);
});
test('cancel closes all linked orders, releases once and keeps address/product snapshots', () => {
  const f = fixture(), payment = f.engine.submit(f.engine.preview(f.request).preview_token, 'submit'), before = f.engine.order(payment.shop_orders[0].order_id);
  f.addresses.remove(f.address.address_id, 'delete'); f.catalog[1].name = 'new name';
  f.engine.cancel(payment.payment_group_id, 'cancel'); f.engine.cancel(payment.payment_group_id, 'again');
  assert.ok(f.engine.orders(all).items.every(o => o.status === 'CLOSED')); assert.equal(f.engine.catalog()[1].skus[0].available_stock, 8);
  const after = f.engine.order(before.order_id); assert.deepEqual(after.items, before.items); assert.deepEqual(after.address, before.address); assert.equal(f.cart.read().item_count, 0);
});
test('failed cancel does not save; subsequent cart changes preserve the order ledger', () => {
  const f = fixture(), payment = f.engine.submit(f.engine.preview(f.request).preview_token, 'submit'), saved = f.snapshot(); f.fail(true);
  assert.throws(() => f.engine.cancel(payment.payment_group_id, 'cancel'), code('SERVICE_UNAVAILABLE')); assert.equal(f.snapshot(), saved);
  f.fail(false); f.cart.add({ sku_id: 'mug_default', quantity: 1 }, 'mug'); assert.equal(f.engine.orders(all).total, 2);
  f.engine.cancel(payment.payment_group_id, 'cancel'); assert.equal(f.cart.read().quantity_total, 1);
});
test('timeout closes pending orders on access and makes reserved stock available once', () => {
  const f = fixture(), payment = f.engine.submit(f.engine.preview(f.request).preview_token, 'submit'); f.advance(1000);
  assert.equal(f.engine.order(payment.shop_orders[0].order_id).status, 'CLOSED'); assert.equal(f.engine.payment(payment.payment_group_id).close_reason, 'TIMEOUT');
  assert.equal(f.engine.catalog()[1].skus[0].available_stock, 8); f.engine.cancel(payment.payment_group_id, 'cancel'); assert.equal(f.engine.catalog()[1].skus[0].available_stock, 8);
});
test('order filters, pagination and missing IDs are consistent', () => {
  const f = fixture(), payment = f.engine.submit(f.engine.preview(f.request).preview_token, 'submit');
  assert.equal(f.engine.orders({ ...all, page_size: 1 }).has_more, true); assert.equal(f.engine.orders({ ...all, page: 2, page_size: 1 }).items.length, 1);
  assert.equal(f.engine.orders({ ...all, order_no: payment.shop_orders[0].order_no }).total, 1); assert.equal(f.engine.orders({ ...all, status: 'CLOSED' }).total, 0);
  assert.throws(() => f.engine.order('missing'), code('NOT_FOUND')); assert.throws(() => f.engine.payment('missing'), code('NOT_FOUND'));
});
test('unreadable storage or damaged ledger blocks transaction writes and retains bytes', () => {
  const f = fixture(), quote = f.engine.preview(f.request), saved = f.snapshot(); f.failRead(true);
  assert.throws(() => f.engine.submit(quote.preview_token, 'submit'), code('SERVICE_UNAVAILABLE')); assert.equal(f.snapshot(), saved); f.failRead(false);
  f.options.save(JSON.stringify({ ...JSON.parse(saved), checkout: { version: 1, orders: [] } })); const damaged = f.snapshot();
  assert.throws(() => f.engine.orders(all), code('SERVICE_UNAVAILABLE')); assert.equal(f.snapshot(), damaged);
});
test('mutation key cannot be reused for a different preview or for cancel', () => {
  const f = fixture(), quote = f.engine.preview(f.request), payment = f.engine.submit(quote.preview_token, 'submit'), next = f.engine.preview(f.direct);
  assert.throws(() => f.engine.submit(next.preview_token, 'submit'), code('IDEMPOTENCY_CONFLICT'));
  assert.throws(() => f.engine.cancel(payment.payment_group_id, 'submit'), code('IDEMPOTENCY_CONFLICT'));
});
test('shared submit coalesces clicks and confirms lost response with original key', async () => {
  const f = fixture(), quote = f.engine.preview(f.request), keys = []; let fail = true;
  const store = new CommerceStore({ submit: async (token, key) => { keys.push(key); const result = f.engine.submit(token, key); if (fail) { fail = false; throw Error('lost'); } return result; } }, () => 'original');
  const first = store.submit(quote.preview_token); assert.equal(store.submit(quote.preview_token), first); await assert.rejects(first);
  assert.ok(store.getSnapshot().pending); await assert.rejects(store.cancel('different'), code('REQUEST_IN_PROGRESS'));
  const result = await store.retry(); assert.deepEqual(keys, ['original', 'original']); assert.equal(f.engine.orders(all).total, 2);
  assert.equal(result.status, 'PENDING'); assert.equal(store.getSnapshot().pending, null);
});
test('definitive reject releases mutation state for a corrected request', async () => {
  const store = new CommerceStore({ submit: async () => { throw new CommerceError('PRICE_CHANGED', 'changed'); } });
  await assert.rejects(store.submit('old'), code('PRICE_CHANGED')); assert.equal(store.getSnapshot().pending, null); assert.equal(store.getSnapshot().busy, false);
});
test('URL helpers preserve selections and restrict checkout/address return navigation', () => {
  const path = checkoutPath({ source: 'CART', cart_item_ids: ['a', 'b'] }, '/cart?return_to=%2Fbuyer%3Fkeyword%3Dtest');
  assert.deepEqual(readCheckoutSelection(new URLSearchParams(path.split('?')[1])), { source: 'CART', cart_item_ids: ['a', 'b'] });
  assert.ok(addressReturnPath(path).startsWith('/checkout?')); assert.equal(addressReturnPath('https://example.com'), '/buyer');
  assert.throws(() => readCheckoutSelection(new URLSearchParams('source=DIRECT&sku_id=a&quantity=0')));
  assert.deepEqual(readOrderQuery(new URLSearchParams('status=bogus&page=-1')), { status: '', order_no: '', page: 1, page_size: 12 });
});


test('separate previews recheck pending reservations before a second submission', () => {
  const f = fixture(), request = { ...f.direct, items: [{ sku_id: 'lamp_white-usb', quantity: 5 }] };
  const another = new MockCommerce(f.options), first = f.engine.preview(request), second = another.preview(request);
  f.engine.submit(first.preview_token, 'first'); const saved = f.snapshot();
  assert.throws(() => another.submit(second.preview_token, 'second'), code('INSUFFICIENT_STOCK'));
  assert.equal(f.snapshot(), saved); assert.equal(f.engine.orders(all).total, 1); assert.equal(f.engine.catalog()[1].skus[0].available_stock, 3);
});

test('uncertain cancellation confirms the original key without repeated stock release', async () => {
  const f = fixture(), payment = f.engine.submit(f.engine.preview(f.request).preview_token, 'submit'); let lost = true; const keys = [];
  const store = new CommerceStore({ cancel: async (id, key) => { keys.push(key); const result = f.engine.cancel(id, key); if (lost) { lost = false; throw Error('lost cancellation'); } return result; } }, () => 'cancel-original');
  await assert.rejects(store.cancel(payment.payment_group_id)); assert.equal(store.getSnapshot().pending.kind, 'cancel');
  await store.retry(); assert.deepEqual(keys, ['cancel-original', 'cancel-original']); assert.equal(f.engine.catalog()[1].skus[0].available_stock, 8);
  assert.ok(f.engine.orders(all).items.every(o => o.status === 'CLOSED'));
});
