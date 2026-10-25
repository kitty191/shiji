import test from 'node:test';
import assert from 'node:assert/strict';
import { MockAddresses } from '../src/mocks/address.ts';
import { AddressStore } from '../src/stores/address.ts';
import { addressEditRequest } from '../src/lib/address.ts';

const sample = (name, extra = {}) => ({ recipient_name: name, recipient_phone: '00000000000', province: '示例省', city: '示例市', district: '示例区', detail_address: '默认规则回归虚构路', ...extra });
function fixture() {
  let snapshot = null, sequence = 0, writes = 0;
  const options = { load: () => snapshot, save: value => { snapshot = value; writes++; }, id: () => `address-${++sequence}`, now: () => 1000000 };
  const engine = new MockAddresses(options);
  const gateway = { read: async () => engine.read(), create: async (request, key) => engine.create(request, key), update: async (id, request, key) => engine.update(id, request, key), setDefault: async (id, key) => engine.setDefault(id, key), remove: async (id, key) => engine.remove(id, key) };
  let key = 0;
  return { engine, options, gateway, key: () => `request-${++key}`, snapshot: () => snapshot, setSnapshot: value => { snapshot = value; }, writes: () => writes };
}
const defaults = items => items.filter(row => row.is_default).map(row => row.recipient_name);

test('a full create/switch/edit/delete/recreate workflow keeps one default and stable remaining IDs at every step', async () => {
  const f = fixture(), store = new AddressStore(f.gateway, f.key), observed = [];
  store.subscribe(() => observed.push(store.getSnapshot().items)); await store.load();
  function check(names, defaultName) {
    const items = store.getSnapshot().items;
    assert.deepEqual(items.map(row => row.recipient_name), names);
    assert.deepEqual(defaults(items), defaultName ? [defaultName] : []);
    assert.deepEqual(new MockAddresses(f.options).read(), items);
    return items;
  }
  check([], null);
  await store.create(sample('演示甲', { is_default: false })); const firstId = check(['演示甲'], '演示甲')[0].address_id;
  await store.create(sample('演示乙')); const secondId = check(['演示甲', '演示乙'], '演示甲')[1].address_id;
  await store.create(sample('演示丙', { is_default: true })); const thirdId = check(['演示甲', '演示乙', '演示丙'], '演示丙')[2].address_id;
  await store.setDefault(secondId); check(['演示甲', '演示乙', '演示丙'], '演示乙');
  const second = store.getSnapshot().items[1];
  await store.update(secondId, addressEditRequest(sample('演示乙', { detail_address: '编辑后的虚构路', is_default: false }), second.edit_token));
  assert.equal(check(['演示甲', '演示乙', '演示丙'], '演示乙')[1].address_id, secondId);
  await store.remove(thirdId); check(['演示甲', '演示乙'], '演示乙');
  await store.remove(secondId); assert.equal(check(['演示甲'], '演示甲')[0].address_id, firstId);
  await store.remove(firstId); check([], null);
  await store.create(sample('重新新增', { is_default: false })); check(['重新新增'], '重新新增');
  for (const items of observed) assert.ok(defaults(items).length <= 1);
});

test('switching default away and back never makes the original stale edit version valid again', async () => {
  const f = fixture(), first = f.engine.create(sample('演示甲'), 'seed-a'), second = f.engine.create(sample('演示乙'), 'seed-b');
  const store = new AddressStore(f.gateway, f.key); await store.load();
  await store.setDefault(second.address_id); await store.setDefault(first.address_id);
  assert.deepEqual(defaults(store.getSnapshot().items), ['演示甲']);
  await assert.rejects(store.update(first.address_id, addressEditRequest(sample('旧表单输入'), first.edit_token)), e => e.code === 'EDIT_CONFLICT');
  assert.deepEqual(defaults(f.engine.read()), ['演示甲']); assert.equal(f.engine.read()[0].recipient_name, '演示甲');
  await store.load(); const latest = store.getSnapshot().items[0];
  await store.update(latest.address_id, addressEditRequest(sample('载入后编辑'), latest.edit_token));
  assert.deepEqual(defaults(store.getSnapshot().items), ['载入后编辑']);
});

test('a snapshot with multiple defaults is rejected without silent repair or destructive writes', () => {
  const f = fixture(); f.engine.create(sample('演示甲'), 'seed-a'); f.engine.create(sample('演示乙'), 'seed-b');
  const data = JSON.parse(f.snapshot()); data.items[1].is_default = true;
  const invalid = JSON.stringify(data), writes = f.writes(); f.setSnapshot(invalid);
  for (const action of [() => f.engine.read(), () => f.engine.create(sample('新增'), 'new'), () => f.engine.setDefault(data.items[0].address_id, 'switch'), () => f.engine.remove(data.items[0].address_id, 'delete')]) assert.throws(action, e => e.code === 'SERVICE_UNAVAILABLE');
  assert.equal(f.snapshot(), invalid); assert.equal(f.writes(), writes);
});

test('recovering a lost default-creating response cannot resurrect an address later deleted elsewhere', async () => {
  const f = fixture(); f.engine.create(sample('原地址'), 'seed'); let lost = true, lostId;
  const store = new AddressStore({ ...f.gateway, create: async (request, key) => { const row = f.engine.create(request, key); if (lost) { lost = false; lostId = row.address_id; throw Error('lost'); } return row; } }, f.key);
  await store.load(); await assert.rejects(store.create(sample('后来被删除', { is_default: true })));
  const other = new MockAddresses(f.options); other.remove(lostId, 'external-delete'); other.create(sample('最终默认', { is_default: true }), 'external-new');
  const current = f.snapshot(), writes = f.writes(); await store.retry();
  assert.equal(f.snapshot(), current); assert.equal(f.writes(), writes);
  assert.deepEqual(store.getSnapshot().items.map(row => row.recipient_name), ['原地址', '最终默认']);
  assert.deepEqual(defaults(store.getSnapshot().items), ['最终默认']);
  assert.equal(store.getSnapshot().items.some(row => row.address_id === lostId), false);
});
