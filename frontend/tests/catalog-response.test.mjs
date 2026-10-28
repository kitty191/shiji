import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isCategoryResult,
  isPublicStore,
  isStoreProductPage,
} from '../src/lib/catalogValidation.ts';
import { readQuery } from '../src/lib/catalog.ts';
import { selectStoreProducts } from '../src/lib/store.ts';
import { categories, products } from '../src/mocks/catalog.ts';
import { publicStores } from '../src/mocks/store.ts';
const query = readQuery(new URLSearchParams());
const page = () => structuredClone(selectStoreProducts(products, 'store_home', query));

test('category responses accept empty lists and reject malformed or duplicate options', () => {
  assert.equal(isCategoryResult({ items: categories }), true);
  assert.equal(isCategoryResult({ items: [] }), true);
  for (const value of [
    null,
    [],
    {},
    { items: null },
    { items: {} },
    { items: [null] },
    { items: [{ ...categories[0], name: null }] },
    { items: [{ ...categories[0], sort_order: Infinity }] },
    { items: [categories[0], categories[0]] },
  ]) {
    assert.equal(isCategoryResult(value), false);
  }
});

test('public store validation keeps nullable or broken logo URLs as presentation data', () => {
  const store = structuredClone(publicStores.find((s) => s.store_id === 'store_home'));
  assert.equal(isPublicStore(store, 'store_home'), true);
  assert.equal(
    isPublicStore(
      { ...store, logo_url: '/missing-logo.png', name: '长名字'.repeat(100) },
      'store_home',
    ),
    true,
  );
  for (const value of [
    null,
    {},
    { ...store, store_id: 'store_daily' },
    { ...store, logo_url: undefined },
    { ...store, logo_url: {} },
    { ...store, description: null },
    { ...store, main_category_id: '' },
  ])
    assert.equal(isPublicStore(value, 'store_home'), false);
});

test('store page validation distinguishes genuine empty and beyond-end pages from invalid data', () => {
  assert.equal(isStoreProductPage(page(), 'store_home', query), true);
  const empty = { items: [], page: 1, page_size: 12, total: 0, has_more: false, feed_token: null };
  assert.equal(isStoreProductPage(empty, 'store_home', query), true);
  assert.equal(
    isStoreProductPage({ ...empty, page: 999, total: 2 }, 'store_home', { ...query, page: 999 }),
    true,
  );
  assert.equal(isStoreProductPage({ ...empty, total: 2 }, 'store_home', query), false);
});

test('store pagination metadata must match the requested page and bounded size without coercion', () => {
  for (const patch of [
    { total: null },
    { total: undefined },
    { total: -1 },
    { total: 1.5 },
    { total: Infinity },
    { total: Number.MAX_SAFE_INTEGER + 1 },
    { page: 2 },
    { page: '1' },
    { page_size: 24 },
    { has_more: 'false' },
    { feed_token: 1 },
    { items: null },
  ]) {
    assert.equal(isStoreProductPage({ ...page(), ...patch }, 'store_home', query), false);
  }
});

test('inconsistent totals, more flags, duplicate products and cross-store rows are rejected', () => {
  for (const patch of [
    { total: 1 },
    { total: 3 },
    { has_more: true },
    { items: [page().items[0], page().items[0]] },
  ])
    assert.equal(isStoreProductPage({ ...page(), ...patch }, 'store_home', query), false);
  const mixed = page();
  mixed.items[0].store.store_id = 'store_daily';
  assert.equal(isStoreProductPage(mixed, 'store_home', query), false);
});

test('malformed card fields cannot reach rendering or become a success empty state', () => {
  for (const patch of [
    { product_id: '' },
    { name: null },
    { category_id: '' },
    { cover_image: {} },
    { store: null },
    { display_price: -1 },
    { display_price: NaN },
    { display_price: Number.MAX_SAFE_INTEGER + 1 },
    { min_price: 10000, max_price: 100 },
    { currency: 'USD' },
    { display_price_source: 'OTHER' },
    { stock_status: 'UNKNOWN' },
  ]) {
    const candidate = page();
    candidate.items[0] = { ...candidate.items[0], ...patch };
    assert.equal(isStoreProductPage(candidate, 'store_home', query), false);
  }
  const candidate = page();
  candidate.items[0] = null;
  assert.equal(isStoreProductPage(candidate, 'store_home', query), false);
});

test('merchant display prices outside the SKU range and sold-out references remain valid and unchanged', () => {
  const candidate = page();
  candidate.items[0] = {
    ...candidate.items[0],
    display_price: 1,
    display_price_source: 'MERCHANT',
    stock_status: 'SOLD_OUT',
    cover_image: null,
  };
  const before = structuredClone(candidate);
  assert.equal(isStoreProductPage(candidate, 'store_home', query), true);
  assert.deepEqual(candidate, before);
});
