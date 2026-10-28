import test from 'node:test';
import assert from 'node:assert/strict';
import { selectStoreProducts, storeProductsParams } from '../src/lib/store.ts';
import { buyerContextPath, productReturnPath, storePath } from '../src/lib/product.ts';
import { categories, products } from '../src/mocks/catalog.ts';
import { publicStores } from '../src/mocks/store.ts';

test('store catalog scopes by exact ID before pagination, even when display names match', () => {
  const source = structuredClone(products);
  source.find((p) => p.store.store_id === 'store_daily').store.name = '好物生活馆';
  const before = structuredClone(source),
    page = selectStoreProducts(source, 'store_home');
  assert.deepEqual(
    page.items.map((p) => p.product_id),
    ['lamp', 'box'],
  );
  assert.equal(page.total, 2);
  assert.equal(page.has_more, false);
  assert.ok(page.items.every((p) => p.store.store_id === 'store_home'));
  assert.equal('published_order' in page.items[0], false);
  assert.deepEqual(source, before);
  assert.equal(selectStoreProducts(source, 'store_unknown').total, 0);
});

test('first store page limits to 12 while retaining total and current price/stock', () => {
  const template = products.find((p) => p.store.store_id === 'store_home');
  const own = Array.from({ length: 15 }, (_, index) => ({
    ...structuredClone(template),
    product_id: `own-${index}`,
    published_order: index,
  }));
  own[0] = {
    ...own[0],
    display_price: 12345,
    min_price: 12345,
    max_price: 12345,
    stock_status: 'SOLD_OUT',
  };
  const page = selectStoreProducts(
    [...products.filter((p) => p.store.store_id !== 'store_home'), ...own],
    'store_home',
  );
  assert.equal(page.items.length, 12);
  assert.equal(page.page, 1);
  assert.equal(page.page_size, 12);
  assert.equal(page.total, 15);
  assert.equal(page.has_more, true);
  assert.equal(page.items[0].display_price, 12345);
  assert.equal(page.items[0].stock_status, 'SOLD_OUT');
  assert.equal(new Set(page.items.map((p) => p.product_id)).size, 12);
});

test('public store fixtures agree with product ownership and existing category IDs', () => {
  assert.equal(new Set(publicStores.map((s) => s.store_id)).size, publicStores.length);
  for (const store of publicStores) {
    assert.ok(categories.some((category) => category.category_id === store.main_category_id));
    assert.ok(store.description.length > 0);
    assert.ok(
      products
        .filter((p) => p.store.store_id === store.store_id)
        .every((p) => p.store.name === store.name),
    );
  }
  assert.ok(products.every((p) => publicStores.some((s) => s.store_id === p.store.store_id)));
});

test('store product request retains an opaque ID and always includes a bounded first page', () => {
  const id = 'store +&=/中文';
  const params = new URLSearchParams(storeProductsParams(id).toString());
  assert.equal(params.get('store_id'), id);
  assert.equal(params.get('page'), '1');
  assert.equal(params.get('page_size'), '12');
  assert.deepEqual([...params.keys()].sort(), ['page', 'page_size', 'store_id']);
});

test('store-to-detail return preserves the store and original buyer query without recursive destinations', () => {
  const buyer = '/buyer?keyword=%E5%8F%B0%E7%81%AF&feed_token=opaque%2B%2F%3D';
  const store = storePath('store_home', buyer);
  assert.equal(productReturnPath(store), store);
  assert.equal(buyerContextPath(store), buyer);
  assert.equal(storePath('store_home'), '/stores/store_home');
  assert.equal(productReturnPath('/stores/store_home?extra=ignored'), '/stores/store_home');
  for (const back of [
    'https://evil.example',
    '//evil.example',
    '/stores/store_daily',
    '/products/lamp',
    '/cart',
  ]) {
    assert.equal(
      productReturnPath(`/stores/store_home?${new URLSearchParams({ return_to: back })}`),
      '/stores/store_home',
    );
  }
  for (const invalid of [
    '/stores',
    '/stores/a/other',
    '/stores/a#other',
    '/stores/%ZZ',
    '/stores/%2E%2E',
    '/stores/.',
    'https://evil.example/stores/a',
  ]) {
    assert.equal(productReturnPath(invalid), '/buyer');
  }
});
