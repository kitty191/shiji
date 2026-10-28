import test from 'node:test';
import assert from 'node:assert/strict';
import {
  changeQuery,
  priceToCents,
  readQuery,
  queryParams,
  selectProducts,
} from '../src/lib/catalog.ts';
import { products } from '../src/mocks/catalog.ts';
const query = () => readQuery(new URLSearchParams());

test('yuan inputs become exact integer cents, with zero and empty distinct', () => {
  assert.equal(priceToCents('29.9'), 2990);
  assert.equal(priceToCents('0.29'), 29);
  assert.equal(priceToCents(' 0 '), 0);
  assert.equal(priceToCents(''), undefined);
  for (const value of ['-1', '1.234', '1e2', '12abc', 'Infinity', '9999999999999999'])
    assert.throws(() => priceToCents(value));
});
test('search/category/price filters combine, without mutating catalog or exposing mock-only fields', () => {
  const before = structuredClone(products);
  const result = selectProducts(products, {
    ...query(),
    keyword: '好物',
    category_id: 'category_home',
    min_price: 3000,
    max_price: 6000,
  });
  assert.deepEqual(
    result.items.map((p) => p.product_id),
    ['lamp'],
  );
  assert.equal('published_order' in result.items[0], false);
  assert.deepEqual(products, before);
});
test('store searches, sorts, and empty matches have deterministic results', () => {
  const ascending = selectProducts(products, {
    ...query(),
    keyword: '小橙数码',
    sort: 'price_asc',
  });
  assert.deepEqual(
    ascending.items.map((p) => p.product_id),
    ['mat', 'keyboard'],
  );
  const newest = selectProducts(products, { ...query(), sort: 'newest' });
  assert.equal(newest.items[0].product_id, 'bottle');
  assert.equal(selectProducts(products, { ...query(), keyword: '不存在的商品' }).total, 0);
});
test('pagination keeps catalog order and accurate has_more, including pages beyond the end', () => {
  const first = selectProducts(products, { ...query(), page_size: 4 });
  const second = selectProducts(products, { ...query(), page_size: 4, page: 2 });
  assert.equal(first.has_more, true);
  assert.equal(new Set([...first.items, ...second.items].map((p) => p.product_id)).size, 8);
  const last = selectProducts(products, { ...query(), page_size: 4, page: 3 });
  assert.equal(last.items.length, 1);
  assert.equal(last.has_more, false);
  assert.equal(selectProducts(products, { ...query(), page: 999 }).items.length, 0);
});
test('query parameters round-trip cents and reset malformed page/sort safely', () => {
  const original = {
    ...query(),
    keyword: '台灯 & 白色',
    min_price: 0,
    max_price: 2990,
    sort: 'price_asc',
    page: 2,
  };
  assert.deepEqual(readQuery(queryParams(original)), original);
  const malformed = readQuery(
    new URLSearchParams('page=-2&sort=garbage&min_price=1.5&max_price=9999999999999999999999'),
  );
  assert.equal(malformed.page, 1);
  assert.equal(malformed.sort, 'default');
  assert.equal(malformed.min_price, undefined);
  assert.equal(malformed.max_price, undefined);
});
test('opaque feed tokens survive URL encoding and page navigation', () => {
  const original = { ...query(), keyword: '台灯', feed_token: 'feed:abc+/=?#中文' };
  const second = changeQuery(original, { page: 2 });
  assert.deepEqual(readQuery(queryParams(second)), { ...original, page: 2 });
  const first = changeQuery(second, { page: 1 });
  assert.equal(readQuery(queryParams(first)).feed_token, original.feed_token);
  assert.equal(queryParams({ ...query(), feed_token: undefined }).has('feed_token'), false);
});
test('new filters, sort, or page size start a fresh feed instead of reusing old context', () => {
  const original = { ...query(), page: 3, feed_token: 'old_feed' };
  for (const patch of [
    { keyword: '台灯' },
    { category_id: 'category_home' },
    { min_price: 0 },
    { max_price: 6000 },
    { sort: 'newest' },
    { page_size: 24 },
  ]) {
    const next = changeQuery(original, patch);
    assert.equal(next.page, 1);
    assert.equal(next.feed_token, undefined);
  }
  assert.equal(changeQuery(original, { page: 2, sort: 'price_asc' }).feed_token, undefined);
});
