import test from 'node:test';
import assert from 'node:assert/strict';
import { MockAddresses } from '../src/mocks/address.ts';
import { AddressStore } from '../src/stores/address.ts';
import { addressEditRequest } from '../src/lib/address.ts';

const sample = (patch) => ({
  recipient_name: '演示收货人',
  recipient_phone: '00000000000',
  province: '示例省',
  city: '示例市',
  district: '示例区',
  detail_address: '演示路 1 号',
  ...patch,
});
function fixture() {
  let snapshot = null,
    sequence = 0,
    time = 1000000,
    failSave = false;
  const options = {
    load: () => snapshot,
    save: (value) => {
      if (failSave) throw Error('quota');
      snapshot = value;
    },
    id: () => `address-${++sequence}`,
    now: () => time,
  };
  const engine = new MockAddresses(options);
  const first = engine.create(sample(), 'seed-one');
  const second = engine.create(
    sample({ recipient_name: '第二演示人', detail_address: '演示路 2 号' }),
    'seed-two',
  );
  const gateway = {
    read: async () => engine.read(),
    create: async (request, key) => engine.create(request, key),
    update: async (id, request, key) => engine.update(id, request, key),
  };
  let requestKey = 0;
  return {
    engine,
    gateway,
    options,
    first,
    second,
    key: () => `request-${++requestKey}`,
    advance: () => {
      time += 1000;
    },
    failSave: (value) => {
      failSave = value;
    },
    snapshot: () => snapshot,
  };
}

test('edit payload retains opaque version and contains only six normalized contact fields', () => {
  const request = addressEditRequest(
    { ...sample({ recipient_name: ' 演示人 ' }), is_default: true, address_id: 'ignored' },
    ' opaque token ',
  );
  assert.equal(request.recipient_name, '演示人');
  assert.equal(request.edit_token, ' opaque token ');
  assert.equal('is_default' in request, false);
  assert.equal('address_id' in request, false);
  assert.equal(Object.keys(request).length, 7);
  assert.throws(
    () => addressEditRequest(sample(), ''),
    (error) => error.code === 'INVALID_ARGUMENT',
  );
  assert.throws(
    () => addressEditRequest(sample({ recipient_phone: '' }), 'token'),
    (error) => !!error.fields.recipient_phone,
  );
});

test('editing updates the same record without changing its creation time, defaults, order or other rows', () => {
  const f = fixture(),
    before = f.engine.read();
  f.advance();
  const result = f.engine.update(
    f.first.address_id,
    addressEditRequest(sample({ detail_address: '演示路 8 号' }), f.first.edit_token),
    'edit',
  );
  const after = f.engine.read();
  assert.deepEqual(
    after.map((item) => item.address_id),
    before.map((item) => item.address_id),
  );
  assert.equal(result.address_id, f.first.address_id);
  assert.equal(result.created_at, f.first.created_at);
  assert.notEqual(result.updated_at, f.first.updated_at);
  assert.notEqual(result.edit_token, f.first.edit_token);
  assert.equal(result.is_default, true);
  assert.equal(after[0].detail_address, '演示路 8 号');
  assert.deepEqual(after[1], before[1]);
  assert.equal(new MockAddresses(f.options).read()[0].detail_address, '演示路 8 号');
});

test('editing a non-default address never changes the current default', () => {
  const f = fixture();
  f.engine.update(
    f.second.address_id,
    addressEditRequest(
      sample({ recipient_name: '改过的第二人', is_default: true }),
      f.second.edit_token,
    ),
    'edit',
  );
  assert.deepEqual(
    f.engine.read().map((item) => item.is_default),
    [true, false],
  );
});

test('missing address IDs are rejected instead of creating a replacement row', () => {
  const f = fixture(),
    before = f.snapshot();
  assert.throws(
    () => f.engine.update('missing', addressEditRequest(sample(), 'old'), 'edit'),
    (error) => error.code === 'NOT_FOUND',
  );
  assert.equal(f.snapshot(), before);
});

test('stale edit tokens cannot overwrite another page, including a later default change', () => {
  const f = fixture();
  const newer = f.engine.update(
    f.first.address_id,
    addressEditRequest(sample({ detail_address: '另一页面保存' }), f.first.edit_token),
    'external',
  );
  assert.throws(
    () =>
      f.engine.update(
        f.first.address_id,
        addressEditRequest(sample({ detail_address: '过期表单' }), f.first.edit_token),
        'stale',
      ),
    (error) => error.code === 'EDIT_CONFLICT',
  );
  assert.equal(f.engine.read()[0].detail_address, '另一页面保存');
  f.engine.create(sample({ is_default: true }), 'new-default');
  assert.throws(
    () =>
      f.engine.update(
        f.first.address_id,
        addressEditRequest(sample(), newer.edit_token),
        'stale-default',
      ),
    (error) => error.code === 'EDIT_CONFLICT',
  );
  assert.equal(f.engine.read().filter((item) => item.is_default).length, 1);
});

test('save failures preserve all records and do not consume the old version or operation key', () => {
  const f = fixture(),
    before = f.snapshot(),
    request = addressEditRequest(sample({ detail_address: '稍后重试' }), f.first.edit_token);
  f.failSave(true);
  assert.throws(() => f.engine.update(f.first.address_id, request, 'edit'));
  assert.equal(f.snapshot(), before);
  assert.equal(f.engine.read()[0].edit_token, f.first.edit_token);
  f.failSave(false);
  f.engine.update(f.first.address_id, request, 'edit');
  assert.equal(f.engine.read().length, 2);
  assert.equal(f.engine.read()[0].detail_address, '稍后重试');
});

test('local replay confirms one write before checking the old token, and rejects changed targets', () => {
  const f = fixture(),
    request = addressEditRequest(sample({ detail_address: '只保存一次' }), f.first.edit_token);
  const result = f.engine.update(f.first.address_id, request, 'edit');
  f.advance();
  assert.deepEqual(f.engine.update(f.first.address_id, request, 'edit'), result);
  assert.equal(f.engine.read()[0].edit_token, result.edit_token);
  assert.throws(
    () => f.engine.update(f.second.address_id, request, 'edit'),
    (error) => error.code === 'IDEMPOTENCY_CONFLICT',
  );
  assert.throws(
    () => f.engine.create(sample(), 'edit'),
    (error) => error.code === 'IDEMPOTENCY_CONFLICT',
  );
});

test('double edit saves share one flight while another address or create action is rejected', async () => {
  const f = fixture();
  let release,
    writes = 0;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const store = new AddressStore(
    {
      ...f.gateway,
      update: async (id, request, key) => {
        writes++;
        await gate;
        return f.engine.update(id, request, key);
      },
    },
    f.key,
  );
  await store.load();
  const request = addressEditRequest(sample({ detail_address: '双击保存' }), f.first.edit_token);
  const first = store.update(f.first.address_id, request);
  assert.equal(store.update(f.first.address_id, request), first);
  await assert.rejects(
    store.update(f.second.address_id, request),
    (error) => error.code === 'REQUEST_IN_PROGRESS',
  );
  await assert.rejects(store.create(sample()), (error) => error.code === 'REQUEST_IN_PROGRESS');
  release();
  await first;
  assert.equal(writes, 1);
  assert.equal(store.getSnapshot().items.length, 2);
});

test('an unknown edit retains the original address/body/key and recovers without creating a row', async () => {
  const f = fixture();
  let lost = true;
  const writes = [];
  const store = new AddressStore(
    {
      ...f.gateway,
      update: async (id, request, key) => {
        writes.push({ id, request, key });
        const result = f.engine.update(id, request, key);
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
  const request = addressEditRequest(sample({ detail_address: '恢复编辑' }), f.first.edit_token);
  await assert.rejects(store.update(f.first.address_id, request));
  assert.equal(store.getSnapshot().pending.kind, 'update');
  assert.equal(store.getSnapshot().pending.address_id, f.first.address_id);
  await assert.rejects(store.load(), (error) => error.code === 'REQUEST_IN_PROGRESS');
  await store.retry();
  assert.deepEqual(writes, [writes[0], writes[0]]);
  assert.equal(store.getSnapshot().items[0].address_id, f.first.address_id);
  assert.equal(store.getSnapshot().items[0].detail_address, '恢复编辑');
  assert.equal(store.getSnapshot().items.length, 2);
});

test('a confirmed edit with failed list read retries only reads and preserves row identity', async () => {
  const f = fixture();
  let writes = 0,
    failRead = false;
  const store = new AddressStore(
    {
      ...f.gateway,
      read: async () => {
        if (failRead) throw Error('read failed');
        return f.engine.read();
      },
      update: async (id, request, key) => {
        writes++;
        return f.engine.update(id, request, key);
      },
    },
    f.key,
  );
  await store.load();
  failRead = true;
  await assert.rejects(
    store.update(
      f.first.address_id,
      addressEditRequest(sample({ detail_address: '已保存等待读取' }), f.first.edit_token),
    ),
  );
  assert.match(store.getSnapshot().error, /已保存/);
  const token = f.engine.read()[0].edit_token;
  failRead = false;
  await store.retry();
  assert.equal(writes, 1);
  assert.equal(store.getSnapshot().items[0].edit_token, token);
  assert.equal(store.getSnapshot().items.length, 2);
});

test('a real edit conflict never swaps in a fresh token or silently resubmits the user draft', async () => {
  const f = fixture();
  let writes = 0;
  const store = new AddressStore(
    {
      ...f.gateway,
      update: async (id, request, key) => {
        writes++;
        return f.engine.update(id, request, key);
      },
    },
    f.key,
  );
  await store.load();
  const request = addressEditRequest(sample({ detail_address: '旧表单输入' }), f.first.edit_token);
  f.engine.update(
    f.first.address_id,
    addressEditRequest(sample({ detail_address: '他页最新值' }), f.first.edit_token),
    'external',
  );
  await assert.rejects(
    store.update(f.first.address_id, request),
    (error) => error.code === 'EDIT_CONFLICT',
  );
  assert.equal(store.getSnapshot().pending, null);
  await store.retry();
  assert.equal(writes, 1);
  assert.equal(store.getSnapshot().items[0].detail_address, '他页最新值');
  await assert.rejects(
    store.update(f.first.address_id, request),
    (error) => error.code === 'EDIT_CONFLICT',
  );
});

test('recovery reads the newest row after a local replay without overwriting a subsequent edit', async () => {
  const f = fixture();
  let lost = true;
  const store = new AddressStore(
    {
      ...f.gateway,
      update: async (id, request, key) => {
        const result = f.engine.update(id, request, key);
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
  await assert.rejects(
    store.update(
      f.first.address_id,
      addressEditRequest(sample({ detail_address: '本页写入' }), f.first.edit_token),
    ),
  );
  const fresh = f.engine.read()[0];
  f.engine.update(
    f.first.address_id,
    addressEditRequest(sample({ detail_address: '后来另一页写入' }), fresh.edit_token),
    'external',
  );
  await store.retry();
  assert.equal(store.getSnapshot().items[0].detail_address, '后来另一页写入');
  assert.equal(store.getSnapshot().items.length, 2);
});
