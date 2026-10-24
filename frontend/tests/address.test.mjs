import test from 'node:test';
import assert from 'node:assert/strict';
import { MockAddresses } from '../src/mocks/address.ts';
import { AddressStore } from '../src/stores/address.ts';
import { AddressError, addressPath, emptyAddress, normalizeAddress } from '../src/lib/address.ts';

const sample = (patch = {}) => ({ recipient_name: '演示收货人', recipient_phone: '00000000000', province: '示例省', city: '示例市', district: '示例区', detail_address: '好物路 1 号 演示楼 101 室', ...patch });
function fixture() {
  let snapshot = null, sequence = 0, failSave = false, failRead = false;
  const options = { load: () => { if (failRead) throw Error('read unavailable'); return snapshot; },
    save: value => { if (failSave) throw Error('quota'); snapshot = value; }, id: () => `address-${++sequence}`, now: () => 1000000 };
  const engine = new MockAddresses(options);
  const gateway = { read: async () => engine.read(), create: async (request, key) => engine.create(request, key) };
  let key = 0;
  return { engine, gateway, options, key: () => `request-${++key}`, setReadFailure: value => { failRead = value; },
    setSaveFailure: value => { failSave = value; }, setSnapshot: value => { snapshot = value; }, getSnapshot: () => snapshot };
}

test('address validation trims required fields and rejects malformed or oversized input', () => {
  assert.throws(() => normalizeAddress(emptyAddress()), error => Object.keys(error.fields).length === 6);
  assert.equal(normalizeAddress(sample({ recipient_name: ' 演示人 ' })).recipient_name, '演示人');
  assert.throws(() => normalizeAddress(sample({ recipient_phone: '123' })), error => !!error.fields.recipient_phone);
  assert.throws(() => normalizeAddress(sample({ detail_address: '字'.repeat(101) })), error => !!error.fields.detail_address);
  assert.throws(() => normalizeAddress(sample({ province: '   ' })), error => !!error.fields.province);
  assert.throws(() => normalizeAddress(sample({ is_default: 'false' })), error => error.code === 'INVALID_ARGUMENT');
});

test('first address is automatically default for omitted, false or true flags', () => {
  for (const flag of [undefined, false, true]) {
    const f = fixture();
    assert.equal(f.engine.create(sample({ is_default: flag }), 'create').is_default, true);
    assert.equal(new MockAddresses(f.options).read()[0].is_default, true);
  }
});

test('later omitted/false flags preserve the default; explicit true switches it atomically', () => {
  const f = fixture(); const first = f.engine.create(sample(), 'one');
  f.engine.create(sample({ recipient_name: '第二地址' }), 'two');
  f.engine.create(sample({ recipient_name: '第三地址', is_default: false }), 'three');
  assert.equal(f.engine.read().filter(item => item.is_default)[0].address_id, first.address_id);
  const fourth = f.engine.create(sample({ recipient_name: '第四地址', is_default: true }), 'four');
  assert.deepEqual(f.engine.read().filter(item => item.is_default).map(item => item.address_id), [fourth.address_id]);
});

test('save failure preserves previous address book/default and permits one successful retry', () => {
  const f = fixture(); const first = f.engine.create(sample(), 'one'); const before = f.getSnapshot();
  f.setSaveFailure(true);
  assert.throws(() => f.engine.create(sample({ is_default: true }), 'two'), error => error.code === 'SERVICE_UNAVAILABLE');
  assert.equal(f.getSnapshot(), before); assert.equal(f.engine.read()[0].address_id, first.address_id);
  f.setSaveFailure(false); f.engine.create(sample({ is_default: true }), 'two');
  assert.equal(f.engine.read().length, 2); assert.equal(f.engine.read().filter(item => item.is_default).length, 1);
});

test('corrupted or inaccessible storage is reported without replacing the saved snapshot', () => {
  const f = fixture(); f.setSnapshot('{bad');
  assert.throws(() => f.engine.read(), AddressError);
  assert.throws(() => f.engine.create(sample(), 'new'), AddressError); assert.equal(f.getSnapshot(), '{bad');
  f.setSnapshot(null); f.setReadFailure(true); assert.throws(() => f.engine.read(), AddressError);
});

test('duplicate request keys replay without duplicating; conflicting payload is rejected', () => {
  const f = fixture(); const first = f.engine.create(sample(), 'one');
  assert.deepEqual(f.engine.create(sample(), 'one'), first);
  assert.throws(() => f.engine.create(sample({ recipient_name: 'different' }), 'one'), error => error.code === 'IDEMPOTENCY_CONFLICT');
  assert.equal(f.engine.read().length, 1);
  first.recipient_name = 'mutated'; assert.equal(f.engine.read()[0].recipient_name, '演示收货人');
});

test('a second demo instance reads the latest snapshot before deciding the default', () => {
  const f = fixture(), second = new MockAddresses(f.options);
  f.engine.create(sample(), 'one'); second.create(sample(), 'two');
  assert.deepEqual(f.engine.read().map(item => item.is_default), [true, false]);
});

test('store coalesces read and duplicate saves, rejecting a different payload in flight', async () => {
  const f = fixture(); let release, writes = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const store = new AddressStore({ ...f.gateway, create: async (request, key) => { writes++; await gate; return f.engine.create(request, key); } }, f.key);
  const load = store.load(); assert.equal(store.load(), load); await load;
  const save = store.create(sample()); assert.equal(store.create(sample()), save);
  await assert.rejects(store.create(sample({ recipient_name: 'other' })), error => error.code === 'REQUEST_IN_PROGRESS');
  release(); await save; assert.equal(writes, 1); assert.equal(store.getSnapshot().items.length, 1);
});

test('unknown save retains original request/key and retry creates only one address', async () => {
  const f = fixture(); let lost = true; const keys = [];
  const store = new AddressStore({ ...f.gateway, create: async (request, key) => { keys.push(key); const result = f.engine.create(request, key); if (lost) { lost = false; throw Error('lost response'); } return result; } }, f.key);
  await store.load(); await assert.rejects(store.create(sample())); assert.ok(store.getSnapshot().pending);
  await assert.rejects(store.load(), error => error.code === 'REQUEST_IN_PROGRESS');
  await store.retry(); assert.deepEqual(keys, [keys[0], keys[0]]); assert.equal(store.getSnapshot().items.length, 1); assert.equal(store.getSnapshot().pending, null);
});

test('confirmed save with failed subsequent read retries only the read', async () => {
  const f = fixture(); let writes = 0, failRead = false;
  const store = new AddressStore({ read: async () => { if (failRead) throw Error('lost read'); return f.engine.read(); },
    create: async (request, key) => { writes++; return f.engine.create(request, key); } }, f.key);
  await store.load(); failRead = true; await assert.rejects(store.create(sample()));
  assert.match(store.getSnapshot().error, /已保存/); failRead = false; await store.retry();
  assert.equal(writes, 1); assert.equal(store.getSnapshot().items.length, 1);
});

test('definitive save rejection releases the request for corrected input', async () => {
  const f = fixture(), store = new AddressStore(f.gateway, f.key); await store.load(); f.setSaveFailure(true);
  await assert.rejects(store.create(sample())); assert.equal(store.getSnapshot().pending, null);
  f.setSaveFailure(false); await store.create(sample({ recipient_name: '重新提交' }));
  assert.equal(store.getSnapshot().items[0].recipient_name, '重新提交');
});

test('address navigation keeps buyer filters and rejects arbitrary or recursive returns', () => {
  const buyer = '/buyer?keyword=台灯&feed_token=opaque%2Btoken';
  assert.equal(new URLSearchParams(addressPath(buyer).split('?')[1]).get('return_to'), buyer);
  for (const path of ['https://example.org', '/addresses?return_to=/addresses', '/buyer#bad']) assert.equal(addressPath(path), '/addresses');
});
