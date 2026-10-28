import test from 'node:test';
import assert from 'node:assert/strict';
import { MockCommerce } from '../src/mocks/commerce.ts';
import { MockCart } from '../src/mocks/cart.ts';
import { MockAddresses } from '../src/mocks/address.ts';
import { productDetails } from '../src/mocks/product.ts';
import { CommerceStore } from '../src/stores/commerce.ts';
import { CommerceError, buyerOrderPath, loadOrderDetail } from '../src/lib/commerce.ts';

const code = (value) => (error) => error.code === value;
const all = { status: '', order_no: '', page: 1, page_size: 12, keyword: '' };
const shipping = { shipping_carrier: '演示物流', tracking_no: 'DEMO-RECEIVE-001' };
function fixture(mode = 'shipped') {
  let bytes = null,
    writes = 0,
    clock = 1000000,
    seq = 0,
    readBroken = false,
    saveBroken = false;
  const catalog = structuredClone(productDetails),
    addresses = new MockAddresses({ id: () => 'address', now: () => clock });
  const address = addresses.create(
    {
      recipient_name: '演示人',
      recipient_phone: '00000000000',
      province: '示例省',
      city: '示例市',
      district: '示例区',
      detail_address: '演示路一号',
    },
    'address',
  );
  const options = {
    catalog: () => catalog,
    addresses: () => addresses.read(),
    merchantStore: () => ({ store_id: 'store_home', name: '好物生活馆' }),
    load: () => {
      if (readBroken) throw Error('read');
      return bytes;
    },
    save: (value) => {
      if (saveBroken) throw Error('save');
      writes++;
      bytes = value;
    },
    id: () => `r-${++seq}`,
    now: () => clock,
    paymentMs: 1000,
  };
  const engine = new MockCommerce(options),
    cart = new MockCart({ ...options, catalog: () => engine.catalog() });
  const a = cart.add({ sku_id: 'lamp_white-usb', quantity: 1 }, 'lamp'),
    b = cart.add({ sku_id: 'keyboard_ivory', quantity: 1 }, 'keyboard');
  const payment = engine.submit(
    engine.preview({
      source: 'CART',
      cart_item_ids: [a.item_id, b.item_id],
      address_id: address.address_id,
    }).preview_token,
    'submit',
  );
  const id = payment.shop_orders.find((o) => o.store_id === 'store_home').order_id,
    sibling = payment.shop_orders.find((o) => o.order_id !== id).order_id;
  if (['paid', 'shipped'].includes(mode)) engine.pay(payment.payment_group_id, 'pay');
  if (mode === 'shipped') engine.ship(id, shipping, 'ship');
  return {
    engine,
    cart,
    options,
    catalog,
    addresses,
    address,
    payment,
    id,
    sibling,
    bytes: () => bytes,
    writes: () => writes,
    advance: (ms) => {
      clock += ms;
    },
    failRead: (value) => {
      readBroken = value;
    },
    failSave: (value) => {
      saveBroken = value;
    },
  };
}
test('receipt completes one store order and matching payment link in one write, preserving all snapshots and paid stock', () => {
  const f = fixture(),
    before = f.engine.order(f.id),
    sibling = f.engine.order(f.sibling),
    stock = f.engine.catalog(),
    cart = f.cart.read(),
    writes = f.writes();
  assert.deepEqual(before.allowed_actions, ['CONFIRM_RECEIPT']);
  f.advance(1);
  const result = f.engine.confirmReceipt(f.id, 'receive');
  assert.equal(f.writes(), writes + 1);
  assert.equal(result.status, 'COMPLETED');
  assert.ok(result.received_at);
  assert.deepEqual(result.allowed_actions, []);
  const { status, received_at, allowed_actions, ...rest } = result,
    { status: _s, received_at: _r, allowed_actions: _a, ...old } = before;
  assert.deepEqual(rest, old);
  assert.deepEqual(f.engine.order(f.sibling), sibling);
  assert.deepEqual(f.engine.catalog(), stock);
  assert.deepEqual(f.cart.read(), cart);
  const payment = f.engine.payment(f.payment.payment_group_id);
  assert.equal(payment.status, 'PAID');
  assert.equal(payment.total_amount, 18800);
  assert.equal(payment.shop_orders.find((o) => o.order_id === f.id).status, 'COMPLETED');
  assert.equal(
    payment.shop_orders.find((o) => o.order_id === f.sibling).status,
    'PENDING_SHIPMENT',
  );
  assert.equal(f.engine.orders({ ...all, status: 'COMPLETED' }).total, 1);
  assert.equal(f.engine.orders({ ...all, status: 'PENDING_RECEIPT' }).total, 0);
});
test('original receipt survives reload and payment deadline without writes or changing first receipt time', () => {
  const f = fixture(),
    result = f.engine.confirmReceipt(f.id, 'receive'),
    bytes = f.bytes(),
    writes = f.writes();
  f.advance(3000);
  assert.deepEqual(new MockCommerce(f.options).confirmReceipt(f.id, 'receive'), result);
  assert.equal(f.bytes(), bytes);
  assert.equal(f.writes(), writes);
  const reread = f.engine.order(f.id);
  reread.items[0].name = 'changed';
  assert.notEqual(f.engine.order(f.id).items[0].name, 'changed');
});
test('fresh receipt key on completed order records a replay without completing twice or overwriting timestamps', () => {
  const f = fixture(),
    result = f.engine.confirmReceipt(f.id, 'receive');
  f.advance(3000);
  const writes = f.writes();
  assert.deepEqual(new MockCommerce(f.options).confirmReceipt(f.id, 'fresh'), result);
  assert.equal(f.writes(), writes + 1);
  assert.equal(f.engine.order(f.id).received_at, result.received_at);
  assert.equal(f.engine.payment(f.payment.payment_group_id).status, 'PAID');
});
test('unpaid, paid-unshipped, cancelled and expired orders cannot confirm receipt or mutate storage', () => {
  for (const mode of ['unpaid', 'paid', 'cancelled', 'expired']) {
    const f = fixture(mode);
    if (mode === 'cancelled') f.engine.cancel(f.payment.payment_group_id, 'cancel');
    if (mode === 'expired') f.advance(1000);
    const bytes = f.bytes(),
      writes = f.writes();
    assert.throws(() => f.engine.confirmReceipt(f.id, 'receive'), code('INVALID_STATE'));
    assert.equal(f.bytes(), bytes);
    assert.equal(f.writes(), writes);
    assert.equal(f.engine.order(f.id).received_at, null);
  }
});
test('missing order and empty key reject receipt without writes', () => {
  const f = fixture(),
    bytes = f.bytes();
  assert.throws(() => f.engine.confirmReceipt('missing', 'receive'), code('NOT_FOUND'));
  assert.throws(() => f.engine.confirmReceipt(f.id, ''), code('INVALID_ARGUMENT'));
  assert.equal(f.bytes(), bytes);
});
test('receipt key cannot change target or action, and payment and shipping keys cannot confirm receipt', () => {
  const f = fixture();
  for (const key of ['submit', 'pay', 'ship'])
    assert.throws(() => f.engine.confirmReceipt(f.id, key), code('IDEMPOTENCY_CONFLICT'));
  f.engine.confirmReceipt(f.id, 'receive');
  const bytes = f.bytes();
  assert.throws(() => f.engine.confirmReceipt(f.sibling, 'receive'), code('IDEMPOTENCY_CONFLICT'));
  assert.throws(
    () => f.engine.pay(f.payment.payment_group_id, 'receive'),
    code('IDEMPOTENCY_CONFLICT'),
  );
  assert.throws(() => f.engine.ship(f.id, shipping, 'receive'), code('IDEMPOTENCY_CONFLICT'));
  assert.equal(f.bytes(), bytes);
});
test('receipt read and save failures keep order, payment and inventory unchanged; explicit retry succeeds', () => {
  for (const mode of ['read', 'save']) {
    const f = fixture(),
      bytes = f.bytes(),
      stock = f.engine.catalog();
    if (mode === 'read') f.failRead(true);
    else f.failSave(true);
    assert.throws(() => f.engine.confirmReceipt(f.id, 'receive'), code('SERVICE_UNAVAILABLE'));
    assert.equal(f.bytes(), bytes);
    f.failRead(false);
    f.failSave(false);
    assert.equal(f.engine.order(f.id).status, 'PENDING_RECEIPT');
    assert.equal(f.engine.order(f.id).received_at, null);
    assert.deepEqual(f.engine.catalog(), stock);
    assert.equal(f.engine.confirmReceipt(f.id, 'receive').status, 'COMPLETED');
  }
});
test('old shipped snapshots derive receipt action without writing and retain historical content after catalog/address removal', () => {
  const f = fixture(),
    data = JSON.parse(f.bytes());
  data.checkout.orders.find((o) => o.order_id === f.id).allowed_actions = [];
  f.options.save(JSON.stringify(data));
  const bytes = f.bytes(),
    old = f.engine.order(f.id);
  assert.deepEqual(old.allowed_actions, ['CONFIRM_RECEIPT']);
  assert.equal(f.bytes(), bytes);
  f.catalog.splice(0);
  f.addresses.remove(f.address.address_id, 'remove');
  const completed = f.engine.confirmReceipt(f.id, 'receive');
  assert.deepEqual(completed.items, old.items);
  assert.deepEqual(completed.address, old.address);
});
test('merchant sees completed state and receipt time while retaining scoped fields and immutable shipping replay', () => {
  const f = fixture(),
    result = f.engine.confirmReceipt(f.id, 'receive'),
    merchant = f.engine.merchantOrder(f.id),
    bytes = f.bytes();
  assert.equal(merchant.status, 'COMPLETED');
  assert.equal(merchant.received_at, result.received_at);
  assert.deepEqual(merchant.allowed_actions, []);
  assert.equal('payment_group_id' in merchant, false);
  assert.equal(f.engine.merchantOrders({ ...all, status: 'COMPLETED' }).total, 1);
  assert.equal(f.engine.ship(f.id, shipping, 'ship').status, 'COMPLETED');
  assert.equal(f.bytes(), bytes);
});
test('corrupt completion time or receipt links block further writes instead of overwriting orders', () => {
  for (const damage of ['time', 'target', 'group', 'premature']) {
    const f = fixture();
    f.engine.confirmReceipt(f.id, 'receive');
    const data = JSON.parse(f.bytes());
    if (damage === 'time') data.checkout.orders.find((o) => o.order_id === f.id).received_at = null;
    if (damage === 'target') data.checkout.receipts.receive.target = f.sibling;
    if (damage === 'group') data.checkout.receipts.receive.payment_group_id = 'missing';
    if (damage === 'premature')
      data.checkout.orders.find((o) => o.order_id === f.sibling).received_at =
        new Date().toISOString();
    f.options.save(JSON.stringify(data));
    const bytes = f.bytes();
    assert.throws(() => f.engine.confirmReceipt(f.id, 'receive'), code('SERVICE_UNAVAILABLE'));
    assert.equal(f.bytes(), bytes);
  }
});
test('lost receipt response coalesces clicks, preserves original target/key and blocks all other transactions', async () => {
  const f = fixture(),
    calls = [];
  let lost = true;
  const store = new CommerceStore(
    {
      confirmReceipt: async (id, key) => {
        calls.push([id, key]);
        const result = f.engine.confirmReceipt(id, key);
        if (lost) {
          lost = false;
          throw Error('lost response');
        }
        return result;
      },
    },
    () => 'original',
  );
  const first = store.confirmReceipt(f.id);
  assert.equal(store.confirmReceipt(f.id), first);
  await assert.rejects(first);
  assert.deepEqual(store.getSnapshot().pending, { kind: 'receive', orderId: f.id });
  for (const action of [
    () => store.confirmReceipt(f.sibling),
    () => store.pay('payment'),
    () => store.cancel('payment'),
    () => store.submit('preview'),
    () => store.ship(f.id, shipping),
  ])
    await assert.rejects(action(), code('REQUEST_IN_PROGRESS'));
  const writes = f.writes(),
    received = f.engine.order(f.id).received_at;
  f.advance(10);
  const result = await store.retry();
  assert.equal(result.received_at, received);
  assert.equal(f.writes(), writes);
  assert.deepEqual(calls, [
    [f.id, 'original'],
    [f.id, 'original'],
  ]);
  assert.equal(store.getSnapshot().pending, null);
  assert.equal(store.getSnapshot().busy, false);
  assert.equal(store.getSnapshot().revision, 1);
});
test('retryable receipt failure before write retains original key; repeated failures remain recoverable', async () => {
  const f = fixture(),
    keys = [];
  let failures = 2;
  const store = new CommerceStore(
    {
      confirmReceipt: async (id, key) => {
        keys.push(key);
        if (failures-- > 0) throw new CommerceError('SERVICE_UNAVAILABLE', 'unknown', true);
        return f.engine.confirmReceipt(id, key);
      },
    },
    () => 'original',
  );
  await assert.rejects(store.confirmReceipt(f.id));
  await assert.rejects(store.retry());
  assert.equal(f.engine.order(f.id).status, 'PENDING_RECEIPT');
  assert.equal((await store.retry()).status, 'COMPLETED');
  assert.deepEqual(keys, ['original', 'original', 'original']);
});
test('definitive receipt failure releases operation and permits a fresh-key explicit retry', async () => {
  const f = fixture(),
    keys = [];
  let seq = 0;
  const store = new CommerceStore(
    {
      confirmReceipt: async (id, key) => {
        keys.push(key);
        return f.engine.confirmReceipt(id, key);
      },
    },
    () => `key-${++seq}`,
  );
  f.failSave(true);
  await assert.rejects(store.confirmReceipt(f.id), code('SERVICE_UNAVAILABLE'));
  assert.equal(store.getSnapshot().pending, null);
  f.failSave(false);
  assert.equal((await store.confirmReceipt(f.id)).status, 'COMPLETED');
  assert.deepEqual(keys, ['key-1', 'key-2']);
});
test('buyer detail rechecks receipt between order/payment reads although payment remains PAID', async () => {
  const f = fixture(),
    old = f.engine.order(f.id);
  let calls = 0;
  f.engine.confirmReceipt(f.id, 'receive');
  const result = await loadOrderDetail(
    {
      order: async () => (++calls === 1 ? old : f.engine.order(f.id)),
      payment: async (id) => f.engine.payment(id),
    },
    f.id,
  );
  assert.equal(calls, 2);
  assert.equal(result.order.status, 'COMPLETED');
  assert.ok(result.order.received_at);
  assert.equal(result.payment.status, 'PAID');
});
test('receipt recovery links encode order IDs and preserve only buyer order-list context', () => {
  const list = '/orders?status=PENDING_RECEIPT&order_no=SJ123&page=2',
    path = buyerOrderPath('order/a?b', list + '&store_id=other');
  assert.equal(path.split('?')[0], '/orders/order%2Fa%3Fb');
  assert.equal(new URLSearchParams(path.slice(path.indexOf('?') + 1)).get('return_to'), list);
  for (const value of [null, 'https://example.com', '/merchant/orders', '/payments/pay'])
    assert.equal(buyerOrderPath('order', value), '/orders/order?return_to=%2Forders');
});
