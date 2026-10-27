import test from 'node:test';
import assert from 'node:assert/strict';
import { MockMerchantDrafts } from '../src/mocks/merchantDraft.ts';
import { MockMerchantProducts, merchantCatalogSummaries } from '../src/mocks/merchantProduct.ts';
import { MerchantDraftStore } from '../src/stores/merchantDraft.ts';
import { CommerceError } from '../src/lib/commerce.ts';
import { draftFields, draftForm } from '../src/lib/merchantDraft.ts';
import { merchantDraftPath, merchantProductsReturnPath } from '../src/lib/merchantProduct.ts';
import { categories, products } from '../src/mocks/catalog.ts';
import { productDetails } from '../src/mocks/product.ts';
const hasCode = code => e => e.code === code;
const all = { keyword: '', sale_status: '', page: 1, page_size: 12 };
function fixture() {
  let bytes = null, seq = 0, clock = 1000000, writes = 0, failLoad = false, failSave = false, scope = { store_id: 'store_home', name: '好物生活馆' };
  const options = { store: () => scope, categories: () => categories, load: () => { if (failLoad) throw Error('load'); return bytes; }, save: v => { if (failSave) throw Error('save'); bytes = v; writes++; }, id: () => `new-${++seq}`, now: () => clock };
  const engine = new MockMerchantDrafts(options);
  return { engine, options, bytes: () => bytes, writes: () => writes, clock: n => { clock += n; }, scope: s => { scope = s; }, breakRead: v => { failLoad = v; }, breakSave: v => { failSave = v; }, corrupt: v => { bytes = v; } };
}
const request = (draft, fields = {}) => ({ edit_token: draft.edit_token, fields });
test('explicit create persists an empty draft; ordinary reads and a new engine never create another', () => {
  const f = fixture(); assert.deepEqual(f.engine.summaries(), []); const d = f.engine.create('create'); const bytes = f.bytes();
  assert.equal(d.sale_status, 'DRAFT'); assert.equal(d.published_at, null); assert.equal(d.title, null); assert.equal(d.display_price, null); assert.equal(d.sku_count, 0);
  assert.deepEqual(f.engine.draft(d.product_id), d); assert.deepEqual(new MockMerchantDrafts(f.options).draft(d.product_id), d); assert.equal(f.bytes(), bytes); assert.equal(f.writes(), 1);
});
test('save, reopen and save again preserve identity, creation time and one persisted row', () => {
  const f = fixture(), d = f.engine.create('create'); f.clock(100);
  const a = f.engine.save(d.product_id, request(d, { title: ' 草稿台灯 ', category_id: 'category_home', description: '简介', display_price_override: 1234 }), 'save').product;
  assert.equal(a.title, '草稿台灯'); assert.equal(a.display_price, 1234); assert.notEqual(a.edit_token, d.edit_token); assert.equal(a.created_at, d.created_at); assert.notEqual(a.updated_at, d.updated_at);
  const b = new MockMerchantDrafts(f.options).save(d.product_id, request(a, { description: '重新打开后修改' }), 'save2').product;
  assert.equal(b.title, a.title); assert.equal(b.product_id, d.product_id); assert.equal(b.created_at, d.created_at); assert.equal(f.engine.summaries().length, 1);
});
test('partial draft fields preserve omitted content and explicit null clears optional values', () => {
  const f = fixture(), d = f.engine.create('create'), a = f.engine.save(d.product_id, request(d, { title: 'title', description: 'desc', display_price_override: 0 }), 'a').product;
  const b = f.engine.save(d.product_id, request(a, { description: null, display_price_override: null }), 'b').product;
  assert.equal(b.title, 'title'); assert.equal(b.description, null); assert.equal(b.display_price, null); assert.equal(a.display_price, 0); assert.deepEqual(b.images, []); assert.deepEqual(b.skus, []);
});
test('drafts join only the private list and do not change public products or existing inventory', () => {
  const before = structuredClone(productDetails), publicBefore = structuredClone(products), f = fixture(), d = f.engine.create('c'); f.engine.save(d.product_id, request(d, { title: '新草稿' }), 's');
  const list = new MockMerchantProducts({ store: f.options.store, products: () => [...merchantCatalogSummaries(productDetails), ...f.engine.summaries()] });
  assert.equal(list.products(all).total, 3); assert.equal(list.products({ ...all, sale_status: 'DRAFT' }).total, 1); assert.equal(list.products({ ...all, sale_status: 'ON_SALE' }).total, 2);
  assert.deepEqual(productDetails, before); assert.deepEqual(products, publicBefore); assert.equal(list.products({ ...all, keyword: '新草稿' }).items[0].product_id, d.product_id);
});
test('read/write scope is bound and foreign/missing or published IDs never become editable drafts', () => {
  const f = fixture(), d = f.engine.create('c'), bytes = f.bytes();
  for (const id of ['lamp', 'keyboard', 'missing']) { assert.throws(() => f.engine.draft(id), hasCode('NOT_FOUND')); assert.throws(() => f.engine.save(id, request(d), 's'), hasCode('NOT_FOUND')); }
  f.scope(null); assert.throws(() => f.engine.create('c'), hasCode('FORBIDDEN')); assert.throws(() => f.engine.draft(d.product_id), hasCode('FORBIDDEN')); assert.throws(() => f.engine.save(d.product_id, request(d), 's'), hasCode('FORBIDDEN')); assert.equal(f.bytes(), bytes);
});
test('old edit tokens reject without overwrite and explicit reload can update the same row', () => {
  const f = fixture(), d = f.engine.create('c'), a = f.engine.save(d.product_id, request(d, { title: 'other window' }), 'a').product, bytes = f.bytes();
  assert.throws(() => f.engine.save(d.product_id, request(d, { title: 'old input' }), 'b'), hasCode('EDIT_CONFLICT')); assert.equal(f.bytes(), bytes);
  assert.equal(f.engine.save(d.product_id, request(f.engine.draft(d.product_id), { title: 'after reload' }), 'b').product.product_id, a.product_id);
});
test('idempotent create and save replay original results without duplicating or rewinding later content', () => {
  const f = fixture(), d = f.engine.create('c'), a = f.engine.save(d.product_id, request(d, { title: 'first' }), 'a').product;
  const b = f.engine.save(d.product_id, request(a, { title: 'later' }), 'b').product, bytes = f.bytes(), count = f.writes();
  assert.deepEqual(f.engine.create('c'), d); assert.deepEqual(f.engine.save(d.product_id, request(d, { title: 'first' }), 'a').product, a);
  assert.equal(f.engine.draft(d.product_id).title, b.title); assert.equal(f.bytes(), bytes); assert.equal(f.writes(), count);
  assert.throws(() => f.engine.save(d.product_id, request(d, { title: 'changed' }), 'a'), hasCode('IDEMPOTENCY_CONFLICT'));
  assert.throws(() => f.engine.create('a'), hasCode('IDEMPOTENCY_CONFLICT'));
});
test('invalid category, money, field types and nonbasic writes reject atomically', () => {
  const f = fixture(), d = f.engine.create('c'), bytes = f.bytes();
  for (const fields of [{ category_id: 'missing' }, { title: 2 }, { display_price_override: -1 }, { display_price_override: 1.5 }, { display_price_override: Infinity }, { sku_count: 8 }, { sale_status: 'ON_SALE' }, { images: [] }, { store_id: 'foreign' }]) assert.throws(() => f.engine.save(d.product_id, request(d, fields), 'bad'), hasCode('INVALID_ARGUMENT'));
  assert.throws(() => f.engine.save(d.product_id, { ...request(d), skus: [] }, 'bad'), hasCode('INVALID_ARGUMENT')); assert.equal(f.bytes(), bytes);
});
test('storage errors and malformed snapshots remain errors and never fabricate empty state or overwrite data', () => {
  const f = fixture(), d = f.engine.create('c'), bytes = f.bytes(); f.breakSave(true);
  assert.throws(() => f.engine.save(d.product_id, request(d, { title: 'not saved' }), 's'), hasCode('SERVICE_UNAVAILABLE')); assert.throws(() => f.engine.create('next'), hasCode('SERVICE_UNAVAILABLE')); assert.equal(f.bytes(), bytes);
  f.breakSave(false); f.breakRead(true); assert.throws(() => f.engine.summaries(), hasCode('SERVICE_UNAVAILABLE')); f.breakRead(false);
  for (const corrupt of ['bad json', '{}', '{"version":1,"drafts":[],"receipts":null}']) { f.corrupt(corrupt); assert.throws(() => f.engine.create('next'), hasCode('SERVICE_UNAVAILABLE')); assert.equal(f.bytes(), corrupt); }
});
test('returned drafts and receipt results are cloned away from persisted state', () => {
  const f = fixture(), d = f.engine.create('c'); d.title = 'tamper'; d.images.push('tamper'); const read = f.engine.draft(d.product_id); read.description = 'changed';
  assert.equal(f.engine.draft(d.product_id).title, null); assert.deepEqual(f.engine.create('c').images, []);
});
test('form money handles empty, zero and cents without truncation or SKU constraints', () => {
  for (const price of ['', '0', '0.01', '12.34', '999.9', '90071992547409.91']) { const fields = draftFields({ title: '', description: '', category_id: '', price }); assert.deepEqual(draftFields(draftForm(fields)), fields); }
  for (const price of ['-1','1.234','abc','Infinity','9007199254740992']) assert.throws(() => draftFields({ title: '', description: '', category_id: '', price }), e => e.field === 'price');
  assert.equal(draftFields({ title: '', description: '', category_id: '', price: '0.01' }).display_price_override, 1);
});
test('editor return path preserves supported filters and rejects foreign or recursive targets', () => {
  const back = '/merchant/products?keyword=%E8%8D%89%E7%A8%BF&sale_status=DRAFT&page=2'; const path = merchantDraftPath('a/b?c', back);
  assert.equal(new URLSearchParams(path.split('?')[1]).get('return_to'), back); assert.match(path, /^\/merchant\/products\/a%2Fb%3Fc\/edit/);
  for (const target of ['https://example.com','/buyer','/merchant/products/a/edit','/merchant/products#bad']) assert.equal(merchantProductsReturnPath(target), '/merchant/products');
});
function coordination() {
  const f = fixture(); let postCreate = false, postSave = false, readBroken = false, createCalls = 0, saveCalls = 0;
  const gateway = { async create(key) { createCalls++; const d = f.engine.create(key); if (postCreate) throw Error('response lost'); return d; }, async save(id, body, key) { saveCalls++; const d = f.engine.save(id, body, key); if (postSave) throw Error('response lost'); return d; }, async draft(id) { if (readBroken) throw new CommerceError('SERVICE_UNAVAILABLE', 'read failed'); return f.engine.draft(id); } };
  const store = new MerchantDraftStore(gateway);
  return { f, store, gateway, postCreate: v => { postCreate = v; }, postSave: v => { postSave = v; }, readBroken: v => { readBroken = v; }, calls: () => [createCalls, saveCalls] };
}
test('coordinator confirms an unknown creation with the original key and creates only once', async () => {
  const c = coordination(); c.postCreate(true); await assert.rejects(c.store.create()); const key = c.store.getSnapshot().pending.key;
  await assert.rejects(c.store.create(), hasCode('REQUEST_IN_PROGRESS')); c.postCreate(false); const d = await c.store.retry();
  assert.equal(c.f.engine.create(key).product_id, d.product_id); assert.equal(c.f.engine.summaries().length, 1); assert.equal(c.f.writes(), 1); assert.equal(c.store.getSnapshot().pending, null);
});
test('coordinator preserves original unknown save payload and reads latest without replaying a new edit', async () => {
  const c = coordination(), d = await c.store.create(), fields = { title: 'original' }; c.postSave(true); await assert.rejects(c.store.save(d.product_id, request(d, fields))); fields.title = 'mutated';
  const saved = c.f.engine.draft(d.product_id); c.f.engine.save(d.product_id, request(saved, { description: 'later change' }), 'later');
  c.postSave(false); const current = await c.store.retry(); assert.equal(current.title, 'original'); assert.equal(current.description, 'later change'); assert.equal(c.f.engine.summaries().length, 1);
});
test('known success followed by repeated GET failure only retries reads', async () => {
  const c = coordination(); c.readBroken(true); await assert.rejects(c.store.create()); assert.ok(c.store.getSnapshot().confirmedId); const calls = c.calls();
  await assert.rejects(c.store.retry()); assert.deepEqual(c.calls(), calls); c.readBroken(false); await c.store.retry(); assert.deepEqual(c.calls(), calls); assert.equal(c.store.getSnapshot().revision, 1);
});
test('explicit save failure keeps the row unchanged and allows a new corrected request', async () => {
  const c = coordination(), d = await c.store.create(); c.f.breakSave(true); await assert.rejects(c.store.save(d.product_id, request(d, { title: 'fail' })), hasCode('SERVICE_UNAVAILABLE'));
  assert.equal(c.store.getSnapshot().pending, null); c.f.breakSave(false); const saved = await c.store.save(d.product_id, request(d, { title: 'corrected' })); assert.equal(saved.title, 'corrected');
});
test('in-flight operations reject a second write and settle busy state with one receipt', async () => {
  const c = coordination(); let release; const original = c.gateway.create; c.gateway.create = async key => { await new Promise(r => { release = r; }); return original(key); };
  const first = c.store.create(); assert.equal(c.store.getSnapshot().busy, true); await assert.rejects(c.store.create(), hasCode('REQUEST_IN_PROGRESS')); release(); await first;
  assert.equal(c.store.getSnapshot().busy, false); assert.equal(c.f.engine.summaries().length, 1);
});
