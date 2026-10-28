import test from 'node:test';
import assert from 'node:assert/strict';
import { MockMerchantProducts, merchantCatalogSummaries } from '../src/mocks/merchantProduct.ts';
import {
  merchantProductParams,
  readMerchantProductQuery,
  isMerchantProduct,
} from '../src/lib/merchantProduct.ts';
import { productDetails } from '../src/mocks/product.ts';
import { MockCommerce } from '../src/mocks/commerce.ts';
import { MockAddresses } from '../src/mocks/address.ts';
const query = { keyword: '', sale_status: '', page: 1, page_size: 12 };
const scope = { store_id: 'store_home', name: '好物生活馆' };
const hasCode = (code) => (error) => error.code === code;
function fixture() {
  let store = scope,
    broken = false;
  const rows = merchantCatalogSummaries(structuredClone(productDetails));
  const list = new MockMerchantProducts({
    store: () => store,
    products: () => {
      if (broken) throw Error('failed read');
      return rows;
    },
  });
  return {
    list,
    rows,
    setStore: (s) => {
      store = s;
    },
    fail: (v) => {
      broken = v;
    },
  };
}
test('merchant product list scopes by bound store before filters and ignores forged ownership', () => {
  const f = fixture(),
    page = f.list.products(query);
  assert.equal(page.total, 2);
  assert.deepEqual(new Set(page.items.map((p) => p.product_id)), new Set(['lamp', 'box']));
  assert.ok(page.items.every((p) => p.store_id === scope.store_id));
  assert.deepEqual(f.list.products({ ...query, store_id: 'store_digital' }), page);
  assert.equal(f.list.products({ ...query, keyword: '键盘' }).total, 0);
});
test('ownership is required and missing ownership never falls back to all products', () => {
  const f = fixture();
  for (const store of [null, { store_id: '', name: 'x' }, { store_id: 'x', name: '' }]) {
    f.setStore(store);
    assert.throws(() => f.list.products(query), hasCode('FORBIDDEN'));
  }
});
test('keyword and sale status combine, including nullable incomplete drafts and restricted rows', () => {
  const f = fixture();
  const lamp = f.rows.find((p) => p.product_id === 'lamp');
  lamp.sale_status = 'OFF_SALE';
  lamp.platform_status = 'RESTRICTED';
  const draft = {
    ...lamp,
    product_id: 'draft',
    title: null,
    cover_image: null,
    sale_status: 'DRAFT',
    display_price: null,
    display_price_override: null,
    sku_count: 0,
    available_stock_total: 0,
    published_at: null,
  };
  f.rows.push(draft);
  assert.equal(f.list.products({ ...query, sale_status: 'OFF_SALE', keyword: ' 台灯 ' }).total, 1);
  assert.equal(f.list.products({ ...query, sale_status: 'ON_SALE', keyword: '台灯' }).total, 0);
  assert.equal(f.list.products({ ...query, sale_status: 'DRAFT' }).items[0].title, null);
  assert.equal(f.list.products(query).total, 3);
});
test('stable pagination counts scoped matches and handles final and beyond-end pages', () => {
  const f = fixture(),
    sample = f.rows.find((p) => p.product_id === 'lamp');
  f.rows.splice(
    0,
    f.rows.length,
    ...Array.from({ length: 25 }, (_, i) => ({
      ...sample,
      product_id: `own-${String(i).padStart(2, '0')}`,
    })),
    ...Array.from({ length: 4 }, (_, i) => ({
      ...sample,
      product_id: `foreign-${i}`,
      store_id: 'store_digital',
    })),
  );
  const pages = [1, 2, 3].map((page) => f.list.products({ ...query, page }));
  assert.deepEqual(
    pages.map((p) => p.items.length),
    [12, 12, 1],
  );
  assert.deepEqual(
    pages.map((p) => p.has_more),
    [true, true, false],
  );
  assert.ok(pages.every((p) => p.total === 25));
  assert.equal(new Set(pages.flatMap((p) => p.items.map((x) => x.product_id))).size, 25);
  assert.deepEqual(f.list.products(query), pages[0]);
  assert.equal(f.list.products({ ...query, page: 999 }).items.length, 0);
  assert.equal(f.list.products({ ...query, page: 999 }).total, 25);
  f.rows[24].updated_at = '2026-10-27T09:00:00+08:00';
  assert.equal(f.list.products(query).items[0].product_id, 'own-24');
});
test('only G01 summary fields are returned and responses cannot mutate source records', () => {
  const f = fixture(),
    before = structuredClone(f.rows),
    lamp = f.rows.find((p) => p.product_id === 'lamp');
  lamp.description = 'private';
  lamp.skus = ['private'];
  const row = f.list.products(query).items.find((p) => p.product_id === 'lamp');
  assert.deepEqual(
    Object.keys(row).sort(),
    [
      'product_id',
      'store_id',
      'title',
      'cover_image',
      'sale_status',
      'platform_status',
      'display_price_override',
      'display_price',
      'sku_count',
      'available_stock_total',
      'published_at',
      'updated_at',
      'edit_token',
    ].sort(),
  );
  row.title = 'changed';
  row.available_stock_total = 0;
  assert.equal(lamp.title, before.find((p) => p.product_id === 'lamp').title);
  assert.equal(lamp.available_stock_total, 14);
});
test('malformed owned records and duplicate IDs fail instead of showing success empty or invalid prices', () => {
  for (const patch of [
    { title: {} },
    { cover_image: 1 },
    { display_price: -1 },
    { display_price: NaN },
    { display_price_override: Infinity },
    { sku_count: 1.5 },
    { available_stock_total: Number.MAX_SAFE_INTEGER + 1 },
    { sale_status: 'DELETED' },
    { platform_status: 'UNKNOWN' },
    { updated_at: 'bad' },
  ]) {
    const f = fixture();
    Object.assign(
      f.rows.find((p) => p.product_id === 'lamp'),
      patch,
    );
    assert.throws(() => f.list.products(query), hasCode('SERVICE_UNAVAILABLE'));
  }
  const f = fixture();
  f.rows.push({ ...f.rows.find((p) => p.product_id === 'lamp') });
  assert.throws(() => f.list.products(query), hasCode('SERVICE_UNAVAILABLE'));
});
test('invalid query types, statuses and pagination reject before reading data', () => {
  const f = fixture();
  f.fail(true);
  for (const patch of [
    { keyword: null },
    { sale_status: null },
    { sale_status: 'RESTRICTED' },
    { page: 0 },
    { page: Infinity },
    { page: 1.5 },
    { page_size: 0 },
    { page_size: 51 },
  ])
    assert.throws(() => f.list.products({ ...query, ...patch }), hasCode('INVALID_ARGUMENT'));
});
test('read failures remain retryable errors and a true empty store has total zero', () => {
  const f = fixture(),
    before = structuredClone(f.rows);
  f.fail(true);
  for (let i = 0; i < 2; i++)
    assert.throws(() => f.list.products(query), hasCode('SERVICE_UNAVAILABLE'));
  f.fail(false);
  assert.equal(f.list.products(query).total, 2);
  assert.deepEqual(f.rows, before);
  f.rows.splice(0);
  assert.deepEqual(f.list.products(query), {
    items: [],
    page: 1,
    page_size: 12,
    total: 0,
    has_more: false,
  });
  const malformed = new MockMerchantProducts({ store: () => scope, products: () => null });
  assert.throws(() => malformed.products(query), hasCode('SERVICE_UNAVAILABLE'));
});
test('catalog adapter preserves merchant display prices, zero-price/null semantics and sold-out quantities', () => {
  const product = structuredClone(productDetails.find((p) => p.product_id === 'lamp'));
  product.display_price_source = 'MERCHANT';
  product.display_price = 1;
  product.skus.forEach((s) => {
    s.available_stock = 0;
    s.status = 'SOLD_OUT';
  });
  const row = merchantCatalogSummaries([product])[0];
  assert.equal(row.display_price_override, 1);
  assert.equal(row.display_price, 1);
  assert.equal(row.sku_count, 3);
  assert.equal(row.available_stock_total, 0);
  assert.equal(isMerchantProduct({ ...row, display_price: 0 }), true);
  assert.equal(isMerchantProduct({ ...row, display_price: null }), true);
});
test('URL query round-trips supported fields and fixes page size and store scope', () => {
  const q = readMerchantProductQuery(
    new URLSearchParams(
      'keyword=%E5%8F%B0%E7%81%AF%2B%26&sale_status=OFF_SALE&page=2&page_size=50&store_id=foreign&return_to=https://example.com',
    ),
  );
  assert.deepEqual(q, { keyword: '台灯+&', sale_status: 'OFF_SALE', page: 2, page_size: 12 });
  assert.deepEqual(readMerchantProductQuery(merchantProductParams(q)), q);
  assert.equal(merchantProductParams(q).has('store_id'), false);
  for (const page of ['0', '-1', '1.2', '2x', 'Infinity', '9007199254740992'])
    assert.equal(
      readMerchantProductQuery(new URLSearchParams({ page, sale_status: 'bad' })).page,
      1,
    );
  assert.deepEqual(readMerchantProductQuery(new URLSearchParams('sale_status=RESTRICTED')), query);
});
test('merchant inventory follows pending, cancelled and paid stock without list reads writing the ledger', () => {
  let bytes = null,
    writes = 0,
    seq = 0,
    clock = 1000000;
  const addresses = new MockAddresses({ id: () => 'addr', now: () => clock });
  const address = addresses.create(
    {
      recipient_name: '演示',
      recipient_phone: '00000000000',
      province: '省',
      city: '市',
      district: '区',
      detail_address: '示例路',
    },
    'create',
  );
  const engine = new MockCommerce({
    merchantStore: () => scope,
    catalog: () => productDetails,
    addresses: () => addresses.read(),
    load: () => bytes,
    save: (v) => {
      bytes = v;
      writes++;
    },
    now: () => clock,
    id: () => `id-${++seq}`,
    paymentMs: 1000,
  });
  const list = new MockMerchantProducts({
    store: () => scope,
    products: () => merchantCatalogSummaries(engine.catalog()),
  });
  const stock = () =>
    list.products(query).items.find((p) => p.product_id === 'lamp').available_stock_total;
  const direct = {
    source: 'DIRECT',
    items: [{ sku_id: 'lamp_white-usb', quantity: 1 }],
    address_id: address.address_id,
  };
  assert.equal(stock(), 14);
  const first = engine.submit(engine.preview(direct).preview_token, 'submit');
  assert.equal(stock(), 13);
  const before = bytes,
    count = writes;
  stock();
  assert.equal(bytes, before);
  assert.equal(writes, count);
  engine.cancel(first.payment_group_id, 'cancel');
  assert.equal(stock(), 14);
  const second = engine.submit(engine.preview(direct).preview_token, 'submit2');
  engine.pay(second.payment_group_id, 'pay');
  clock += 1001;
  assert.equal(stock(), 13);
});
