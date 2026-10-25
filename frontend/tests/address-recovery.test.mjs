import test from 'node:test';
import assert from 'node:assert/strict';
import { MockAddresses } from '../src/mocks/address.ts';
import { AddressStore } from '../src/stores/address.ts';
import { AddressError, addressEditRequest } from '../src/lib/address.ts';

const sample = (name = '演示甲') => ({ recipient_name: name, recipient_phone: '00000000000', province: '示例省', city: '示例市', district: '示例区', detail_address: '虚构路 1 号' });
function fixture() {
  const engine = new MockAddresses(); let key = 0, readFails = false, writeFails = false, writes = 0, reads = 0;
  const gateway = {
    read: async () => { reads++; if (readFails) throw new AddressError('SERVICE_UNAVAILABLE', '读取失败'); return engine.read(); },
    create: async (request, key) => { writes++; if (writeFails) throw new AddressError('SERVICE_UNAVAILABLE', '保存失败'); return engine.create(request, key); },
    update: async (id, request, key) => { writes++; if (writeFails) throw new AddressError('SERVICE_UNAVAILABLE', '保存失败'); return engine.update(id, request, key); },
    setDefault: async (id, key) => { writes++; if (writeFails) throw new AddressError('SERVICE_UNAVAILABLE', '默认设置失败'); return engine.setDefault(id, key); },
  };
  const store = new AddressStore(gateway, () => `request-${++key}`);
  return { engine, store, gateway, readFails: value => { readFails = value; }, writeFails: value => { writeFails = value; }, writes: () => writes, reads: () => reads };
}

test('initial read failure remains an error until a successful retry and never writes an empty book', async () => {
  const f = fixture(); f.engine.create(sample(), 'seed'); f.readFails(true);
  await assert.rejects(f.store.load()); assert.equal(f.store.getSnapshot().status, 'error');
  f.store.clearFeedback(); assert.equal(f.store.getSnapshot().error, '读取失败');
  f.readFails(false); await f.store.retry(); assert.equal(f.writes(), 0);
  assert.equal(f.store.getSnapshot().status, 'ready'); assert.equal(f.store.getSnapshot().items.length, 1);
});

test('known create failure can retry the write once and clears its failure metadata on success', async () => {
  const f = fixture(); await f.store.load(); f.writeFails(true);
  await assert.rejects(f.store.create(sample()));
  assert.equal(f.store.getSnapshot().pending, null); assert.equal(f.store.getSnapshot().failedOperation.kind, 'create');
  assert.equal(f.store.getSnapshot().writeConfirmed, false);
  f.writeFails(false); await f.store.retry();
  assert.equal(f.writes(), 2); assert.equal(f.store.getSnapshot().items.length, 1);
  assert.equal(f.store.getSnapshot().failedOperation, null); assert.equal(f.store.getSnapshot().error, null);
});

test('corrected draft replaces a definitively rejected edit, retaining identity and current default', async () => {
  const f = fixture(), row = f.engine.create(sample(), 'seed'); await f.store.load(); f.writeFails(true);
  await assert.rejects(f.store.update(row.address_id, addressEditRequest(sample('失败输入'), row.edit_token)));
  f.writeFails(false); await f.store.update(row.address_id, addressEditRequest(sample('纠正后输入'), row.edit_token));
  const items = f.store.getSnapshot().items; assert.equal(items.length, 1); assert.equal(items[0].address_id, row.address_id);
  assert.equal(items[0].recipient_name, '纠正后输入'); assert.equal(items[0].is_default, true); assert.equal(f.store.getSnapshot().failedOperation, null);
});

test('default failure retries the original target without creating or editing addresses', async () => {
  const f = fixture(); f.engine.create(sample(), 'seed'); const second = f.engine.create(sample('演示乙'), 'seed-two');
  await f.store.load(); f.writeFails(true); await assert.rejects(f.store.setDefault(second.address_id));
  assert.deepEqual(f.store.getSnapshot().failedOperation, { kind: 'set-default', address_id: second.address_id });
  f.writeFails(false); await f.store.retry(); assert.equal(f.writes(), 2);
  assert.equal(f.store.getSnapshot().items.length, 2);
  assert.deepEqual(f.store.getSnapshot().items.filter(row => row.is_default).map(row => row.address_id), [second.address_id]);
});

test('discarding a known failed form clears retry intent so a later retry cannot resubmit discarded input', async () => {
  const f = fixture(); await f.store.load(); f.writeFails(true); await assert.rejects(f.store.create(sample()));
  f.store.clearFeedback(); assert.equal(f.store.getSnapshot().failedOperation, null); assert.equal(f.store.getSnapshot().error, null);
  f.writeFails(false); await f.store.retry(); assert.equal(f.writes(), 1); assert.equal(f.store.getSnapshot().items.length, 0);
});

test('ordinary reload clears a known failed operation and stale success notice', async () => {
  const f = fixture(); await f.store.load(); await f.store.create(sample()); assert.ok(f.store.getSnapshot().notice);
  await f.store.load(); assert.equal(f.store.getSnapshot().notice, null);
  f.writeFails(true); await assert.rejects(f.store.create(sample('演示乙'))); await f.store.load();
  assert.equal(f.store.getSnapshot().failedOperation, null);
  f.writeFails(false); await f.store.retry(); assert.equal(f.writes(), 2); assert.equal(f.store.getSnapshot().items.length, 1);
});

test('confirmed write exposes read-only recovery and repeated read failures never send another mutation', async () => {
  const f = fixture(); await f.store.load(); f.readFails(true); await assert.rejects(f.store.create(sample()));
  assert.equal(f.store.getSnapshot().writeConfirmed, true); assert.equal(f.store.getSnapshot().failedOperation, null);
  f.store.clearFeedback(); assert.ok(f.store.getSnapshot().pending); await assert.rejects(f.store.retry());
  assert.equal(f.writes(), 1); assert.equal(f.store.getSnapshot().writeConfirmed, true);
  f.readFails(false); await f.store.retry(); assert.equal(f.writes(), 1);
  assert.equal(f.store.getSnapshot().items.length, 1); assert.equal(f.store.getSnapshot().writeConfirmed, false);
});

test('unknown write cannot be cleared or changed, and replay still recovers the original request', async () => {
  const f = fixture(); let lost = true;
  const store = new AddressStore({ ...f.gateway, create: async (request, key) => { const row = await f.gateway.create(request, key); if (lost) { lost = false; throw Error('lost'); } return row; } });
  await store.load(); await assert.rejects(store.create(sample())); store.clearFeedback();
  assert.equal(store.getSnapshot().pending.kind, 'create'); assert.equal(store.getSnapshot().failedOperation, null); assert.equal(store.getSnapshot().writeConfirmed, false);
  await assert.rejects(store.create(sample('改过输入')), e => e.code === 'REQUEST_IN_PROGRESS');
  await store.retry(); assert.equal(store.getSnapshot().items.length, 1); assert.equal(store.getSnapshot().items[0].recipient_name, '演示甲');
});

test('a retry that discovers an edit conflict releases write retry and requires reading instead of overwriting', async () => {
  const f = fixture(), row = f.engine.create(sample(), 'seed'); await f.store.load(); f.writeFails(true);
  await assert.rejects(f.store.update(row.address_id, addressEditRequest(sample('原输入'), row.edit_token)));
  f.engine.update(row.address_id, addressEditRequest(sample('另一页面'), row.edit_token), 'external'); f.writeFails(false);
  await assert.rejects(f.store.retry(), e => e.code === 'EDIT_CONFLICT'); assert.equal(f.store.getSnapshot().failedOperation, null);
  await f.store.retry(); assert.equal(f.writes(), 2); assert.equal(f.store.getSnapshot().items[0].recipient_name, '另一页面');
});
