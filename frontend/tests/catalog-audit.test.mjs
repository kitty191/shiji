import test from 'node:test';
import assert from 'node:assert/strict';
import {
  centsToYuan,
  formatMoney,
  priceToCents,
  readQuery,
  selectProducts,
} from '../src/lib/catalog.ts';
import {
  isProductPage,
  isProductView,
  isRecommendationResult,
} from '../src/lib/catalogValidation.ts';
import { products } from '../src/mocks/catalog.ts';
import { productDetails, mockProductView } from '../src/mocks/product.ts';

const query = readQuery(new URLSearchParams());
const page = () => selectProducts(products, query);
const detail = () =>
  structuredClone(productDetails.find((product) => product.product_id === 'lamp'));

test('public home accepts mixed stores, empty matches and beyond-end pages without changing prices', () => {
  const data = page();
  const before = structuredClone(data);
  assert.equal(isProductPage(data, query), true);
  assert.deepEqual(data, before);
  assert.equal(isProductPage(selectProducts([], query), query), true);
  const beyond = { ...query, page: 999 };
  assert.equal(isProductPage(selectProducts(products, beyond), beyond), true);
});

test('public home rejects malformed lists, invalid cards and inconsistent pagination', () => {
  for (const data of [
    null,
    [],
    {},
    { ...page(), items: null },
    { ...page(), total: 0 },
    { ...page(), has_more: true },
    { ...page(), page_size: 50 },
    { ...page(), items: [null] },
    { ...page(), feed_token: {} },
    {
      ...page(),
      items: page().items.map((item, index) => (index ? item : { ...item, store: null })),
    },
  ]) {
    assert.equal(isProductPage(data, query), false);
  }
  const duplicate = page();
  duplicate.items[1] = duplicate.items[0];
  assert.equal(isProductPage(duplicate, query), false);
});

test('all existing details and the minimal off-sale response match the public read contract', () => {
  for (const product of productDetails)
    assert.equal(isProductView(product, product.product_id), true);
  const off = mockProductView('stand');
  assert.equal(isProductView(off, 'stand'), true);
  assert.equal(isProductView({ ...off, store: null }, 'stand'), false);
  assert.equal(isProductView(detail(), 'another-product'), false);
});

test('malformed nested detail arrays are rejected before rendering', () => {
  for (const patch of [
    { images: null },
    { images: [null] },
    { dimensions: null },
    { dimensions: [null] },
    { skus: null },
    { skus: [null] },
    { attributes: null },
    { attributes: [null] },
    { published_at: 'yesterday' },
    { description: null },
  ]) {
    assert.equal(isProductView({ ...detail(), ...patch }, 'lamp'), false);
  }
  for (const mutate of [
    (p) => (p.dimensions[0].values = null),
    (p) => (p.dimensions[0].values[0] = null),
    (p) => (p.skus[0].spec_values = null),
    (p) => (p.skus[0].spec_values[0] = null),
    (p) => (p.skus[0].price = 1.5),
    (p) => (p.skus[0].available_stock = -1),
    (p) => (p.skus[0].currency = 'USD'),
    (p) => (p.images[0].url = {}),
    (p) => (p.attributes[0].value = {}),
  ]) {
    const product = detail();
    mutate(product);
    assert.equal(isProductView(product, 'lamp'), false);
  }
});

test('duplicate gallery, dimension, value and SKU identities cannot reach keyed controls', () => {
  for (const mutate of [
    (p) => p.images.push(p.images[0]),
    (p) => p.dimensions.push(p.dimensions[0]),
    (p) => p.dimensions[0].values.push(p.dimensions[0].values[0]),
    (p) => p.skus.push(p.skus[0]),
  ]) {
    const product = detail();
    mutate(product);
    assert.equal(isProductView(product, 'lamp'), false);
  }
});

test('detail validation preserves sold-out selection, absent image bindings and incomplete combinations', () => {
  const product = detail();
  product.display_price_source = 'MERCHANT';
  product.display_price = 1;
  product.skus[0].image_id = 'retired-image';
  product.skus[0].image_url = null;
  product.skus[1].spec_values = [];
  const before = structuredClone(product);
  assert.equal(isProductView(product, 'lamp'), true);
  assert.deepEqual(product, before);
});

test('recommendations reject bad success data while accepting true empty results and nullable images', () => {
  const valid = { items: page().items.slice(0, 2), checked_at: new Date().toISOString() };
  assert.equal(isRecommendationResult(valid), true);
  assert.equal(isRecommendationResult({ ...valid, items: [] }), true);
  for (const candidate of [
    null,
    {},
    { ...valid, items: null },
    { ...valid, items: [null] },
    { ...valid, checked_at: 'bad' },
    { ...valid, items: [valid.items[0], valid.items[0]] },
  ])
    assert.equal(isRecommendationResult(candidate), false);
});

test('integer-cent display and edit roundtrips retain each cent at the safe integer boundary', () => {
  assert.equal(formatMoney(Number.MAX_SAFE_INTEGER), '90,071,992,547,409.91');
  assert.equal(formatMoney(Number.MAX_SAFE_INTEGER - 1), '90,071,992,547,409.9');
  assert.equal(formatMoney(Number.MAX_SAFE_INTEGER - 2), '90,071,992,547,409.89');
  for (const cents of [
    0,
    1,
    10,
    29,
    2990,
    5900,
    Number.MAX_SAFE_INTEGER - 2,
    Number.MAX_SAFE_INTEGER - 1,
    Number.MAX_SAFE_INTEGER,
  ])
    assert.equal(priceToCents(centsToYuan(cents)), cents);
  assert.equal(formatMoney(5900), '59');
  assert.equal(formatMoney(2990), '29.9');
  assert.equal(formatMoney(-1), '-0.01');
  assert.equal(formatMoney(-123456), '-1,234.56');
});
