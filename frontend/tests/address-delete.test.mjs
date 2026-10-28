import test from 'node:test';
import assert from 'node:assert/strict';
import { MockAddresses } from '../src/mocks/address.ts';
import { AddressStore } from '../src/stores/address.ts';
import { addressEditRequest } from '../src/lib/address.ts';

const sample = (name) => ({
  recipient_name: name,
  recipient_phone: '00000000000',
  province: '示例省',
  city: '示例市',
  district: '示例区',
  detail_address: '虚构路 1 号',
});
function fixture(count = 3) {
  let snapshot = null,
    sequence = 0,
    time = 1000000,
    failSave = false,
    failRead = false,
    saves = 0;
  const options = {
    load: () => {
      if (failRead) throw Error('read failed');
      return snapshot;
    },
    save: (value) => {
      if (failSave) throw Error('quota');
      snapshot = value;
      saves++;
    },
    id: () => `address-${++sequence}`,
    now: () => time,
  };
  const engine = new MockAddresses(options),
    rows = ['演示甲', '演示乙', '演示丙']
      .slice(0, count)
      .map((name, i) => engine.create(sample(name), `seed-${i}`));
  const gateway = {
    read: async () => engine.read(),
    create: async (request, key) => engine.create(request, key),
    update: async (id, request, key) => engine.update(id, request, key),
    setDefault: async (id, key) => engine.setDefault(id, key),
    remove: async (id, key) => engine.remove(id, key),
  };
  let key = 0;
  return {
    engine,
    rows,
    gateway,
    options,
    key: () => `request-${++key}`,
    advance: () => {
      time += 1000;
    },
    failSave: (value) => {
      failSave = value;
    },
    failRead: (value) => {
      failRead = value;
    },
    snapshot: () => snapshot,
    saves: () => saves,
  };
}
const defaultIds = (items) =>
  items.filter((item) => item.is_default).map((item) => item.address_id);
const contact = ({ is_default, updated_at, edit_token, ...rest }) => rest;

test('deleting the default atomically selects the first remaining row, preserving contacts, IDs and order', () => {
  const f = fixture();
  f.engine.setDefault(f.rows[1].address_id, 'default-second');
  const before = f.engine.read(),
    saves = f.saves();
  f.advance();
  assert.deepEqual(f.engine.remove(f.rows[1].address_id, 'delete-second'), { deleted: true });
  const after = f.engine.read();
  assert.equal(f.saves(), saves + 1);
  assert.deepEqual(
    after.map((row) => row.address_id),
    [f.rows[0].address_id, f.rows[2].address_id],
  );
  assert.deepEqual(defaultIds(after), [f.rows[0].address_id]);
  assert.deepEqual(contact(after[0]), contact(before[0]));
  assert.notEqual(after[0].edit_token, before[0].edit_token);
  assert.notEqual(after[0].updated_at, before[0].updated_at);
  assert.deepEqual(after[1], before[2]);
  assert.deepEqual(new MockAddresses(f.options).read(), after);
});

test('deleting a non-default address preserves every remaining field and the existing default', () => {
  const f = fixture(),
    before = f.engine.read();
  f.engine.remove(f.rows[2].address_id, 'delete');
  assert.deepEqual(f.engine.read(), before.slice(0, 2));
  assert.deepEqual(defaultIds(f.engine.read()), [f.rows[0].address_id]);
});

test('deleting the last address persists an empty book, and the next created address is automatically default', () => {
  const f = fixture(1);
  f.engine.remove(f.rows[0].address_id, 'delete');
  assert.deepEqual(f.engine.read(), []);
  assert.deepEqual(new MockAddresses(f.options).read(), []);
  const next = f.engine.create(sample('重新新增'), 'new');
  assert.equal(next.is_default, true);
  assert.equal(f.engine.read().length, 1);
});

test('snapshot failure preserves the deleted target and old default and allows retry with the same key', () => {
  const f = fixture(),
    before = f.snapshot();
  f.failSave(true);
  assert.throws(
    () => f.engine.remove(f.rows[0].address_id, 'delete'),
    (e) => e.code === 'SERVICE_UNAVAILABLE',
  );
  assert.equal(f.snapshot(), before);
  assert.deepEqual(defaultIds(f.engine.read()), [f.rows[0].address_id]);
  f.failSave(false);
  f.engine.remove(f.rows[0].address_id, 'delete');
  assert.deepEqual(defaultIds(f.engine.read()), [f.rows[1].address_id]);
  assert.equal(f.engine.read().length, 2);
});

test('missing IDs, empty targets/keys and inaccessible snapshots never write or choose another target', () => {
  const f = fixture(),
    before = f.snapshot(),
    saves = f.saves();
  assert.throws(
    () => f.engine.remove('missing', 'delete'),
    (e) => e.code === 'NOT_FOUND',
  );
  assert.throws(
    () => f.engine.remove('', 'empty'),
    (e) => e.code === 'INVALID_ARGUMENT',
  );
  assert.throws(
    () => f.engine.remove(f.rows[0].address_id, ''),
    (e) => e.code === 'INVALID_ARGUMENT',
  );
  f.failRead(true);
  assert.throws(
    () => f.engine.remove(f.rows[0].address_id, 'unreadable'),
    (e) => e.code === 'SERVICE_UNAVAILABLE',
  );
  assert.equal(f.snapshot(), before);
  assert.equal(f.saves(), saves);
});

test('delete receipts replay before checking the missing row and reject key reuse across targets or operations', () => {
  const f = fixture(),
    result = f.engine.remove(f.rows[0].address_id, 'delete'),
    saves = f.saves();
  result.deleted = false;
  assert.deepEqual(f.engine.remove(f.rows[0].address_id, 'delete'), { deleted: true });
  assert.equal(f.saves(), saves);
  assert.throws(
    () => f.engine.remove(f.rows[1].address_id, 'delete'),
    (e) => e.code === 'IDEMPOTENCY_CONFLICT',
  );
  assert.throws(
    () => f.engine.setDefault(f.rows[1].address_id, 'delete'),
    (e) => e.code === 'IDEMPOTENCY_CONFLICT',
  );
  assert.throws(
    () => f.engine.create(sample('其他'), 'delete'),
    (e) => e.code === 'IDEMPOTENCY_CONFLICT',
  );
  assert.throws(
    () =>
      f.engine.update(
        f.rows[2].address_id,
        addressEditRequest(sample('其他'), f.rows[2].edit_token),
        'delete',
      ),
    (e) => e.code === 'IDEMPOTENCY_CONFLICT',
  );
  assert.throws(
    () => f.engine.remove(f.rows[1].address_id, 'seed-1'),
    (e) => e.code === 'IDEMPOTENCY_CONFLICT',
  );
});

test('automatic fallback invalidates old edits for its target but not unaffected remaining rows', () => {
  const f = fixture();
  f.engine.remove(f.rows[0].address_id, 'delete');
  assert.throws(
    () =>
      f.engine.update(
        f.rows[1].address_id,
        addressEditRequest(sample('旧编辑'), f.rows[1].edit_token),
        'old',
      ),
    (e) => e.code === 'EDIT_CONFLICT',
  );
  f.engine.update(
    f.rows[2].address_id,
    addressEditRequest(sample('正常编辑'), f.rows[2].edit_token),
    'edit',
  );
  assert.deepEqual(defaultIds(f.engine.read()), [f.rows[1].address_id]);
});

test('deletion uses the latest snapshot so a later default or contact edit is preserved', () => {
  const f = fixture(),
    other = new MockAddresses(f.options);
  other.setDefault(f.rows[2].address_id, 'external-default');
  const row = other.read()[1];
  other.update(
    row.address_id,
    addressEditRequest(sample('他页修改'), row.edit_token),
    'external-edit',
  );
  f.engine.remove(f.rows[0].address_id, 'delete-old-default');
  assert.deepEqual(defaultIds(f.engine.read()), [f.rows[2].address_id]);
  assert.equal(f.engine.read()[0].recipient_name, '他页修改');
});

test('double delete clicks share one request and competing create/edit/default/delete operations are rejected', async () => {
  const f = fixture();
  let release,
    writes = 0;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const store = new AddressStore(
    {
      ...f.gateway,
      remove: async (id, key) => {
        writes++;
        await gate;
        return f.engine.remove(id, key);
      },
    },
    f.key,
  );
  await store.load();
  const flight = store.remove(f.rows[0].address_id);
  assert.equal(store.remove(f.rows[0].address_id), flight);
  for (const action of [
    () => store.remove(f.rows[1].address_id),
    () => store.create(sample('其他')),
    () =>
      store.update(f.rows[2].address_id, addressEditRequest(sample('其他'), f.rows[2].edit_token)),
    () => store.setDefault(f.rows[1].address_id),
  ])
    await assert.rejects(action, (e) => e.code === 'REQUEST_IN_PROGRESS');
  assert.equal(store.getSnapshot().items.length, 3);
  release();
  await flight;
  assert.equal(writes, 1);
  assert.equal(store.getSnapshot().items.length, 2);
  assert.equal(store.getSnapshot().pending, null);
});

test('a definitively failed delete retries the original target and releases feedback after success', async () => {
  const f = fixture(),
    store = new AddressStore(f.gateway, f.key);
  await store.load();
  f.failSave(true);
  await assert.rejects(store.remove(f.rows[0].address_id));
  assert.equal(store.getSnapshot().pending, null);
  assert.deepEqual(store.getSnapshot().failedOperation, {
    kind: 'delete',
    address_id: f.rows[0].address_id,
  });
  assert.equal(store.getSnapshot().items.length, 3);
  f.failSave(false);
  await store.retry();
  assert.equal(store.getSnapshot().items.length, 2);
  assert.equal(store.getSnapshot().failedOperation, null);
  assert.equal(store.getSnapshot().error, null);
});

test('lost delete responses retain the original target/key and recovery cannot reapply default fallback', async () => {
  const f = fixture();
  let lost = true;
  const calls = [];
  const store = new AddressStore(
    {
      ...f.gateway,
      remove: async (id, key) => {
        calls.push([id, key]);
        const result = f.engine.remove(id, key);
        if (lost) {
          lost = false;
          throw Error('lost');
        }
        return result;
      },
    },
    f.key,
  );
  await store.load();
  await assert.rejects(store.remove(f.rows[0].address_id));
  assert.deepEqual(store.getSnapshot().pending, {
    kind: 'delete',
    address_id: f.rows[0].address_id,
  });
  assert.equal(store.getSnapshot().writeConfirmed, false);
  store.clearFeedback();
  assert.ok(store.getSnapshot().pending);
  await assert.rejects(store.load(), (e) => e.code === 'REQUEST_IN_PROGRESS');
  new MockAddresses(f.options).setDefault(f.rows[2].address_id, 'later-default');
  const latest = f.snapshot();
  await store.retry();
  assert.deepEqual(calls, [calls[0], calls[0]]);
  assert.equal(f.snapshot(), latest);
  assert.deepEqual(defaultIds(store.getSnapshot().items), [f.rows[2].address_id]);
  assert.equal(store.getSnapshot().items.length, 2);
});

test('confirmed delete with failed list read retries reads only and sees later address/default changes', async () => {
  const f = fixture();
  let readsFail = false,
    writes = 0;
  const store = new AddressStore(
    {
      ...f.gateway,
      read: async () => {
        if (readsFail) throw Error('read failed');
        return f.engine.read();
      },
      remove: async (id, key) => {
        writes++;
        return f.engine.remove(id, key);
      },
    },
    f.key,
  );
  await store.load();
  readsFail = true;
  await assert.rejects(store.remove(f.rows[0].address_id));
  assert.match(store.getSnapshot().error, /已删除/);
  assert.equal(store.getSnapshot().writeConfirmed, true);
  assert.equal(store.getSnapshot().items.length, 3);
  await assert.rejects(store.retry());
  assert.equal(writes, 1);
  f.engine.setDefault(f.rows[2].address_id, 'later');
  readsFail = false;
  await store.retry();
  assert.equal(writes, 1);
  assert.deepEqual(defaultIds(store.getSnapshot().items), [f.rows[2].address_id]);
  assert.equal(store.getSnapshot().writeConfirmed, false);
});

test('NOT_FOUND releases retry intent and the next retry only refreshes the current list', async () => {
  const f = fixture();
  let writes = 0;
  const store = new AddressStore(
    {
      ...f.gateway,
      remove: async (id, key) => {
        writes++;
        return f.engine.remove(id, key);
      },
    },
    f.key,
  );
  await assert.rejects(store.remove(f.rows[0].address_id), (e) => e.code === 'REQUEST_IN_PROGRESS');
  await store.load();
  f.engine.remove(f.rows[0].address_id, 'external-delete');
  await assert.rejects(store.remove(f.rows[0].address_id), (e) => e.code === 'NOT_FOUND');
  assert.equal(store.getSnapshot().pending, null);
  assert.equal(store.getSnapshot().failedOperation, null);
  await store.retry();
  assert.equal(writes, 1);
  assert.equal(store.getSnapshot().items.length, 2);
});

test('deleting the last address retains the confirmed list until the replacement list read completes', async () => {
  const f = fixture(1);
  let reads = 0,
    releaseRead,
    markReadStarted;
  const readGate = new Promise((resolve) => {
    releaseRead = resolve;
  });
  const readStarted = new Promise((resolve) => {
    markReadStarted = resolve;
  });
  const store = new AddressStore(
    {
      ...f.gateway,
      read: async () => {
        if (++reads > 1) {
          markReadStarted();
          await readGate;
        }
        return f.engine.read();
      },
    },
    f.key,
  );
  await store.load();
  const observed = [];
  store.subscribe(() => observed.push(store.getSnapshot()));
  const deletion = store.remove(f.rows[0].address_id);
  await readStarted;
  assert.deepEqual(f.engine.read(), []);
  assert.equal(store.getSnapshot().items.length, 1);
  assert.equal(store.getSnapshot().saving, true);
  assert.equal(store.getSnapshot().pending.kind, 'delete');
  assert.equal(
    observed.some((state) => state.items.length === 0),
    false,
  );
  releaseRead();
  await deletion;
  assert.deepEqual(store.getSnapshot().items, []);
  assert.equal(store.getSnapshot().pending, null);
  assert.equal(store.getSnapshot().saving, false);
  assert.equal(store.getSnapshot().status, 'ready');
});

test('a failed read after deleting the last address cannot masquerade as an empty list or hide a later new address', async () => {
  const f = fixture(1);
  let failRead = false,
    writes = 0;
  const store = new AddressStore(
    {
      ...f.gateway,
      read: async () => {
        if (failRead) throw Error('list unavailable');
        return f.engine.read();
      },
      remove: async (id, key) => {
        writes++;
        return f.engine.remove(id, key);
      },
    },
    f.key,
  );
  await store.load();
  failRead = true;
  await assert.rejects(store.remove(f.rows[0].address_id));
  assert.equal(store.getSnapshot().items.length, 1);
  assert.equal(store.getSnapshot().writeConfirmed, true);
  assert.equal(store.getSnapshot().pending.kind, 'delete');
  assert.match(store.getSnapshot().error, /列表暂未更新/);
  const later = f.engine.create(sample('后来新增'), 'later');
  failRead = false;
  await store.retry();
  assert.equal(writes, 1);
  assert.deepEqual(
    store.getSnapshot().items.map((row) => row.address_id),
    [later.address_id],
  );
  assert.equal(store.getSnapshot().items[0].is_default, true);
  assert.equal(store.getSnapshot().pending, null);
});

test('unknown deletion of the last address confirms the same operation before publishing an empty list', async () => {
  const f = fixture(1);
  let lost = true;
  const calls = [];
  const store = new AddressStore(
    {
      ...f.gateway,
      remove: async (id, key) => {
        calls.push([id, key]);
        const result = f.engine.remove(id, key);
        if (lost) {
          lost = false;
          throw Error('lost');
        }
        return result;
      },
    },
    f.key,
  );
  await store.load();
  const saves = f.saves();
  await assert.rejects(store.remove(f.rows[0].address_id));
  assert.equal(store.getSnapshot().items.length, 1);
  assert.equal(store.getSnapshot().pending.kind, 'delete');
  await store.retry();
  assert.deepEqual(calls, [calls[0], calls[0]]);
  assert.equal(f.saves(), saves + 1);
  assert.deepEqual(store.getSnapshot().items, []);
  assert.equal(store.getSnapshot().error, null);
  assert.equal(store.getSnapshot().pending, null);
  assert.equal(store.getSnapshot().saving, false);
});

test('repeated definitive delete failures keep the same retry target and default until one successful write', async () => {
  const f = fixture(),
    store = new AddressStore(f.gateway, f.key);
  await store.load();
  const before = f.snapshot(),
    saves = f.saves();
  f.failSave(true);
  for (const action of [
    () => store.remove(f.rows[0].address_id),
    () => store.retry(),
    () => store.retry(),
  ]) {
    await assert.rejects(action, (e) => e.code === 'SERVICE_UNAVAILABLE');
    assert.equal(f.snapshot(), before);
    assert.equal(f.saves(), saves);
    assert.deepEqual(store.getSnapshot().failedOperation, {
      kind: 'delete',
      address_id: f.rows[0].address_id,
    });
    assert.equal(store.getSnapshot().pending, null);
    assert.equal(store.getSnapshot().saving, false);
    assert.deepEqual(defaultIds(store.getSnapshot().items), [f.rows[0].address_id]);
  }
  f.failSave(false);
  await store.retry();
  assert.equal(f.saves(), saves + 1);
  assert.deepEqual(
    store.getSnapshot().items.map((row) => row.address_id),
    [f.rows[1].address_id, f.rows[2].address_id],
  );
  assert.deepEqual(defaultIds(store.getSnapshot().items), [f.rows[1].address_id]);
  assert.equal(store.getSnapshot().failedOperation, null);
});
