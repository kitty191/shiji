import test from 'node:test';
import assert from 'node:assert/strict';
import { buyerReturnPath, galleryFrames, normalizeProductParams, productQuantity, quantityLimit, selectedSku, skuFrame, skuLabel } from '../src/lib/product.ts';
import { productDetails, mockProductView } from '../src/mocks/product.ts';

const lamp = () => structuredClone(productDetails.find(product => product.product_id === 'lamp'));

test('first visit selects the first complete in-stock SKU, skipping sold-out or invalid combinations', () => {
  const product = lamp();
  product.skus.unshift({ ...product.skus[0], sku_id: 'incomplete', spec_values: [] });
  product.skus[1].available_stock = 0;
  assert.equal(selectedSku(product, null).sku_id, 'lamp_white-battery');
  const duplicate = { ...product.skus[2], sku_id: 'duplicate', spec_values: [{ dimension_id: 'color', value_id: 'white' }, { dimension_id: 'color', value_id: 'white' }] };
  product.skus.unshift(duplicate);
  assert.equal(selectedSku(product, null).sku_id, 'lamp_white-battery');
});

test('explicit sold-out selection stays visible and an invalid SKU never silently switches selection', () => {
  const product = lamp();
  assert.equal(selectedSku(product, 'lamp_black-usb').status, 'SOLD_OUT');
  assert.equal(selectedSku(product, 'retired-sku'), undefined);
  assert.equal(selectedSku(product, ''), undefined);
  product.skus.forEach(sku => { sku.available_stock = 0; });
  assert.equal(selectedSku(product, null), undefined);
});

test('products without dimensions still select their available default SKU', () => {
  const product = productDetails.find(product => product.product_id === 'mug');
  assert.equal(selectedSku(product, null).sku_id, 'mug_default');
  assert.equal(skuLabel(product, selectedSku(product, null)), '默认规格');
  assert.equal(skuLabel(lamp(), lamp().skus[1]), '白色 · 充电版');
});

test('quantity cannot exceed selected inventory or 99 and unavailable SKUs disable quantity changes', () => {
  const product = lamp();
  const sku = product.skus[1];
  assert.equal(productQuantity('8', sku), 6);
  for (const raw of [null, '', '-1', '2.5', 'bad', 'Infinity']) assert.equal(productQuantity(raw, sku), 1);
  assert.equal(productQuantity('999', { ...sku, available_stock: 150 }), 99);
  assert.equal(quantityLimit(product.skus[2]), 0);
  assert.equal(productQuantity('3', product.skus[2]), 1);
  assert.equal(quantityLimit(undefined), 0);
});

test('gallery respects merchant image ordering without mutation and labels a synthetic crop honestly', () => {
  const product = lamp();
  const original = structuredClone(product);
  assert.deepEqual(galleryFrames(product).map(frame => [frame.label, frame.cropped]), [['商品主图', false], ['局部放大', true]]);
  assert.deepEqual(product, original);
  product.images.push({ image_id: 'first', url: '/first.jpg', sort_order: -1 });
  assert.deepEqual(galleryFrames(product).map(frame => frame.image_id), ['first', 'lamp-main']);
  product.images = []; product.cover_image = null;
  assert.deepEqual(galleryFrames(product), []);
});

test('SKU image binding falls back to main image when unbound or absent from this product gallery', () => {
  const product = lamp(), sku = product.skus[0];
  assert.equal(skuFrame(product, sku), undefined);
  assert.equal(skuFrame(product, { ...sku, image_id: 'missing' }), undefined);
  assert.equal(skuFrame(product, { ...sku, image_id: 'lamp-main' }), 'lamp-main');
});

test('return destinations retain opaque feed context but cannot navigate to arbitrary routes or origins', () => {
  const path = '/buyer?keyword=台灯&sort=price_asc&feed_token=opaque%2B%2F%3D';
  assert.equal(buyerReturnPath(path), path);
  for (const path of [null, 'https://example.com', '//example.com', '/products/lamp', '/buyer/other', '/buyer?#/other']) assert.equal(buyerReturnPath(path), '/buyer');
});

test('mock detail fixtures agree with list prices, have unique SKU IDs, and distinguish missing from off-sale', () => {
  const ids = [];
  for (const product of productDetails) {
    assert.equal(product.min_price, Math.min(...product.skus.filter(sku => sku.available_stock > 0).map(sku => sku.price)));
    assert.equal(product.max_price, Math.max(...product.skus.filter(sku => sku.available_stock > 0).map(sku => sku.price)));
    assert.equal(product.default_sku_id, selectedSku(product, null).sku_id);
    ids.push(...product.skus.map(sku => sku.sku_id));
  }
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(mockProductView('stand').view_status, 'OFF_SALE');
  assert.equal(mockProductView('not-found'), undefined);
});

test('an automatically selected SKU survives URL restoration even if it later sells out', () => {
  const product = lamp();
  const saved = normalizeProductParams(product, new URLSearchParams('quantity=3'));
  assert.equal(saved.get('sku_id'), 'lamp_white-usb');
  const changed = lamp();
  changed.skus[0].status = 'SOLD_OUT'; changed.skus[0].available_stock = 0;
  const restored = normalizeProductParams(changed, new URLSearchParams(saved.toString()));
  assert.equal(restored.get('sku_id'), 'lamp_white-usb');
  assert.equal(selectedSku(changed, restored.get('sku_id')).status, 'SOLD_OUT');
});

test('quantity reduced by stock is persisted and does not rebound when inventory recovers', () => {
  const product = lamp();
  const saved = normalizeProductParams(product, new URLSearchParams('sku_id=lamp_white-battery&quantity=6'));
  product.skus[1].available_stock = 2;
  const reduced = normalizeProductParams(product, saved);
  assert.equal(reduced.get('quantity'), '2');
  product.skus[1].available_stock = 6;
  const restored = normalizeProductParams(product, new URLSearchParams(reduced.toString()));
  assert.equal(restored.get('quantity'), '2');
  assert.equal(productQuantity(restored.get('quantity'), selectedSku(product, restored.get('sku_id'))), 2);
});

test('normalizing an invalid explicit SKU or an all-sold-out product never selects a replacement', () => {
  const product = lamp();
  const invalid = normalizeProductParams(product, new URLSearchParams('sku_id=retired&quantity=6'));
  assert.equal(invalid.get('sku_id'), 'retired'); assert.equal(invalid.get('quantity'), '1');
  product.skus.forEach(sku => { sku.status = 'SOLD_OUT'; sku.available_stock = 0; });
  const soldOut = normalizeProductParams(product, new URLSearchParams());
  assert.equal(soldOut.has('sku_id'), false);
  assert.equal(soldOut.get('quantity'), '1');
});

test('normalization preserves gallery and opaque return context without mutating the input', () => {
  const params = new URLSearchParams({ return_to: '/buyer?feed_token=opaque+/=#中文', image_id: 'lamp-main:crop', quantity: 'bad' });
  const before = params.toString();
  const normalized = normalizeProductParams(lamp(), params);
  assert.equal(params.toString(), before);
  assert.equal(normalized.get('return_to'), params.get('return_to'));
  assert.equal(normalized.get('image_id'), params.get('image_id'));
  assert.equal(normalized.get('quantity'), '1');
  assert.equal(normalizeProductParams(lamp(), normalized).toString(), normalized.toString());
});
