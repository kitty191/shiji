import test from 'node:test';
import assert from 'node:assert/strict';
import { MockCart } from '../src/mocks/cart.ts';
import { CartStore } from '../src/stores/cart.ts';
import { cartCheckState, cartItemTarget, cartSelectionSummary } from '../src/lib/cart.ts';
import { buyerContextPath, cartPath, productReturnPath } from '../src/lib/product.ts';
import { productDetails } from '../src/mocks/product.ts';

function fixture() {
  let id = 0;
  const catalog = structuredClone(productDetails);
  const cart = new MockCart({ catalog: () => catalog, id: () => `row-${++id}` });
  cart.add({ sku_id: 'lamp_white-usb', quantity: 2 }, 'lamp');
  cart.add({ sku_id: 'lamp_white-battery', quantity: 1 }, 'battery');
  cart.add({ sku_id: 'keyboard_ivory', quantity: 1 }, 'keyboard');
  return { catalog, cart };
}
const allItems = view => view.groups.flatMap(group => group.items);

test('cart selection counts rows, quantities, stores and actual SKU amounts separately', () => {
  const { cart } = fixture(), view = cart.read(), items = allItems(view);
  assert.deepEqual(cartSelectionSummary(view, {}), { item_count: 3, quantity_total: 4, store_count: 2, amount: 32600 });
  assert.deepEqual(cartSelectionSummary(view, { [items[0].item_id]: false, [items[2].item_id]: false }), { item_count: 1, quantity_total: 1, store_count: 1, amount: 7900 });
  assert.deepEqual(cartSelectionSummary(view, Object.fromEntries(items.map(item => [item.item_id, false]))), { item_count: 0, quantity_total: 0, store_count: 0, amount: 0 });
});

test('partial group/global selection is mixed; unavailable items cannot make a group checked', () => {
  const { cart, catalog } = fixture();
  catalog.find(product => product.product_id === 'keyboard').skus[0].available_stock = 0;
  const view = cart.read(), items = allItems(view), choices = { [items[0].item_id]: false };
  assert.deepEqual(cartCheckState(items, choices), { checked: false, mixed: true, disabled: false });
  assert.deepEqual(cartCheckState(view.groups[0].items, choices), { checked: false, mixed: true, disabled: false });
  assert.deepEqual(cartCheckState(view.groups[1].items, {}), { checked: false, mixed: false, disabled: true });
  assert.equal(cartSelectionSummary(view, choices).amount, 7900);
  assert.deepEqual(cartCheckState([], {}), { checked: false, mixed: false, disabled: true });
});

test('a zero-cent quote is valid while missing quotes and all invalid statuses are excluded', () => {
  const { cart } = fixture(), view = cart.read(), original = allItems(view)[0];
  const statuses = ['INSUFFICIENT_STOCK', 'SOLD_OUT', 'SPEC_DISABLED', 'PRODUCT_OFF_SALE', 'NOT_AVAILABLE'];
  view.groups = [{ store: view.groups[0].store, items: [
    { ...original, item_id: 'free', unit_price: 0, line_amount: 0 },
    { ...original, item_id: 'missing-quote', unit_price: null, line_amount: null },
    ...statuses.map(status => ({ ...original, item_id: status, purchase_status: status, purchasable: false })),
  ] }];
  assert.deepEqual(cartSelectionSummary(view, {}), { item_count: 1, quantity_total: 2, store_count: 1, amount: 0 });
});

test('selection is frontend-only, survives reads, and cannot select invalid/unknown items', async () => {
  const { cart, catalog } = fixture(); let writes = 0;
  const store = new CartStore({ read: async () => cart.read(), add: async (body, key) => { writes++; return cart.add(body, key); } });
  await store.load(); const original = cart.read(), items = allItems(original);
  store.select([items[0].item_id], false);
  await store.load(); assert.equal(store.getSnapshot().choices[items[0].item_id], false);
  assert.equal(writes, 0); assert.deepEqual(cart.read(), original);
  catalog.find(product => product.product_id === 'keyboard').skus[0].available_stock = 0;
  await store.load(); store.select([items[2].item_id, 'unknown'], true);
  assert.equal(store.getSnapshot().choices[items[2].item_id], undefined);
  assert.equal(store.getSnapshot().choices.unknown, undefined);
  assert.equal(cartSelectionSummary(store.getSnapshot().view, store.getSnapshot().choices).amount, 7900);
});

test('group/global selection updates only requested purchasable rows without changing quantities', async () => {
  const { cart } = fixture(); const store = new CartStore({ read: async () => cart.read(), add: async (body, key) => cart.add(body, key) });
  await store.load(); const view = store.getSnapshot().view, ids = allItems(view).map(item => item.item_id);
  store.select(ids, false);
  store.select(view.groups[0].items.map(item => item.item_id), true);
  assert.equal(cartSelectionSummary(view, store.getSnapshot().choices).quantity_total, 3);
  assert.equal(cartCheckState(allItems(view), store.getSnapshot().choices).mixed, true);
  assert.equal(cart.read().quantity_total, 4);
});

test('adding an unchecked SKU selects that merged row while preserving choices on other rows', async () => {
  const { cart } = fixture(); const store = new CartStore({ read: async () => cart.read(), add: async (body, key) => cart.add(body, key) }, () => 're-add');
  await store.load(); const items = allItems(store.getSnapshot().view);
  store.select(items.map(item => item.item_id), false);
  await store.add({ sku_id: items[0].sku_id, quantity: 1 });
  assert.equal(store.getSnapshot().choices[items[0].item_id], true);
  assert.equal(store.getSnapshot().choices[items[1].item_id], false);
  assert.equal(cartSelectionSummary(store.getSnapshot().view, store.getSnapshot().choices).quantity_total, 3);
});

test('cart/detail return links preserve buyer filters without recursive or external destinations', () => {
  const buyer = '/buyer?keyword=台灯&sort=price_asc&feed_token=opaque%2B%2F%3D';
  const cart = cartPath(buyer);
  assert.equal(productReturnPath(cart), cart); assert.equal(buyerContextPath(cart), buyer);
  assert.equal(productReturnPath(buyer), buyer);
  for (const input of ['/cart?return_to=https%3A%2F%2Fevil.example', '/cart?return_to=%2Fcart%3Freturn_to%3D%252Fbuyer', '/cart?extra=ignored']) assert.equal(productReturnPath(input), '/cart');
  for (const input of [null, 'https://evil.example', '//evil.example', '/cart/other', '/cart?#/other', '/products/lamp']) assert.equal(productReturnPath(input), '/buyer');
});

test('cart navigation respects server scope/type and preserves the original SKU including retired choices', () => {
  const { cart } = fixture(), item = allItems(cart.read())[0];
  const target = cartItemTarget(item, '/cart');
  const query = new URLSearchParams(target.to.split('?')[1]);
  assert.equal(query.get('sku_id'), item.sku_id); assert.equal(query.get('return_to'), '/cart');
  assert.deepEqual(cartItemTarget({ ...item, navigation: { type: 'STORE', scope: 'PUBLIC', target_id: 'original-store' } }, '/cart'), { type: 'store' });
  assert.equal(cartItemTarget({ ...item, navigation: { type: 'NONE', scope: 'NONE', target_id: null } }, '/cart'), null);
  assert.equal(cartItemTarget({ ...item, navigation: { type: 'PRODUCT', scope: 'NONE', target_id: 'private' } }, '/cart'), null);
  const offSale = cartItemTarget({ ...item, navigation: { type: 'OFF_SALE_PRODUCT', scope: 'PUBLIC', target_id: item.product_id } }, '/cart');
  assert.equal(new URLSearchParams(offSale.to.split('?')[1]).get('sku_id'), item.sku_id);
});
