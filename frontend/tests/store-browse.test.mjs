import test from 'node:test';
import assert from 'node:assert/strict';
import { changeQuery, readQuery } from '../src/lib/catalog.ts';
import { selectStoreProducts, storeProductsParams } from '../src/lib/store.ts';
import {
  buyerContextPath,
  productReturnPath,
  storeEntryPath,
  storePath,
} from '../src/lib/product.ts';
import { products } from '../src/mocks/catalog.ts';
const query = (params = '') => readQuery(new URLSearchParams(params));

test('combined store keyword, category and price filters cannot match another store', () => {
  const source = structuredClone(products);
  source.find((p) => p.store.store_id === 'store_daily').name = '台灯';
  source.find((p) => p.store.store_id === 'store_daily').store.name = '好物生活馆';
  const before = structuredClone(source);
  const page = selectStoreProducts(
    source,
    'store_home',
    query('keyword=台灯&category_id=category_home&min_price=0&max_price=6000'),
  );
  assert.deepEqual(
    page.items.map((p) => p.product_id),
    ['lamp'],
  );
  assert.equal(page.total, 1);
  assert.equal(selectStoreProducts(source, 'store_digital', query('keyword=台灯')).total, 0);
  assert.equal(
    selectStoreProducts(source, 'store_home', query('category_id=category_outdoor')).total,
    0,
  );
  assert.deepEqual(source, before);
});

test('store price and newest sorts use the existing catalog rules before paging', () => {
  assert.deepEqual(
    selectStoreProducts(products, 'store_home', query('sort=price_asc')).items.map(
      (p) => p.product_id,
    ),
    ['box', 'lamp'],
  );
  assert.deepEqual(
    selectStoreProducts(products, 'store_home', query('sort=price_desc')).items.map(
      (p) => p.product_id,
    ),
    ['lamp', 'box'],
  );
  assert.deepEqual(
    selectStoreProducts(products, 'store_daily', query('sort=newest')).items.map(
      (p) => p.product_id,
    ),
    ['notebook', 'pencil-case', 'mug'],
  );
});

test('scoped multi-page results keep total, order and has_more without duplicates', () => {
  const template = products.find((p) => p.store.store_id === 'store_home');
  const own = Array.from({ length: 25 }, (_, i) => ({
    ...structuredClone(template),
    product_id: `own-${i}`,
    display_price: 1000 + i,
    published_order: i,
  }));
  const source = [...products, ...own],
    q = { ...query('keyword=折叠台灯&sort=price_asc'), page_size: 50 };
  const pages = [1, 2, 3].map((page) => selectStoreProducts(source, 'store_home', { ...q, page }));
  assert.deepEqual(
    pages.map((p) => p.items.length),
    [12, 12, 2],
  );
  assert.deepEqual(
    pages.map((p) => p.total),
    [26, 26, 26],
  );
  assert.deepEqual(
    pages.map((p) => p.has_more),
    [true, true, false],
  );
  assert.equal(new Set(pages.flatMap((p) => p.items.map((i) => i.product_id))).size, 26);
  assert.ok(pages.flatMap((p) => p.items).every((p) => p.store.store_id === 'store_home'));
  const beyond = selectStoreProducts(source, 'store_home', { ...q, page: 999 });
  assert.equal(beyond.items.length, 0);
  assert.equal(beyond.total, 26);
  assert.equal(beyond.has_more, false);
});

test('API parameters retain combined filters and opaque feed while enforcing route store and 12 rows', () => {
  const q = {
    ...query(
      'keyword=灯&category_id=category_home&min_price=0&max_price=6000&sort=price_desc&page=2',
    ),
    page_size: 50,
    feed_token: 'opaque+/=#中文',
    store_id: 'other-store',
  };
  const params = new URLSearchParams(storeProductsParams('store_home', q).toString());
  assert.equal(params.get('store_id'), 'store_home');
  assert.equal(params.get('page_size'), '12');
  for (const [key, value] of Object.entries({
    keyword: '灯',
    category_id: 'category_home',
    min_price: '0',
    max_price: '6000',
    sort: 'price_desc',
    page: '2',
    feed_token: 'opaque+/=#中文',
  }))
    assert.equal(params.get(key), value);
  assert.equal(params.has('return_to'), false);
});

test('detail and checkout-normalized store returns keep all local filters and buyer context', () => {
  const buyer = '/buyer?keyword=原商城&feed_token=original%2B%2F%3D';
  const q = {
    ...query(
      'keyword=台灯&category_id=category_home&min_price=0&max_price=9999&sort=newest&page=2',
    ),
    feed_token: 'store:opaque+/=#中文',
  };
  const path = storePath('store_home', buyer, q);
  assert.equal(productReturnPath(path), path);
  assert.equal(buyerContextPath(path), buyer);
  assert.deepEqual(readQuery(new URLSearchParams(path.split('?')[1])), q);
  assert.equal(productReturnPath(path + '&store_id=other&extra=ignored'), path);
});

test('new store filters reset page and feed; paging retains feed; clearing preserves original buyer only', () => {
  const buyer = '/buyer?keyword=原商城',
    initial = { ...query('keyword=台灯&page=3'), feed_token: 'old-store-feed' };
  for (const patch of [
    { keyword: '收纳' },
    { category_id: 'category_home' },
    { min_price: 0 },
    { max_price: 6000 },
    { sort: 'price_asc' },
  ]) {
    const path = storePath('store_home', buyer, changeQuery(initial, patch)),
      restored = readQuery(new URLSearchParams(path.split('?')[1]));
    assert.equal(restored.page, 1);
    assert.equal(restored.feed_token, undefined);
    assert.equal(buyerContextPath(path), buyer);
  }
  assert.equal(changeQuery(initial, { page: 2 }).feed_token, 'old-store-feed');
  const cleared = storePath('store_home', buyer);
  assert.deepEqual(readQuery(new URLSearchParams(cleared.split('?')[1])), query());
  assert.equal(buyerContextPath(cleared), buyer);
});

test('same-store entry retains local query while a different store starts clean', () => {
  const buyer = '/buyer?sort=price_asc',
    path = storePath(
      'store_home',
      buyer,
      query('keyword=灯&sort=newest&page=2&feed_token=store-feed'),
    );
  assert.equal(storeEntryPath('store_home', path), path);
  assert.equal(storeEntryPath('store_daily', path), storePath('store_daily', buyer));
  assert.equal(storeEntryPath('store_home', 'https://evil.example'), '/stores/store_home');
});
