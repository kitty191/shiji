import test from 'node:test';
import assert from 'node:assert/strict';
import { MockAddresses } from '../src/mocks/address.ts';
import { AddressStore } from '../src/stores/address.ts';
import { addressEditRequest } from '../src/lib/address.ts';

const sample = name => ({ recipient_name: name, recipient_phone: '00000000000', province: '示例省', city: '示例市', district: '示例区', detail_address: '虚构演示路 1 号' });
function fixture() {
  let snapshot = null, sequence = 0, time = 1000000, failSave = false, saves = 0;
  const options = { load: () => snapshot, save: value => { if (failSave) throw Error('quota'); snapshot = value; saves++; }, id: () => `address-${++sequence}`, now: () => time };
  const engine = new MockAddresses(options);
  const rows = ['演示甲', '演示乙', '演示丙'].map((name, i) => engine.create(sample(name), `seed-${i}`));
  const gateway = { read: async () => engine.read(), create: async (request, key) => engine.create(request, key), update: async (id, request, key) => engine.update(id, request, key), setDefault: async (id, key) => engine.setDefault(id, key) };
  let key = 0;
  return { engine, options, rows, gateway, key: () => `request-${++key}`, advance: () => { time += 1000; }, failSave: value => { failSave = value; }, snapshot: () => snapshot, saves: () => saves };
}
const defaultIds = items => items.filter(item => item.is_default).map(item => item.address_id);
const contacts = items => items.map(({ is_default, updated_at, edit_token, ...rest }) => rest);

test('switching defaults writes one snapshot, preserving contacts, IDs, creation times and ordering', () => {
  const f = fixture(), before = f.engine.read(), writes = f.saves(); f.advance();
  const result = f.engine.setDefault(f.rows[1].address_id, 'switch');
  const after = f.engine.read();
  assert.equal(f.saves(), writes + 1); assert.deepEqual(defaultIds(after), [f.rows[1].address_id]);
  assert.equal(result.is_default, true); assert.deepEqual(contacts(after), contacts(before));
  for (const index of [0, 1]) { assert.notEqual(after[index].edit_token, before[index].edit_token); assert.notEqual(after[index].updated_at, before[index].updated_at); }
  assert.deepEqual(after[2], before[2]); assert.deepEqual(new MockAddresses(f.options).read(), after);
});

test('setting the current default is a no-op and missing targets or empty keys leave all rows intact', () => {
  const f = fixture(), before = f.snapshot(), writes = f.saves(); f.advance();
  assert.deepEqual(f.engine.setDefault(f.rows[0].address_id, 'same'), f.rows[0]);
  assert.equal(f.saves(), writes); assert.equal(f.snapshot(), before);
  assert.throws(() => f.engine.setDefault('missing', 'missing'), e => e.code === 'NOT_FOUND');
  assert.throws(() => f.engine.setDefault('', 'empty'), e => e.code === 'INVALID_ARGUMENT');
  assert.throws(() => f.engine.setDefault(f.rows[1].address_id, ''), e => e.code === 'INVALID_ARGUMENT');
  assert.equal(f.snapshot(), before);
});

test('a failed snapshot write cannot leave zero or multiple defaults and the same key can retry', () => {
  const f = fixture(), before = f.snapshot(); f.failSave(true);
  assert.throws(() => f.engine.setDefault(f.rows[1].address_id, 'switch'), e => e.code === 'SERVICE_UNAVAILABLE');
  assert.equal(f.snapshot(), before); assert.deepEqual(defaultIds(f.engine.read()), [f.rows[0].address_id]);
  f.failSave(false); f.engine.setDefault(f.rows[1].address_id, 'switch');
  assert.deepEqual(defaultIds(f.engine.read()), [f.rows[1].address_id]);
});

test('default receipts replay without writing and reject reuse for another target or operation', () => {
  const f = fixture(), result = f.engine.setDefault(f.rows[1].address_id, 'switch'), writes = f.saves();
  assert.deepEqual(f.engine.setDefault(f.rows[1].address_id, 'switch'), result); assert.equal(f.saves(), writes);
  assert.throws(() => f.engine.setDefault(f.rows[2].address_id, 'switch'), e => e.code === 'IDEMPOTENCY_CONFLICT');
  assert.throws(() => f.engine.create(sample('其他'), 'switch'), e => e.code === 'IDEMPOTENCY_CONFLICT');
  assert.throws(() => f.engine.update(f.rows[1].address_id, addressEditRequest(sample('其他'), result.edit_token), 'switch'), e => e.code === 'IDEMPOTENCY_CONFLICT');
});

test('a later default switch invalidates stale edit versions for both affected addresses only', () => {
  const f = fixture(); f.engine.setDefault(f.rows[1].address_id, 'switch');
  for (const row of f.rows.slice(0, 2)) assert.throws(() => f.engine.update(row.address_id, addressEditRequest(sample('旧输入'), row.edit_token), `edit-${row.address_id}`), e => e.code === 'EDIT_CONFLICT');
  f.engine.update(f.rows[2].address_id, addressEditRequest(sample('更新第三条'), f.rows[2].edit_token), 'edit-third');
  assert.deepEqual(defaultIds(f.engine.read()), [f.rows[1].address_id]);
});

test('switches read the latest snapshot and preserve other-page edits and later created rows', () => {
  const f = fixture(), other = new MockAddresses({ ...f.options, id: () => 'external-address' });
  other.update(f.rows[1].address_id, addressEditRequest(sample('他页新名字'), f.rows[1].edit_token), 'external-edit');
  other.create({ ...sample('他页新地址'), is_default: true }, 'external-create');
  f.engine.setDefault(f.rows[1].address_id, 'switch');
  const after = f.engine.read(); assert.equal(after.length, 4); assert.equal(after[1].recipient_name, '他页新名字');
  assert.deepEqual(defaultIds(after), [f.rows[1].address_id]);
});

test('double clicks share one request and reject competing default, create or edit operations', async () => {
  const f = fixture(); let release, writes = 0; const gate = new Promise(resolve => { release = resolve; });
  const store = new AddressStore({ ...f.gateway, setDefault: async (id, key) => { writes++; await gate; return f.engine.setDefault(id, key); } }, f.key);
  await store.load(); const pending = store.setDefault(f.rows[1].address_id);
  assert.equal(store.setDefault(f.rows[1].address_id), pending);
  await assert.rejects(store.setDefault(f.rows[2].address_id), e => e.code === 'REQUEST_IN_PROGRESS');
  await assert.rejects(store.create(sample('其他')), e => e.code === 'REQUEST_IN_PROGRESS');
  await assert.rejects(store.update(f.rows[0].address_id, addressEditRequest(sample('其他'), f.rows[0].edit_token)), e => e.code === 'REQUEST_IN_PROGRESS');
  assert.deepEqual(defaultIds(store.getSnapshot().items), [f.rows[0].address_id]);
  release(); await pending; assert.equal(writes, 1); assert.deepEqual(defaultIds(store.getSnapshot().items), [f.rows[1].address_id]);
});

test('lost responses retain the original target and key; confirmation cannot undo a later switch', async () => {
  const f = fixture(); let lost = true; const calls = [];
  const store = new AddressStore({ ...f.gateway, setDefault: async (id, key) => { calls.push([id, key]); const result = f.engine.setDefault(id, key); if (lost) { lost = false; throw Error('lost response'); } return result; } }, f.key);
  await store.load(); await assert.rejects(store.setDefault(f.rows[1].address_id));
  assert.deepEqual(store.getSnapshot().pending, { kind: 'set-default', address_id: f.rows[1].address_id });
  await assert.rejects(store.load(), e => e.code === 'REQUEST_IN_PROGRESS');
  await assert.rejects(store.setDefault(f.rows[2].address_id), e => e.code === 'REQUEST_IN_PROGRESS');
  new MockAddresses(f.options).setDefault(f.rows[2].address_id, 'external');
  const latest = f.snapshot(); await store.retry();
  assert.deepEqual(calls, [calls[0], calls[0]]); assert.equal(f.snapshot(), latest);
  assert.deepEqual(defaultIds(store.getSnapshot().items), [f.rows[2].address_id]); assert.equal(store.getSnapshot().pending, null);
});

test('confirmed default with failed list read retries only the read, displaying the latest default', async () => {
  const f = fixture(); let writes = 0, failRead = false;
  const store = new AddressStore({ ...f.gateway, read: async () => { if (failRead) throw Error('read failed'); return f.engine.read(); }, setDefault: async (id, key) => { writes++; return f.engine.setDefault(id, key); } }, f.key);
  await store.load(); failRead = true; await assert.rejects(store.setDefault(f.rows[1].address_id));
  assert.match(store.getSnapshot().error, /默认设置已保存/);
  assert.deepEqual(defaultIds(store.getSnapshot().items), [f.rows[0].address_id]);
  f.engine.setDefault(f.rows[2].address_id, 'later'); failRead = false; await store.retry();
  assert.equal(writes, 1); assert.deepEqual(defaultIds(store.getSnapshot().items), [f.rows[2].address_id]);
});

test('definitive missing-target failure releases pending state and retry only refreshes the list', async () => {
  const f = fixture(); let writes = 0;
  const store = new AddressStore({ ...f.gateway, setDefault: async (id, key) => { writes++; return f.engine.setDefault(id, key); } }, f.key);
  await assert.rejects(store.setDefault(f.rows[1].address_id), e => e.code === 'REQUEST_IN_PROGRESS');
  await store.load(); await assert.rejects(store.setDefault('missing'), e => e.code === 'NOT_FOUND');
  assert.equal(store.getSnapshot().pending, null); await store.retry(); assert.equal(writes, 1);
  assert.deepEqual(defaultIds(store.getSnapshot().items), [f.rows[0].address_id]);
});
