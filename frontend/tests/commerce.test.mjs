import test from 'node:test';
import assert from 'node:assert/strict';
import { MockCommerce } from '../src/mocks/commerce.ts';
import { MockCart } from '../src/mocks/cart.ts';
import { MockAddresses } from '../src/mocks/address.ts';
import { CommerceStore } from '../src/stores/commerce.ts';
import { CommerceError, checkoutPath, readCheckoutSelection, addressReturnPath, readOrderQuery, paymentPath, paymentReturnPath, paymentResultPath, loadOrderDetail } from '../src/lib/commerce.ts';
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


test('payment page links preserve order list/detail return context and encode opaque payment IDs', () => {
  const list = '/orders?status=PENDING_PAYMENT&order_no=SJ123&page=2';
  const detail = `/orders/order-a?${new URLSearchParams({ return_to: list })}`;
  const path = paymentPath('pay/a?b', detail);
  assert.equal(path.split('?')[0], '/payments/pay%2Fa%3Fb');
  assert.equal(new URLSearchParams(path.slice(path.indexOf('?') + 1)).get('return_to'), detail);
  assert.equal(paymentReturnPath(list), list);
  assert.equal(paymentPath('pay-a'), '/payments/pay-a');
});

test('payment return navigation rejects foreign, recursive payment and checkout destinations', () => {
  for (const value of [null, 'https://example.com/orders', '//example.com/orders', '/checkout?source=CART', '/payments/pay-a', '/orders/order-a#unsafe']) assert.equal(paymentReturnPath(value), '/orders');
  const result = paymentReturnPath('/orders/order-a?return_to=https%3A%2F%2Fexample.com&ignored=value');
  assert.equal(result, '/orders/order-a?return_to=%2Forders');
});

test('standalone payment reads expose the complete persisted group without mutating orders, cart or reservations', () => {
  const f = fixture(), payment = f.engine.submit(f.engine.preview(f.request).preview_token, 'submit');
  const bytes = f.snapshot(), writes = f.writes(), view = f.engine.payment(payment.payment_group_id);
  assert.equal(view.shop_orders.length, 2); assert.equal(view.total_amount, view.shop_orders.reduce((n, order) => n + order.total_amount, 0));
  view.shop_orders[0].total_amount = 0; view.status = 'PAID';
  const restored = new MockCommerce(f.options).payment(payment.payment_group_id);
  assert.equal(restored.status, 'PENDING'); assert.equal(restored.total_amount, 24700); assert.ok(restored.shop_orders.every(o => o.total_amount > 0));
  assert.equal(f.writes(), writes); assert.equal(f.snapshot(), bytes); assert.equal(f.engine.orders(all).total, 2); assert.equal(f.engine.catalog()[1].skus[0].available_stock, 6);
});

test('payment atomically updates every shop order and retains deducted stock after expiry/reload', () => {
  const f = fixture(), p = f.engine.submit(f.engine.preview(f.request).preview_token, 'submit');
  const before = f.engine.orders(all).items, stock = f.engine.catalog(), writes = f.writes();
  const paid = f.engine.pay(p.payment_group_id, 'pay');
  assert.equal(f.writes(), writes + 1); assert.equal(paid.status, 'PAID'); assert.ok(paid.paid_at);
  assert.deepEqual(paid.allowed_actions, []); assert.ok(paid.shop_orders.every(o => o.status === 'PENDING_SHIPMENT'));
  for (const old of before) {
    const order = f.engine.order(old.order_id);
    assert.equal(order.status, 'PENDING_SHIPMENT'); assert.equal(order.payment_status, 'PAID'); assert.equal(order.paid_at, paid.paid_at);
    assert.deepEqual(order.items, old.items); assert.deepEqual(order.address, old.address); assert.equal(order.total_amount, old.total_amount);
  }
  f.advance(2000); const reloaded = new MockCommerce(f.options);
  assert.equal(reloaded.payment(p.payment_group_id).status, 'PAID'); assert.deepEqual(reloaded.catalog(), stock);
  assert.equal(reloaded.orders({ ...all, status: 'PENDING_SHIPMENT' }).total, 2); assert.equal(f.cart.read().item_count, 0);
  assert.throws(() => reloaded.cancel(p.payment_group_id, 'late-cancel'), code('INVALID_STATE'));
});
test('payment with original or fresh keys never deducts twice or changes paid time', () => {
  const f = fixture(), p = f.engine.submit(f.engine.preview(f.direct).preview_token, 'submit');
  const paid = f.engine.pay(p.payment_group_id, 'pay'), bytes = f.snapshot(), writes = f.writes(); f.advance(2000);
  for (const key of ['pay', 'new-key']) { const result = new MockCommerce(f.options).pay(p.payment_group_id, key); assert.equal(result.status, 'PAID'); assert.equal(result.paid_at, paid.paid_at); }
  assert.equal(f.writes(), writes + 1); assert.equal(f.engine.catalog()[1].skus[0].available_stock, 7);
  const saved = f.snapshot(); f.engine.pay(p.payment_group_id, 'new-key'); assert.equal(f.snapshot(), saved);
  assert.throws(() => f.engine.cancel(p.payment_group_id, 'new-key'), code('IDEMPOTENCY_CONFLICT'));
});
test('closed, missing and deadline-boundary payment attempts never write or revive orders', () => {
  for (const close of ['cancel', 'timeout']) {
    const f = fixture(), p = f.engine.submit(f.engine.preview(f.request).preview_token, 'submit');
    if (close === 'cancel') f.engine.cancel(p.payment_group_id, 'cancel'); else f.advance(1000);
    const bytes = f.snapshot(), writes = f.writes();
    assert.throws(() => f.engine.pay(p.payment_group_id, 'pay'), code(close === 'timeout' ? 'PAYMENT_EXPIRED' : 'INVALID_STATE')); assert.throws(() => f.engine.pay('missing', 'missing'), code('NOT_FOUND'));
    assert.equal(f.snapshot(), bytes); assert.equal(f.writes(), writes); assert.equal(f.engine.catalog()[1].skus[0].available_stock, 8);
  }
});
test('payment read/save failures preserve all pending orders and allow retry after reread', () => {
  for (const mode of ['read', 'write']) {
    const f = fixture(), p = f.engine.submit(f.engine.preview(f.request).preview_token, 'submit'), bytes = f.snapshot();
    if (mode === 'read') f.failRead(true); else f.fail(true);
    assert.throws(() => f.engine.pay(p.payment_group_id, 'pay'), code('SERVICE_UNAVAILABLE')); assert.equal(f.snapshot(), bytes);
    f.failRead(false); f.fail(false); assert.equal(f.engine.payment(p.payment_group_id).status, 'PENDING'); assert.ok(f.engine.orders(all).items.every(o => o.status === 'PENDING_PAYMENT'));
    assert.equal(f.engine.pay(p.payment_group_id, 'pay').status, 'PAID');
  }
});
test('paid inventory blocks overselling and survives unrelated cart writes', () => {
  const f = fixture(), request = { ...f.direct, items: [{ sku_id: 'lamp_white-usb', quantity: 5 }] };
  const p = f.engine.submit(f.engine.preview(request).preview_token, 'submit'); f.engine.pay(p.payment_group_id, 'pay'); f.advance(2000);
  assert.throws(() => f.engine.preview(request), code('INSUFFICIENT_STOCK')); f.cart.add({ sku_id: 'mug_default', quantity: 1 }, 'mug');
  const reloaded = new MockCommerce(f.options); assert.equal(reloaded.payment(p.payment_group_id).status, 'PAID'); assert.equal(reloaded.catalog()[1].skus[0].available_stock, 3);
});
test('payment keys are bound to action and payment group', () => {
  const f = fixture(), a = f.engine.submit(f.engine.preview(f.direct).preview_token, 'submit-a'), b = f.engine.submit(f.engine.preview(f.direct).preview_token, 'submit-b');
  assert.throws(() => f.engine.pay(a.payment_group_id, 'submit-a'), code('IDEMPOTENCY_CONFLICT')); f.engine.pay(a.payment_group_id, 'pay');
  assert.throws(() => f.engine.pay(b.payment_group_id, 'pay'), code('IDEMPOTENCY_CONFLICT')); assert.throws(() => f.engine.cancel(a.payment_group_id, 'pay'), code('IDEMPOTENCY_CONFLICT'));
  assert.equal(f.engine.payment(b.payment_group_id).status, 'PENDING');
});
test('lost payment response coalesces clicks and confirms original key across expiry', async () => {
  const f = fixture(), p = f.engine.submit(f.engine.preview(f.request).preview_token, 'submit'); let lost = true; const keys = [];
  const store = new CommerceStore({ pay: async (id, key) => { keys.push(key); const result = f.engine.pay(id, key); if (lost) { lost = false; throw Error('lost'); } return result; } }, () => 'pay-original');
  const first = store.pay(p.payment_group_id); assert.equal(store.pay(p.payment_group_id), first); await assert.rejects(first);
  assert.equal(store.getSnapshot().pending.kind, 'pay'); await assert.rejects(store.cancel(p.payment_group_id), code('REQUEST_IN_PROGRESS'));
  f.advance(2000); const writes = f.writes(); assert.equal((await store.retry()).status, 'PAID'); assert.deepEqual(keys, ['pay-original', 'pay-original']); assert.equal(f.writes(), writes);
  assert.equal(store.getSnapshot().pending, null); assert.equal(store.getSnapshot().busy, false);
});
test('definitive payment failure releases operation for a new attempt', async () => {
  const f = fixture(), p = f.engine.submit(f.engine.preview(f.request).preview_token, 'submit'); let seq = 0;
  const store = new CommerceStore({ pay: async (id, key) => f.engine.pay(id, key) }, () => `pay-${++seq}`);
  f.fail(true); await assert.rejects(store.pay(p.payment_group_id), code('SERVICE_UNAVAILABLE')); assert.equal(store.getSnapshot().pending, null); assert.equal(store.getSnapshot().busy, false);
  f.fail(false); assert.equal(f.engine.payment(p.payment_group_id).status, 'PENDING'); assert.equal((await store.pay(p.payment_group_id)).status, 'PAID');
});
test('old pending snapshots expose payment action without modifying persisted bytes', () => {
  const f = fixture(), p = f.engine.submit(f.engine.preview(f.direct).preview_token, 'submit');
  const old = JSON.parse(f.snapshot()); old.checkout.payments[0].allowed_actions = ['CANCEL']; f.options.save(JSON.stringify(old));
  const bytes = f.snapshot(); assert.ok(new MockCommerce(f.options).payment(p.payment_group_id).allowed_actions.includes('SIMULATE_PAY'));
  assert.equal(f.snapshot(), bytes); assert.equal(f.engine.pay(p.payment_group_id, 'pay').status, 'PAID');
});

test('historical pending orders can pay after catalog changes without changing snapshots or price', () => {
  const f = fixture(), p = f.engine.submit(f.engine.preview(f.request).preview_token, 'submit'), before = f.engine.orders(all).items;
  f.catalog.splice(0); f.addresses.remove(f.address.address_id, 'remove');
  assert.equal(f.engine.pay(p.payment_group_id, 'pay').total_amount, p.total_amount);
  for (const old of before) { const order = f.engine.order(old.order_id); assert.deepEqual(order.items, old.items); assert.deepEqual(order.address, old.address); }
});
test('inconsistent paid ledger blocks further writes instead of releasing paid inventory', () => {
  const f = fixture(), p = f.engine.submit(f.engine.preview(f.request).preview_token, 'submit');
  f.engine.pay(p.payment_group_id, 'pay'); const bad = JSON.parse(f.snapshot()); bad.checkout.orders[0].payment_status = 'PENDING'; f.options.save(JSON.stringify(bad));
  const bytes = f.snapshot(); assert.throws(() => f.engine.pay(p.payment_group_id, 'pay-again'), code('SERVICE_UNAVAILABLE')); assert.throws(() => f.engine.catalog(), code('SERVICE_UNAVAILABLE')); assert.equal(f.snapshot(), bytes);
});

test('deadline crossed while preparing payment still rejects the transition without saving', () => {
  const f = fixture(), p = f.engine.submit(f.engine.preview(f.direct).preview_token, 'submit'), bytes = f.snapshot(); let calls = 0;
  f.options.now = () => Date.parse(p.expires_at) - (calls++ === 0 ? 1 : 0);
  assert.throws(() => f.engine.pay(p.payment_group_id, 'boundary'), code('PAYMENT_EXPIRED')); assert.equal(f.snapshot(), bytes);
  assert.equal(f.engine.payment(p.payment_group_id).status, 'CLOSED');
});

test('result links encode opaque IDs and preserve only canonical order return context', () => {
  const detail = '/orders/order-a?return_to=%2Forders%3Fstatus%3DPENDING_SHIPMENT%26page%3D2';
  const path = paymentResultPath('pay/a?b', detail);
  assert.equal(path.split('?')[0], '/payments/pay%2Fa%3Fb/result');
  assert.equal(new URLSearchParams(path.slice(path.indexOf('?') + 1)).get('return_to'), detail);
  assert.equal(paymentResultPath('pay', 'https://example.com'), '/payments/pay/result');
  assert.equal(paymentResultPath('pay', '/payments/pay/result'), '/payments/pay/result');
});
test('reloading paid result data is read-only and never repeats payment or stock consumption', () => {
  const f = fixture(), p = f.engine.submit(f.engine.preview(f.request).preview_token, 'submit'); f.engine.pay(p.payment_group_id, 'pay');
  const bytes = f.snapshot(), writes = f.writes(); f.advance(2000);
  for (let i = 0; i < 3; i++) {
    const view = new MockCommerce(f.options).payment(p.payment_group_id);
    assert.equal(view.status, 'PAID'); assert.ok(view.paid_at); assert.ok(view.shop_orders.every(o => o.status === 'PENDING_SHIPMENT'));
    view.shop_orders[0].status = 'CLOSED';
  }
  assert.equal(f.snapshot(), bytes); assert.equal(f.writes(), writes); assert.equal(f.engine.catalog()[1].skus[0].available_stock, 6);
});
test('result queries retain pending/closed states instead of manufacturing payment success', () => {
  const f = fixture(), p = f.engine.submit(f.engine.preview(f.direct).preview_token, 'submit'), bytes = f.snapshot();
  assert.equal(new MockCommerce(f.options).payment(p.payment_group_id).status, 'PENDING'); assert.equal(f.snapshot(), bytes);
  f.engine.cancel(p.payment_group_id, 'cancel'); const closed = f.snapshot();
  assert.equal(new MockCommerce(f.options).payment(p.payment_group_id).status, 'CLOSED'); assert.equal(f.snapshot(), closed);
});


test('buyer detail rechecks a shipment between order and payment reads even though both payment states stay PAID', async () => {
  const f = fixture(); f.options.merchantStore = () => ({ store_id: 'store_home', name: '好物生活馆' });
  const payment = f.engine.submit(f.engine.preview(f.request).preview_token, 'submit'); f.engine.pay(payment.payment_group_id, 'pay');
  const id = payment.shop_orders.find(o => o.store_id === 'store_home').order_id, old = f.engine.order(id); let calls = 0;
  f.engine.ship(id, { shipping_carrier: '演示物流', tracking_no: 'DEMO-001' }, 'ship');
  const result = await loadOrderDetail({ order: async () => ++calls === 1 ? old : f.engine.order(id), payment: async p => f.engine.payment(p) }, id);
  assert.equal(result.order.status, 'PENDING_RECEIPT'); assert.equal(result.order.tracking_no, 'DEMO-001'); assert.ok(result.order.shipped_at);
  assert.equal(result.payment.status, 'PAID'); assert.equal(result.payment.shop_orders.find(o => o.order_id === id).status, result.order.status);
});
test('buyer detail still recovers closure when expiry happens between its two reads', async () => {
  const f = fixture(), payment = f.engine.submit(f.engine.preview(f.request).preview_token, 'submit');
  const result = await loadOrderDetail({ order: async id => f.engine.order(id), payment: async id => { f.advance(1000); return f.engine.payment(id); } }, payment.shop_orders[0].order_id);
  assert.equal(result.order.status, 'CLOSED'); assert.equal(result.order.close_reason, 'TIMEOUT'); assert.equal(result.order.closed_at, payment.expires_at);
});
