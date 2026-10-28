import test from 'node:test';
import assert from 'node:assert/strict';
import { MockCart } from '../src/mocks/cart.ts';
import { CartStore } from '../src/stores/cart.ts';
import { CartError, cartSubtotal } from '../src/lib/cart.ts';
import { productDetails } from '../src/mocks/product.ts';

const rows = (view) => view.groups.flatMap((group) => group.items);
function fixture() {
  let time = 1000000,
    sequence = 0,
    snapshot = null,
    failSave = false;
  const catalog = structuredClone(productDetails);
  const options = {
    catalog: () => catalog,
    now: () => time,
    id: () => `row-${++sequence}`,
    load: () => snapshot,
    save: (data) => {
      if (failSave) throw Error('quota');
      snapshot = data;
    },
  };
  const engine = new MockCart(options);
  const lamp = engine.add({ sku_id: 'lamp_white-usb', quantity: 1 }, 'seed-lamp');
  const keyboard = engine.add({ sku_id: 'keyboard_ivory', quantity: 1 }, 'seed-keyboard');
  const gateway = {
    read: async () => engine.read(),
    add: async (body, key) => engine.add(body, key),
    update: async (id, body, key) => engine.update(id, body, key),
    remove: async (ids, key) => engine.remove(ids, key),
    restore: async (token, key) => engine.restore(token, key),
  };
  let key = 0;
  return {
    engine,
    catalog,
    lamp,
    keyboard,
    gateway,
    options,
    key: () => `op-${++key}`,
    advance: (ms) => {
      time += ms;
    },
    failSave: (value) => {
      failSave = value;
    },
  };
}
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const tick = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

test('quantity updates use absolute targets, expected confirmed quantity and operation replay', () => {
  const f = fixture();
  const request = { quantity: 3, expected_quantity: 1 };
  f.engine.update(f.lamp.item_id, request, 'set');
  assert.equal(f.engine.update(f.lamp.item_id, request, 'set').quantity, 3);
  assert.throws(
    () => f.engine.update(f.lamp.item_id, { quantity: 4, expected_quantity: 1 }, 'conflict'),
    (error) => error.code === 'CART_CHANGED',
  );
  assert.throws(
    () => f.engine.update(f.lamp.item_id, { quantity: 9, expected_quantity: 3 }, 'stock'),
    (error) => error.code === 'INSUFFICIENT_STOCK',
  );
  assert.equal(rows(f.engine.read())[0].quantity, 3);
  assert.throws(
    () => f.engine.update(f.lamp.item_id, { quantity: 0, expected_quantity: 3 }, 'zero'),
    (error) => error.code === 'INVALID_ARGUMENT',
  );
  assert.throws(
    () => f.engine.remove([f.lamp.item_id], 'set'),
    (error) => error.code === 'IDEMPOTENCY_CONFLICT',
  );
});

test('insufficient stock can be explicitly reduced; unavailable items remain deletable but not editable', () => {
  const f = fixture();
  f.engine.update(f.lamp.item_id, { quantity: 5, expected_quantity: 1 }, 'five');
  const product = f.catalog.find((product) => product.product_id === 'lamp');
  product.skus[0].available_stock = 2;
  assert.equal(rows(f.engine.read())[0].purchase_status, 'INSUFFICIENT_STOCK');
  assert.equal(
    f.engine.update(f.lamp.item_id, { quantity: 2, expected_quantity: 5 }, 'fix').purchasable,
    true,
  );
  product.skus.shift();
  assert.throws(
    () => f.engine.update(f.lamp.item_id, { quantity: 1, expected_quantity: 2 }, 'disabled'),
    (error) => error.code === 'ITEM_NOT_PURCHASABLE',
  );
  f.engine.remove([f.lamp.item_id], 'delete');
  assert.equal(f.engine.read().item_count, 1);
});

test('batch deletion validates all IDs before atomically deleting, and replays the original token', () => {
  const f = fixture();
  assert.throws(
    () => f.engine.remove([f.lamp.item_id, 'missing'], 'bad'),
    (error) => error.code === 'CART_CHANGED',
  );
  assert.equal(f.engine.read().item_count, 2);
  assert.throws(
    () => f.engine.remove([f.lamp.item_id, f.lamp.item_id], 'duplicate'),
    (error) => error.code === 'INVALID_ARGUMENT',
  );
  const deletion = f.engine.remove([f.lamp.item_id, f.keyboard.item_id], 'delete');
  assert.deepEqual(f.engine.remove([f.keyboard.item_id, f.lamp.item_id], 'delete'), deletion);
  assert.equal(f.engine.read().item_count, 0);
});

test('undo restores the original SKU, merges re-added quantities, and has one effect across different keys', () => {
  const f = fixture();
  f.engine.update(f.lamp.item_id, { quantity: 3, expected_quantity: 1 }, 'three');
  const deletion = f.engine.remove([f.lamp.item_id], 'delete');
  const readded = f.engine.add({ sku_id: f.lamp.sku_id, quantity: 2 }, 'readd');
  f.catalog.find((product) => product.product_id === 'lamp').skus.shift();
  const restored = f.engine.restore(deletion.restore_token, 'undo').items[0];
  assert.equal(restored.sku_id, f.lamp.sku_id);
  assert.equal(restored.item_id, readded.item_id);
  assert.equal(restored.quantity, 5);
  assert.equal(restored.purchase_status, 'SPEC_DISABLED');
  assert.equal(restored.navigation.type, 'STORE');
  f.engine.restore(deletion.restore_token, 'undo-again');
  assert.equal(rows(f.engine.read()).find((item) => item.sku_id === f.lamp.sku_id).quantity, 5);
});

test('expired unused undo tokens never restore data, while successful operation replay does not duplicate restoration', () => {
  const f = fixture();
  const deletion = f.engine.remove([f.lamp.item_id], 'delete');
  f.advance(8000);
  assert.throws(
    () => f.engine.restore(deletion.restore_token, 'late'),
    (error) => error.code === 'RESTORE_EXPIRED',
  );
  assert.equal(f.engine.read().item_count, 1);
  const second = f.engine.remove([f.keyboard.item_id], 'second');
  f.engine.restore(second.restore_token, 'undo');
  f.advance(9000);
  f.engine.restore(second.restore_token, 'undo');
  assert.equal(f.engine.read().item_count, 1);
});

test('save failures apply neither quantity, deletion nor restoration, and do not consume undo tokens', () => {
  const f = fixture();
  f.failSave(true);
  assert.throws(() =>
    f.engine.update(f.lamp.item_id, { quantity: 2, expected_quantity: 1 }, 'set'),
  );
  assert.throws(() => f.engine.remove([f.lamp.item_id], 'delete'));
  assert.equal(f.engine.read().quantity_total, 2);
  f.failSave(false);
  const deletion = f.engine.remove([f.lamp.item_id], 'delete');
  f.failSave(true);
  assert.throws(() => f.engine.restore(deletion.restore_token, 'undo'));
  assert.equal(f.engine.read().item_count, 1);
  f.failSave(false);
  f.engine.restore(deletion.restore_token, 'undo');
  assert.equal(f.engine.read().item_count, 2);
});

test('rapid quantity targets serialize per item and totals stay confirmed until acknowledgements', async () => {
  const f = fixture(),
    gate = deferred(),
    writes = [];
  const store = new CartStore(
    {
      ...f.gateway,
      update: async (id, body, key) => {
        writes.push({ ...body });
        if (writes.length === 1) await gate.promise;
        return f.engine.update(id, body, key);
      },
    },
    f.key,
  );
  await store.load();
  const before = cartSubtotal(store.getSnapshot().view);
  const promise = store.changeQuantity(f.lamp.item_id, 2);
  await tick();
  assert.equal(store.changeQuantity(f.lamp.item_id, 3), promise);
  store.changeQuantity(f.lamp.item_id, 4);
  assert.equal(writes.length, 1);
  assert.equal(cartSubtotal(store.getSnapshot().view), before);
  assert.equal(store.getSnapshot().quantityEdits[f.lamp.item_id].target, 4);
  gate.resolve();
  await promise;
  assert.deepEqual(writes, [
    { quantity: 2, expected_quantity: 1 },
    { quantity: 4, expected_quantity: 2 },
  ]);
  assert.equal(rows(store.getSnapshot().view)[0].quantity, 4);
});

test('different item quantities can progress independently without stale full-view overwrites', async () => {
  const f = fixture(),
    lampGate = deferred();
  const store = new CartStore(
    {
      ...f.gateway,
      update: async (id, body, key) => {
        if (id === f.lamp.item_id) await lampGate.promise;
        return f.engine.update(id, body, key);
      },
    },
    f.key,
  );
  await store.load();
  const lamp = store.changeQuantity(f.lamp.item_id, 3);
  await store.changeQuantity(f.keyboard.item_id, 2);
  assert.equal(
    rows(store.getSnapshot().view).find((item) => item.item_id === f.keyboard.item_id).quantity,
    2,
  );
  lampGate.resolve();
  await lamp;
  assert.equal(store.getSnapshot().view.quantity_total, 5);
});

test('an uncertain quantity write retries its original body/key before submitting the latest target', async () => {
  const f = fixture(),
    gate = deferred(),
    writes = [];
  let fail = true;
  const store = new CartStore(
    {
      ...f.gateway,
      update: async (id, body, key) => {
        writes.push({ ...body, key });
        const result = f.engine.update(id, body, key);
        if (fail) {
          fail = false;
          await gate.promise;
          throw Error('lost response');
        }
        return result;
      },
    },
    f.key,
  );
  await store.load();
  const pending = store.changeQuantity(f.lamp.item_id, 2);
  await tick();
  store.changeQuantity(f.lamp.item_id, 3);
  gate.resolve();
  await assert.rejects(pending);
  assert.equal(store.getSnapshot().quantityEdits[f.lamp.item_id].retryPending, true);
  await store.retryQuantity(f.lamp.item_id);
  assert.deepEqual(
    writes.map(({ quantity, expected_quantity }) => [quantity, expected_quantity]),
    [
      [2, 1],
      [2, 1],
      [3, 2],
    ],
  );
  assert.equal(writes[0].key, writes[1].key);
  assert.notEqual(writes[1].key, writes[2].key);
  assert.equal(rows(store.getSnapshot().view)[0].quantity, 3);
});

test('quantity recovery re-reads current state and stops queued targets after a cross-page change', async () => {
  const f = fixture();
  let fail = true,
    writes = 0;
  const store = new CartStore(
    {
      ...f.gateway,
      update: async (id, body, key) => {
        writes++;
        const result = f.engine.update(id, body, key);
        if (fail) {
          fail = false;
          throw Error('lost');
        }
        return result;
      },
    },
    f.key,
  );
  await store.load();
  await assert.rejects(store.changeQuantity(f.lamp.item_id, 2));
  f.engine.update(f.lamp.item_id, { quantity: 5, expected_quantity: 2 }, 'external');
  await store.retryQuantity(f.lamp.item_id);
  assert.equal(writes, 2);
  assert.equal(rows(store.getSnapshot().view)[0].quantity, 5);
  assert.match(store.getSnapshot().quantityEdits[f.lamp.item_id].error, /其他页面/);
});

test('confirmed quantity replay followed by failed read retries only the read', async () => {
  const f = fixture();
  let lost = true,
    readFail = false,
    writes = 0;
  const store = new CartStore(
    {
      ...f.gateway,
      read: async () => {
        if (readFail) throw Error('read failed');
        return f.engine.read();
      },
      update: async (id, body, key) => {
        writes++;
        const result = f.engine.update(id, body, key);
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
  await assert.rejects(store.changeQuantity(f.lamp.item_id, 2));
  readFail = true;
  await assert.rejects(store.retryQuantity(f.lamp.item_id));
  readFail = false;
  await store.retryQuantity(f.lamp.item_id);
  assert.equal(writes, 2);
  assert.equal(rows(store.getSnapshot().view)[0].quantity, 2);
});

test('a true expected-quantity conflict refreshes the row instead of overwriting another page', async () => {
  const f = fixture();
  const store = new CartStore(f.gateway, f.key);
  await store.load();
  f.engine.update(f.lamp.item_id, { quantity: 4, expected_quantity: 1 }, 'external');
  await assert.rejects(
    store.changeQuantity(f.lamp.item_id, 2),
    (error) => error.code === 'CART_CHANGED',
  );
  assert.equal(rows(store.getSnapshot().view)[0].quantity, 4);
  assert.equal(store.getSnapshot().quantityEdits[f.lamp.item_id].target, 4);
  await store.changeQuantity(f.lamp.item_id, 3);
  assert.equal(rows(store.getSnapshot().view)[0].quantity, 3);
});

test('deletion waits for the last quantity target and undo recovers that confirmed quantity', async () => {
  const f = fixture(),
    gate = deferred(),
    log = [];
  const store = new CartStore(
    {
      ...f.gateway,
      update: async (id, body, key) => {
        log.push(`quantity:${body.quantity}`);
        if (body.quantity === 2) await gate.promise;
        return f.engine.update(id, body, key);
      },
      remove: async (ids, key) => {
        log.push('delete');
        return f.engine.remove(ids, key);
      },
    },
    f.key,
  );
  await store.load();
  const edit = store.changeQuantity(f.lamp.item_id, 2);
  await tick();
  store.changeQuantity(f.lamp.item_id, 3);
  const deletion = store.remove([f.lamp.item_id]);
  await tick();
  assert.equal(log.includes('delete'), false);
  await assert.rejects(
    store.changeQuantity(f.keyboard.item_id, 2),
    (error) => error.code === 'REQUEST_IN_PROGRESS',
  );
  gate.resolve();
  await Promise.all([edit, deletion]);
  assert.deepEqual(log, ['quantity:2', 'quantity:3', 'delete']);
  await store.restore();
  assert.equal(
    rows(store.getSnapshot().view).find((item) => item.sku_id === f.lamp.sku_id).quantity,
    3,
  );
});

test('unconfirmed quantity prevents deletion until recovery, without sending a delete request', async () => {
  const f = fixture();
  let removes = 0;
  const store = new CartStore(
    {
      ...f.gateway,
      update: async () => {
        throw Error('offline');
      },
      remove: async (ids, key) => {
        removes++;
        return f.engine.remove(ids, key);
      },
    },
    f.key,
  );
  await store.load();
  await assert.rejects(store.changeQuantity(f.lamp.item_id, 2));
  await assert.rejects(
    store.remove([f.lamp.item_id]),
    (error) => error.code === 'REQUEST_IN_PROGRESS',
  );
  assert.equal(removes, 0);
  assert.equal(store.getSnapshot().view.item_count, 2);
});

test('unknown deletion retries the same key and obtains the original undo token without deleting twice', async () => {
  const f = fixture();
  let fail = true;
  const keys = [];
  const store = new CartStore(
    {
      ...f.gateway,
      remove: async (ids, key) => {
        keys.push(key);
        const result = f.engine.remove(ids, key);
        if (fail) {
          fail = false;
          throw Error('lost');
        }
        return result;
      },
    },
    f.key,
  );
  await store.load();
  await assert.rejects(store.remove([f.lamp.item_id]));
  await store.retry();
  assert.deepEqual(keys, [keys[0], keys[0]]);
  assert.equal(store.getSnapshot().view.item_count, 1);
  await store.restore();
  assert.equal(store.getSnapshot().view.item_count, 2);
});

test('confirmed deletion can be undone before expiry even when its list read failed', async () => {
  const f = fixture();
  let failRead = false;
  const store = new CartStore(
    {
      ...f.gateway,
      read: async () => {
        if (failRead) throw Error('read failed');
        return f.engine.read();
      },
    },
    f.key,
  );
  await store.load();
  failRead = true;
  await assert.rejects(store.remove([f.lamp.item_id]));
  assert.ok(store.getSnapshot().undo);
  assert.equal(store.getSnapshot().view.item_count, 1);
  failRead = false;
  await store.restore();
  assert.equal(store.getSnapshot().view.item_count, 2);
});

test('restoration merges a re-added SKU once, preserves original selection and deduplicates double clicks', async () => {
  const f = fixture(),
    gate = deferred();
  let restores = 0;
  const store = new CartStore(
    {
      ...f.gateway,
      restore: async (token, key) => {
        restores++;
        await gate.promise;
        return f.engine.restore(token, key);
      },
    },
    f.key,
  );
  await store.load();
  store.select([f.lamp.item_id], false);
  await store.remove([f.lamp.item_id]);
  await store.add({ sku_id: f.lamp.sku_id, quantity: 2 });
  const first = store.restore(),
    second = store.restore();
  assert.equal(first, second);
  gate.resolve();
  await first;
  const row = rows(store.getSnapshot().view).find((item) => item.sku_id === f.lamp.sku_id);
  assert.equal(restores, 1);
  assert.equal(row.quantity, 3);
  assert.equal(store.getSnapshot().choices[row.item_id], false);
});

test('expired store undo reports expiry without inventing recovered rows', async () => {
  const f = fixture();
  const store = new CartStore(f.gateway, f.key);
  await store.load();
  await store.remove([f.lamp.item_id]);
  f.advance(8000);
  await assert.rejects(store.restore(), (error) => error.code === 'RESTORE_EXPIRED');
  assert.equal(store.getSnapshot().undo, null);
  assert.equal(store.getSnapshot().view.item_count, 1);
});

test('refresh waits for quantity writes before replacing the shared cart view', async () => {
  const f = fixture(),
    gate = deferred();
  let reads = 0;
  const store = new CartStore(
    {
      ...f.gateway,
      read: async () => {
        reads++;
        return f.engine.read();
      },
      update: async (id, body, key) => {
        await gate.promise;
        return f.engine.update(id, body, key);
      },
    },
    f.key,
  );
  await store.load();
  const edit = store.changeQuantity(f.lamp.item_id, 4);
  const refresh = store.load();
  await tick();
  assert.equal(reads, 1);
  gate.resolve();
  await Promise.all([edit, refresh]);
  assert.equal(store.getSnapshot().view.quantity_total, 5);
});

test('an uncertain restore retries the same operation and cannot apply the token twice', async () => {
  const f = fixture();
  let fail = true;
  const keys = [];
  const store = new CartStore(
    {
      ...f.gateway,
      restore: async (token, key) => {
        keys.push(key);
        const result = f.engine.restore(token, key);
        if (fail) {
          fail = false;
          throw Error('lost');
        }
        return result;
      },
    },
    f.key,
  );
  await store.load();
  await store.remove([f.lamp.item_id]);
  await assert.rejects(store.restore());
  assert.ok(store.getSnapshot().undo);
  await store.retry();
  assert.deepEqual(keys, [keys[0], keys[0]]);
  assert.equal(store.getSnapshot().view.quantity_total, 2);
  assert.equal(store.getSnapshot().undo, null);
});

test('a rejected quantity with failed conflict refresh retries reads without reapplying the target', async () => {
  const f = fixture();
  let readFail = false,
    writes = 0;
  const store = new CartStore(
    {
      ...f.gateway,
      read: async () => {
        if (readFail) throw Error('read failed');
        return f.engine.read();
      },
      update: async (id, body, key) => {
        writes++;
        return f.engine.update(id, body, key);
      },
    },
    f.key,
  );
  await store.load();
  f.engine.update(f.lamp.item_id, { quantity: 4, expected_quantity: 1 }, 'external');
  readFail = true;
  await assert.rejects(store.changeQuantity(f.lamp.item_id, 2));
  await assert.rejects(store.retryQuantity(f.lamp.item_id));
  assert.ok(store.getSnapshot().quantityEdits[f.lamp.item_id].error);
  readFail = false;
  await store.retryQuantity(f.lamp.item_id);
  assert.equal(writes, 1);
  assert.equal(rows(store.getSnapshot().view)[0].quantity, 4);
});
