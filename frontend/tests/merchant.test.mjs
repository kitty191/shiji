import test from 'node:test';
import assert from 'node:assert/strict';
import { MockCommerce } from '../src/mocks/commerce.ts';
import { MockCart } from '../src/mocks/cart.ts';
import { MockAddresses } from '../src/mocks/address.ts';
import { productDetails } from '../src/mocks/product.ts';
import { CommerceStore } from '../src/stores/commerce.ts';
import { CommerceError } from '../src/lib/commerce.ts';
import { normalizeShipping, merchantOrderPath, merchantOrdersReturnPath, readMerchantOrderQuery } from '../src/lib/merchant.ts';

const all = { status: '', order_no: '', keyword: '', page: 1, page_size: 12 };
const hasCode = code => error => error.code === code;
function fixture() {
  let bytes = null, clock = 1000000, seq = 0, writes = 0, broken = false, saveBroken = false, scope = { store_id: 'store_home', name: '好物生活馆' };
  const catalog = structuredClone(productDetails), addresses = new MockAddresses({ id: () => 'address', now: () => clock });
  const address = addresses.create({ recipient_name: '演示人', recipient_phone: '00000000000', province: '示例省', city: '示例市', district: '示例区', detail_address: '演示路一号' }, 'create');
  const options = { catalog: () => catalog, merchantStore: () => scope, addresses: () => addresses.read(),
    load: () => { if (broken) throw Error('read failure'); return bytes; }, save: value => { if (saveBroken) throw Error('save failure'); writes++; bytes = value; }, now: () => clock, id: () => `m-${++seq}`, paymentMs: 1000 };
  const engine = new MockCommerce(options), cart = new MockCart({ ...options, catalog: () => engine.catalog() });
  const lamp = cart.add({ sku_id: 'lamp_white-usb', quantity: 1 }, 'lamp'), keyboard = cart.add({ sku_id: 'keyboard_ivory', quantity: 1 }, 'keyboard');
  const request = { source: 'CART', cart_item_ids: [lamp.item_id, keyboard.item_id], address_id: address.address_id };
  const direct = { source: 'DIRECT', items: [{ sku_id: 'lamp_white-usb', quantity: 1 }], address_id: address.address_id };
  const payment = engine.submit(engine.preview(request).preview_token, 'submit');
  return { engine, options, catalog, addresses, address, payment, direct, writes: () => writes, bytes: () => bytes,
    advance: ms => { clock += ms; }, fail: value => { broken = value; }, failSave: value => { saveBroken = value; }, scope: value => { scope = value; } };
}

test('merchant list limits orders and total to bound store despite a forged store filter', () => {
  const f = fixture(), page = f.engine.merchantOrders(all);
  assert.equal(f.payment.total_amount, 18800); assert.equal(page.total, 1); assert.equal(page.items[0].total_amount, 5900);
  assert.equal(page.items[0].store_id, 'store_home'); assert.equal(page.items[0].items[0].sku_id, 'lamp_white-usb');
  assert.deepEqual(f.engine.merchantOrders({ ...all, store_id: 'store_digital' }), page);
});
test('foreign and missing order IDs have the same merchant not-found response', () => {
  const f = fixture(), foreign = f.payment.shop_orders.find(o => o.store_id !== 'store_home'); let a, b;
  try { f.engine.merchantOrder(foreign.order_id); } catch (error) { a = error; }
  try { f.engine.merchantOrder('missing'); } catch (error) { b = error; }
  assert.equal(a.code, 'NOT_FOUND'); assert.equal(a.message, b.message);
  assert.equal(f.engine.merchantOrder(f.engine.merchantOrders(all).items[0].order_id).total_amount, 5900);
});
test('merchant reads require ownership and never fall back to buyer queries', () => {
  const f = fixture(), bytes = f.bytes(); f.scope(null);
  assert.throws(() => f.engine.merchantOrders(all), hasCode('FORBIDDEN')); assert.throws(() => f.engine.merchantOrder(f.payment.shop_orders[0].order_id), hasCode('FORBIDDEN'));
  delete f.options.merchantStore; assert.throws(() => f.engine.merchantOrders(all), hasCode('FORBIDDEN')); assert.equal(f.bytes(), bytes);
});
test('merchant projections exclude payment groups, sibling orders and list addresses', () => {
  const f = fixture(), summary = f.engine.merchantOrders(all).items[0], detail = f.engine.merchantOrder(summary.order_id);
  const summaryKeys = ['order_id','order_no','store_id','store_name','status','goods_amount','shipping_amount','total_amount','items','currency','created_at','allowed_actions'];
  const detailKeys = [...summaryKeys,'address','payment_status','paid_at','shipping_carrier','tracking_no','shipped_at','received_at','closed_at','close_reason'];
  assert.deepEqual(Object.keys(summary).sort(), summaryKeys.sort()); assert.deepEqual(Object.keys(detail).sort(), detailKeys.sort());
  assert.deepEqual(detail.allowed_actions, []); assert.deepEqual(summary.allowed_actions, []);
  assert.equal(JSON.stringify(detail).includes('小橙数码'), false); assert.equal(JSON.stringify(detail).includes(f.payment.payment_group_id), false);
});
test('merchant filtering uses own-store order numbers and historical product titles', () => {
  const f = fixture(), own = f.engine.merchantOrders(all).items[0], foreign = f.payment.shop_orders.find(o => o.store_id !== 'store_home'); f.catalog[1].name = '全新商品名字';
  assert.equal(f.engine.merchantOrders({ ...all, keyword: ' 台灯 ' }).total, 1);
  assert.equal(f.engine.merchantOrders({ ...all, keyword: '全新商品名字' }).total, 0); assert.equal(f.engine.merchantOrders({ ...all, keyword: '无线键盘' }).total, 0);
  assert.equal(f.engine.merchantOrders({ ...all, order_no: own.order_no, keyword: '台灯', status: 'PENDING_PAYMENT' }).total, 1);
  assert.equal(f.engine.merchantOrders({ ...all, order_no: foreign.order_no }).total, 0);
});
test('merchant views reflect buyer payment, cancellation and timeout without writes', () => {
  const f = fixture(), id = f.engine.merchantOrders(all).items[0].order_id;
  f.engine.pay(f.payment.payment_group_id, 'pay'); assert.equal(f.engine.merchantOrders({ ...all, status: 'PENDING_SHIPMENT' }).total, 1);
  assert.equal(f.engine.merchantOrder(id).payment_status, 'PAID'); assert.ok(f.engine.merchantOrder(id).paid_at);
  const next = f.engine.submit(f.engine.preview(f.direct).preview_token, 'next'); f.engine.cancel(next.payment_group_id, 'cancel');
  assert.equal(f.engine.merchantOrders({ ...all, status: 'CLOSED' }).total, 1);
  const timeout = f.engine.submit(f.engine.preview(f.direct).preview_token, 'timeout'), bytes = f.bytes(); f.advance(1000);
  assert.equal(f.engine.merchantOrder(timeout.shop_orders[0].order_id).close_reason, 'TIMEOUT'); assert.equal(f.engine.merchantOrders({ ...all, status: 'CLOSED' }).total, 2);
  assert.equal(f.engine.merchantOrder(id).status, 'PENDING_SHIPMENT'); assert.equal(f.bytes(), bytes);
});
test('merchant pagination is stable at equal timestamps and excludes foreign rows', () => {
  const f = fixture(); for (let i = 0; i < 4; i++) f.engine.submit(f.engine.preview(f.direct).preview_token, `submit-${i}`);
  const first = f.engine.merchantOrders({ ...all, page_size: 2 }), second = f.engine.merchantOrders({ ...all, page: 2, page_size: 2 }), third = f.engine.merchantOrders({ ...all, page: 3, page_size: 2 });
  assert.equal(first.total, 5); assert.equal(first.has_more, true); assert.equal(second.has_more, true); assert.equal(third.has_more, false);
  assert.equal(new Set([...first.items, ...second.items, ...third.items].map(o => o.order_id)).size, 5); assert.deepEqual(first, f.engine.merchantOrders({ ...all, page_size: 2 }));
  f.advance(1); const latest = f.engine.submit(f.engine.preview(f.direct).preview_token, 'latest'); assert.equal(f.engine.merchantOrders(all).items[0].order_id, latest.shop_orders[0].order_id);
});
test('merchant responses are cloned and cannot alter ledger, cart or stock', () => {
  const f = fixture(), bytes = f.bytes(), writes = f.writes(), stock = f.engine.catalog(); const view = f.engine.merchantOrders(all); view.items[0].items[0].name = 'tampered';
  const detail = f.engine.merchantOrder(view.items[0].order_id); detail.address.detail_address = 'tampered';
  assert.equal(f.engine.merchantOrder(detail.order_id).address.detail_address, '演示路一号'); assert.equal(f.engine.merchantOrders(all).items[0].items[0].name, '折叠台灯');
  assert.equal(f.bytes(), bytes); assert.equal(f.writes(), writes); assert.deepEqual(f.engine.catalog(), stock);
});
test('historical merchant details survive catalog removal and address changes', () => {
  const f = fixture(), before = f.engine.merchantOrder(f.engine.merchantOrders(all).items[0].order_id);
  f.addresses.update(f.address.address_id, { ...f.address, detail_address: '后来的地址' }, 'edit'); f.addresses.remove(f.address.address_id, 'remove'); f.catalog.splice(0);
  assert.deepEqual(f.engine.merchantOrder(before.order_id), before); assert.equal(f.engine.merchantOrders({ ...all, keyword: '台灯' }).total, 1);
});
test('merchant read failures remain errors and never fabricate empty data or write storage', () => {
  const f = fixture(), id = f.engine.merchantOrders(all).items[0].order_id, bytes = f.bytes(), writes = f.writes(); f.fail(true);
  assert.throws(() => f.engine.merchantOrders(all), hasCode('SERVICE_UNAVAILABLE')); assert.throws(() => f.engine.merchantOrder(id), hasCode('SERVICE_UNAVAILABLE'));
  assert.equal(f.bytes(), bytes); assert.equal(f.writes(), writes); f.fail(false); assert.equal(f.engine.merchantOrders(all).total, 1);
});
test('invalid merchant pagination and filters reject without writes', () => {
  const f = fixture(), bytes = f.bytes();
  for (const patch of [{ page: 0 }, { page: 1.5 }, { page_size: 0 }, { page_size: 51 }, { status: 'bogus' }, { keyword: null }, { order_no: 123 }]) assert.throws(() => f.engine.merchantOrders({ ...all, ...patch }), hasCode('INVALID_ARGUMENT'));
  assert.equal(f.bytes(), bytes);
});
test('merchant links preserve query context and reject unsafe or buyer return routes', () => {
  const list = '/merchant/orders?status=PENDING_SHIPMENT&order_no=SJ123&keyword=%E5%8F%B0%E7%81%AF&page=2', path = merchantOrderPath('order/a?b', list);
  assert.equal(path.split('?')[0], '/merchant/orders/order%2Fa%3Fb'); assert.equal(new URLSearchParams(path.slice(path.indexOf('?') + 1)).get('return_to'), list);
  assert.equal(merchantOrdersReturnPath(list + '&store_id=store_digital'), list);
  for (const value of [null,'https://example.com/merchant/orders','//example.com','/orders','/merchant/orders/foreign','/merchant/orders#unsafe']) assert.equal(merchantOrdersReturnPath(value), '/merchant/orders');
  assert.deepEqual(readMerchantOrderQuery(new URLSearchParams('status=unknown&page=-2&store_id=store_digital')), all);
});

const shipping = { shipping_carrier: '演示物流', tracking_no: 'DEMO-SJ-0001' };
function paidFixture() {
  const f = fixture(); f.engine.pay(f.payment.payment_group_id, 'pay');
  return { ...f, own: f.engine.merchantOrders(all).items[0] };
}
test('shipping atomically advances one store order and its payment link without changing stock or snapshots', () => {
  const f = paidFixture(), before = f.engine.order(f.own.order_id), stock = f.engine.catalog(), cartRows = JSON.parse(f.bytes()).items, writes = f.writes();
  assert.deepEqual(f.engine.merchantOrder(f.own.order_id).allowed_actions, ['SHIP']);
  const shipped = f.engine.ship(f.own.order_id, shipping, 'ship');
  assert.equal(f.writes(), writes + 1); assert.equal(shipped.status, 'PENDING_RECEIPT'); assert.equal(shipped.payment_status, 'PAID'); assert.ok(shipped.shipped_at);
  assert.equal(shipped.shipping_carrier, shipping.shipping_carrier); assert.equal(shipped.tracking_no, shipping.tracking_no); assert.deepEqual(shipped.allowed_actions, []);
  assert.deepEqual(shipped.items, before.items); assert.deepEqual(shipped.address, before.address); assert.equal(shipped.paid_at, before.paid_at); assert.equal(shipped.total_amount, before.total_amount);
  const payment = f.engine.payment(f.payment.payment_group_id); assert.equal(payment.status, 'PAID');
  assert.equal(payment.shop_orders.find(o => o.order_id === shipped.order_id).status, 'PENDING_RECEIPT'); assert.equal(payment.shop_orders.find(o => o.order_id !== shipped.order_id).status, 'PENDING_SHIPMENT');
  assert.equal(f.engine.orders({ ...all, status: 'PENDING_RECEIPT' }).total, 1); assert.deepEqual(f.engine.catalog(), stock); assert.deepEqual(JSON.parse(f.bytes()).items, cartRows);
  assert.equal(f.engine.order(shipped.order_id).tracking_no, shipping.tracking_no); assert.equal('payment_group_id' in shipped, false);
});
test('original shipping receipt survives reload and expiry without writing or changing first shipment time', () => {
  const f = paidFixture(), shipped = f.engine.ship(f.own.order_id, shipping, 'ship'), bytes = f.bytes(), writes = f.writes(); f.advance(3000);
  const replay = new MockCommerce(f.options).ship(f.own.order_id, { shipping_carrier: ' 演示物流 ', tracking_no: ' DEMO-SJ-0001 ' }, 'ship');
  assert.deepEqual(replay, shipped); assert.equal(f.bytes(), bytes); assert.equal(f.writes(), writes);
});
test('fresh shipping key for identical logistics only adds a receipt, and different logistics cannot overwrite shipment', () => {
  const f = paidFixture(), shipped = f.engine.ship(f.own.order_id, shipping, 'ship'); f.advance(1); const writes = f.writes();
  assert.deepEqual(f.engine.ship(f.own.order_id, shipping, 'fresh'), shipped); assert.equal(f.writes(), writes + 1); const bytes = f.bytes();
  assert.throws(() => f.engine.ship(f.own.order_id, { ...shipping, tracking_no: 'OTHER' }, 'different'), hasCode('INVALID_STATE'));
  assert.throws(() => f.engine.ship(f.own.order_id, { ...shipping, shipping_carrier: '其他物流' }, 'ship'), hasCode('IDEMPOTENCY_CONFLICT'));
  assert.equal(f.bytes(), bytes); assert.equal(f.engine.merchantOrder(f.own.order_id).shipped_at, shipped.shipped_at);
});
test('unpaid, cancelled and expired orders cannot ship or revive inventory', () => {
  for (const mode of ['unpaid', 'cancelled', 'expired']) {
    const f = fixture(), id = f.engine.merchantOrders(all).items[0].order_id;
    if (mode === 'cancelled') f.engine.cancel(f.payment.payment_group_id, 'cancel'); if (mode === 'expired') f.advance(1000);
    const bytes = f.bytes(), writes = f.writes(); assert.throws(() => f.engine.ship(id, shipping, 'ship'), hasCode('INVALID_STATE'));
    assert.equal(f.bytes(), bytes); assert.equal(f.writes(), writes); assert.notEqual(f.engine.order(id).status, 'PENDING_RECEIPT');
  }
});
test('shipping requires current ownership even when replaying a known receipt', () => {
  const f = paidFixture(), foreign = f.payment.shop_orders.find(o => o.store_id !== 'store_home'), before = f.bytes();
  assert.throws(() => f.engine.ship(foreign.order_id, shipping, 'foreign'), hasCode('NOT_FOUND')); assert.throws(() => f.engine.ship('missing', shipping, 'missing'), hasCode('NOT_FOUND')); assert.equal(f.bytes(), before);
  f.scope(null); assert.throws(() => f.engine.ship(f.own.order_id, shipping, 'ship'), hasCode('FORBIDDEN'));
  f.scope({ store_id: 'store_home', name: '好物生活馆' }); f.engine.ship(f.own.order_id, shipping, 'ship'); f.scope({ store_id: 'store_digital', name: '小橙数码' });
  assert.throws(() => f.engine.ship(f.own.order_id, shipping, 'ship'), hasCode('NOT_FOUND')); assert.throws(() => f.engine.ship(foreign.order_id, shipping, 'ship'), hasCode('IDEMPOTENCY_CONFLICT'));
});
test('shipping read/save failures preserve pending shipment and can retry without partial effects', () => {
  for (const mode of ['read', 'save']) {
    const f = paidFixture(), bytes = f.bytes(); if (mode === 'read') f.fail(true); else f.failSave(true);
    assert.throws(() => f.engine.ship(f.own.order_id, shipping, 'ship'), hasCode('SERVICE_UNAVAILABLE')); assert.equal(f.bytes(), bytes); f.fail(false); f.failSave(false);
    const pending = f.engine.merchantOrder(f.own.order_id); assert.equal(pending.status, 'PENDING_SHIPMENT'); assert.equal(pending.shipped_at, null);
    assert.equal(f.engine.ship(f.own.order_id, shipping, 'ship').status, 'PENDING_RECEIPT');
  }
});
test('logistics validation trims edges while preserving carrier text and tracking-number case', () => {
  assert.deepEqual(normalizeShipping({ shipping_carrier: ' 演示 物流 ', tracking_no: ' aB-123/演示 ' }), { shipping_carrier: '演示 物流', tracking_no: 'aB-123/演示' });
  const f = paidFixture(), bytes = f.bytes();
  for (const request of [null, {}, { ...shipping, shipping_carrier: ' ' }, { ...shipping, tracking_no: '' }, { ...shipping, tracking_no: 'ABC\nXYZ' }]) assert.throws(() => f.engine.ship(f.own.order_id, request, 'ship'), hasCode('INVALID_ARGUMENT'));
  assert.equal(f.bytes(), bytes);
});
test('shipping keys cannot be reused for payment, another order or another logistics payload', () => {
  const f = paidFixture(); assert.throws(() => f.engine.ship(f.own.order_id, shipping, 'pay'), hasCode('IDEMPOTENCY_CONFLICT'));
  f.engine.ship(f.own.order_id, shipping, 'ship'); assert.throws(() => f.engine.pay(f.payment.payment_group_id, 'ship'), hasCode('IDEMPOTENCY_CONFLICT'));
  const next = f.engine.submit(f.engine.preview(f.direct).preview_token, 'next'); f.engine.pay(next.payment_group_id, 'pay-next');
  assert.throws(() => f.engine.ship(next.shop_orders[0].order_id, shipping, 'ship'), hasCode('IDEMPOTENCY_CONFLICT')); assert.equal(f.engine.merchantOrder(next.shop_orders[0].order_id).status, 'PENDING_SHIPMENT');
});
test('historical paid orders can ship after current catalog and address removal', () => {
  const f = paidFixture(), old = f.engine.merchantOrder(f.own.order_id); f.catalog.splice(0); f.addresses.remove(f.address.address_id, 'delete');
  const shipped = f.engine.ship(f.own.order_id, shipping, 'ship'); assert.deepEqual(shipped.items, old.items); assert.deepEqual(shipped.address, old.address);
});
test('inconsistent shipping state and receipts block writes instead of overwriting the ledger', () => {
  for (const damage of ['fields', 'receipt']) {
    const f = paidFixture(); f.engine.ship(f.own.order_id, shipping, 'ship'); const data = JSON.parse(f.bytes());
    if (damage === 'fields') data.checkout.orders.find(o => o.order_id === f.own.order_id).shipped_at = null;
    else data.checkout.receipts.ship.request.tracking_no = 'WRONG';
    f.options.save(JSON.stringify(data)); const bytes = f.bytes(); assert.throws(() => f.engine.ship(f.own.order_id, shipping, 'ship'), hasCode('SERVICE_UNAVAILABLE')); assert.equal(f.bytes(), bytes);
  }
});
test('lost shipping response coalesces clicks, preserves original payload/key and blocks other transactions', async () => {
  const f = paidFixture(), keys = []; let lost = true;
  const store = new CommerceStore({}, () => 'ship-original', { ship: async (id, request, key) => { keys.push([key, { ...request }]); const result = f.engine.ship(id, request, key); if (lost) { lost = false; throw Error('response lost'); } return result; } });
  const input = { ...shipping }, first = store.ship(f.own.order_id, input); assert.equal(store.ship(f.own.order_id, input), first); input.tracking_no = 'changed later'; await assert.rejects(first);
  assert.equal(store.getSnapshot().pending.kind, 'ship'); await assert.rejects(store.pay('payment'), hasCode('REQUEST_IN_PROGRESS')); await assert.rejects(store.ship(f.own.order_id, input), hasCode('REQUEST_IN_PROGRESS'));
  const writes = f.writes(), result = await store.retry(); assert.equal(result.status, 'PENDING_RECEIPT'); assert.equal(f.writes(), writes); assert.deepEqual(keys, [['ship-original', shipping], ['ship-original', shipping]]);
  assert.equal(store.getSnapshot().pending, null); assert.equal(store.getSnapshot().busy, false);
});
test('definitive shipping failure permits corrected logistics with a fresh key', async () => {
  const f = paidFixture(); let seq = 0;
  const store = new CommerceStore({}, () => `ship-${++seq}`, { ship: async (id, request, key) => f.engine.ship(id, request, key) }); f.failSave(true);
  await assert.rejects(store.ship(f.own.order_id, shipping), hasCode('SERVICE_UNAVAILABLE')); assert.equal(store.getSnapshot().pending, null); f.failSave(false);
  assert.equal((await store.ship(f.own.order_id, { ...shipping, tracking_no: 'CORRECTED' })).tracking_no, 'CORRECTED');
});
test('retryable shipping failure before a write still confirms the original operation', async () => {
  const f = paidFixture(), keys = []; let fail = true;
  const store = new CommerceStore({}, () => 'original', { ship: async (id, request, key) => { keys.push(key); if (fail) { fail = false; throw new CommerceError('SERVICE_UNAVAILABLE', 'unknown', true); } return f.engine.ship(id, request, key); } });
  await assert.rejects(store.ship(f.own.order_id, shipping)); assert.equal(f.engine.merchantOrder(f.own.order_id).status, 'PENDING_SHIPMENT');
  await store.retry(); assert.deepEqual(keys, ['original', 'original']); assert.equal(f.engine.merchantOrder(f.own.order_id).status, 'PENDING_RECEIPT');
});


test('persisted logistics field order does not change idempotent shipping semantics', () => {
  const f = paidFixture(), shipped = f.engine.ship(f.own.order_id, shipping, 'ship'), data = JSON.parse(f.bytes());
  data.checkout.receipts.ship.request = { tracking_no: shipping.tracking_no, shipping_carrier: shipping.shipping_carrier };
  f.options.save(JSON.stringify(data)); const bytes = f.bytes(), writes = f.writes();
  assert.deepEqual(new MockCommerce(f.options).ship(f.own.order_id, shipping, 'ship'), shipped); assert.equal(f.bytes(), bytes); assert.equal(f.writes(), writes);
});
