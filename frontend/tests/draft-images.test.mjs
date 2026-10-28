import test from 'node:test';
import assert from 'node:assert/strict';
import { MockMerchantDrafts } from '../src/mocks/merchantDraft.ts';
import { productMediaAssets, readProductMedia } from '../src/mocks/productMedia.ts';
import { MerchantDraftStore } from '../src/stores/merchantDraft.ts';
import { CommerceError } from '../src/lib/commerce.ts';
import {
  addDraftImage,
  draftImageChoices,
  draftImageEdits,
  moveDraftImage,
  validSavedImages,
} from '../src/lib/draftImages.ts';
import { categories } from '../src/mocks/catalog.ts';
const scope = { store_id: 'store_home', name: '好物生活馆' },
  hasCode = (code) => (e) => e.code === code;
function fixture() {
  let bytes = null,
    writes = 0,
    n = 0,
    failSave = false,
    failAssets = false;
  const assets = structuredClone(productMediaAssets),
    cats = structuredClone(categories);
  const options = {
    store: () => scope,
    categories: () => cats,
    assets: () => {
      if (failAssets) throw Error('unavailable');
      return assets;
    },
    load: () => bytes,
    save: (v) => {
      if (failSave) throw Error('quota');
      bytes = v;
      writes++;
    },
    id: () => `d-${++n}`,
    now: () => 1000000,
  };
  const engine = new MockMerchantDrafts(options),
    draft = engine.create('create');
  return {
    engine,
    draft,
    options,
    assets,
    cats,
    bytes: () => bytes,
    writes: () => writes,
    failSave: (v) => {
      failSave = v;
    },
    failAssets: (v) => {
      failAssets = v;
    },
    bytesSet: (v) => {
      bytes = v;
    },
  };
}
const fresh = (asset_id, client_key) => ({ asset_id, client_key });
const images = (f) => [
  fresh(f.assets[0].asset_id, 'first'),
  fresh(f.assets[1].asset_id, 'second'),
  fresh(f.assets[2].asset_id, 'third'),
];
const body = (d, imageList) => ({ edit_token: d.edit_token, images: imageList });
test('private demo library is owner and purpose scoped and returns only M02 metadata copies', () => {
  const source = structuredClone(productMediaAssets);
  source.push(
    { ...source[0], asset_id: 'foreign', owner_store_id: 'foreign' },
    { ...source[0], asset_id: 'avatar', purpose: 'USER_AVATAR' },
    { ...source[0], asset_id: 'retired', status: 'REMOVED' },
  );
  const list = readProductMedia(scope, source);
  assert.equal(list.length, 9);
  assert.deepEqual(
    Object.keys(list[0]).sort(),
    ['asset_id', 'url', 'content_type', 'size_bytes', 'status', 'created_at'].sort(),
  );
  list[0].url = 'changed';
  assert.notEqual(source[0].url, 'changed');
  assert.throws(() => readProductMedia(null, source), hasCode('FORBIDDEN'));
});
test('new gallery saves with ordered stable IDs, id mappings and first-image cover in one write', () => {
  const f = fixture(),
    count = f.writes(),
    result = f.engine.save(
      f.draft.product_id,
      { ...body(f.draft, images(f)), fields: { title: '有图草稿' } },
      'images',
    );
  assert.equal(f.writes(), count + 1);
  assert.equal(result.product.title, '有图草稿');
  assert.equal(result.product.cover_image, f.assets[0].url);
  assert.deepEqual(
    result.product.images.map((i) => i.sort_order),
    [0, 1, 2],
  );
  assert.equal(new Set(result.product.images.map((i) => i.product_image_id)).size, 3);
  assert.equal(result.id_map.length, 3);
  assert.deepEqual(
    result.id_map.map((m) => m.client_key),
    ['first', 'second', 'third'],
  );
  assert.ok(
    result.id_map.every(
      (m) => m.kind === 'IMAGE' && result.product.images.some((i) => i.product_image_id === m.id),
    ),
  );
  assert.equal(result.product.product_id, f.draft.product_id);
  assert.equal(result.product.created_at, f.draft.created_at);
  assert.equal(result.product.sale_status, 'DRAFT');
  assert.equal(result.product.sku_count, 0);
});
test('reordering existing images changes main image while retaining attachment IDs and no new mappings', () => {
  const f = fixture(),
    a = f.engine.save(f.draft.product_id, body(f.draft, images(f)), 'a').product;
  const request = draftImageEdits(moveDraftImage(draftImageChoices(a.images), 2, 0)),
    b = f.engine.save(a.product_id, body(a, request), 'b');
  assert.deepEqual(
    b.product.images.map((i) => i.product_image_id),
    [a.images[2].product_image_id, a.images[0].product_image_id, a.images[1].product_image_id],
  );
  assert.equal(b.product.cover_image, f.assets[2].url);
  assert.deepEqual(b.id_map, []);
  assert.deepEqual(new MockMerchantDrafts(f.options).draft(a.product_id), b.product);
});
test('omitted gallery preserves images and explicit empty gallery clears cover without deleting assets', () => {
  const f = fixture(),
    a = f.engine.save(f.draft.product_id, body(f.draft, images(f)), 'a').product,
    assets = structuredClone(f.assets);
  const b = f.engine.save(
    a.product_id,
    { edit_token: a.edit_token, fields: { description: 'only fields' } },
    'b',
  ).product;
  assert.deepEqual(b.images, a.images);
  assert.equal(b.cover_image, a.cover_image);
  const c = f.engine.save(a.product_id, body(b, []), 'c').product;
  assert.deepEqual(c.images, []);
  assert.equal(c.cover_image, null);
  assert.deepEqual(f.assets, assets);
});
test('removing the main image advances cover and removed attachment IDs cannot be rebound later', () => {
  const f = fixture(),
    a = f.engine.save(f.draft.product_id, body(f.draft, images(f)), 'a').product;
  const b = f.engine.save(
    a.product_id,
    body(a, draftImageEdits(draftImageChoices(a.images.slice(1)))),
    'b',
  ).product;
  assert.equal(b.cover_image, a.images[1].url);
  assert.equal(b.images[0].sort_order, 0);
  assert.throws(
    () =>
      f.engine.save(
        b.product_id,
        body(b, [
          { product_image_id: a.images[0].product_image_id, asset_id: a.images[0].asset_id },
        ]),
        'bad',
      ),
    hasCode('INVALID_ARGUMENT'),
  );
});
test('cross-draft IDs, unknown assets, foreign ownership and wrong purpose fail atomically', () => {
  const f = fixture(),
    other = f.engine.create('other'),
    a = f.engine.save(other.product_id, body(other, images(f)), 'other-images').product;
  const before = f.bytes();
  assert.throws(
    () =>
      f.engine.save(
        f.draft.product_id,
        body(f.draft, draftImageEdits(draftImageChoices(a.images))),
        'bad-id',
      ),
    hasCode('INVALID_ARGUMENT'),
  );
  for (const asset of [
    { ...f.assets[0], asset_id: 'foreign', owner_store_id: 'other' },
    { ...f.assets[0], asset_id: 'wrong-purpose', purpose: 'USER_AVATAR' },
    { ...f.assets[0], asset_id: 'removed', status: 'REMOVED' },
  ])
    f.assets.push(asset);
  for (const asset_id of ['foreign', 'wrong-purpose', 'removed', 'missing'])
    assert.throws(
      () =>
        f.engine.save(
          f.draft.product_id,
          { ...body(f.draft, [fresh(asset_id, 'new')]), fields: { title: 'must not apply' } },
          asset_id,
        ),
      hasCode('NOT_FOUND'),
    );
  assert.equal(f.bytes(), before);
  assert.equal(f.engine.draft(f.draft.product_id).title, null);
});
test('invalid references, duplicate identity and untrusted URLs are rejected before writes', () => {
  const f = fixture(),
    before = f.bytes(),
    asset_id = f.assets[0].asset_id;
  for (const gallery of [
    null,
    {},
    [null],
    [{ asset_id }],
    [{ asset_id, client_key: '', product_image_id: 'x' }],
    [{ asset_id, client_key: 'x', product_image_id: 'y' }],
    [{ asset_id, client_key: 'x', url: 'https://bad.example' }],
    [fresh(asset_id, 'same'), fresh(asset_id, 'same')],
    [
      { asset_id, product_image_id: 'id' },
      { asset_id, product_image_id: 'id' },
    ],
    [{ asset_id, client_key: 'x', sort_order: 2 }],
  ])
    assert.throws(
      () => f.engine.save(f.draft.product_id, body(f.draft, gallery), 'invalid'),
      hasCode('INVALID_ARGUMENT'),
    );
  assert.equal(f.bytes(), before);
});
test('unique attachment identities may share an asset; UI deduplication is not a new global API restriction', () => {
  const f = fixture(),
    asset = f.assets[0];
  const a = f.engine.save(
    f.draft.product_id,
    body(f.draft, [fresh(asset.asset_id, 'a'), fresh(asset.asset_id, 'b')]),
    'a',
  );
  assert.equal(a.product.images.length, 2);
  assert.notEqual(a.product.images[0].product_image_id, a.product.images[1].product_image_id);
});
test('replay returns original image mappings after asset retirement and never rewinds a later reorder', () => {
  const f = fixture(),
    request = { ...body(f.draft, images(f)), fields: { category_id: f.cats[0].category_id } },
    a = f.engine.save(f.draft.product_id, request, 'a');
  const b = f.engine.save(
    a.product.product_id,
    body(a.product, draftImageEdits(moveDraftImage(draftImageChoices(a.product.images), 2, 0))),
    'b',
  ).product;
  f.assets.splice(0);
  f.cats.splice(0);
  const before = f.bytes(),
    count = f.writes();
  assert.deepEqual(f.engine.save(f.draft.product_id, request, 'a'), a);
  assert.deepEqual(f.engine.draft(b.product_id), b);
  assert.equal(f.bytes(), before);
  assert.equal(f.writes(), count);
});
test('same operation key with another image order conflicts without changing saved data', () => {
  const f = fixture(),
    request = body(f.draft, images(f));
  f.engine.save(f.draft.product_id, request, 'a');
  const before = f.bytes();
  assert.throws(
    () => f.engine.save(f.draft.product_id, body(f.draft, [...request.images].reverse()), 'a'),
    hasCode('IDEMPOTENCY_CONFLICT'),
  );
  assert.equal(f.bytes(), before);
});
test('pre-image version-1 snapshots and receipts without mappings remain readable and replayable', () => {
  const f = fixture(),
    a = f.engine.save(
      f.draft.product_id,
      { edit_token: f.draft.edit_token, fields: { title: 'legacy' } },
      'a',
    ).product;
  const legacy = JSON.parse(f.bytes());
  legacy.receipts.forEach((r) => {
    delete r.id_map;
  });
  f.bytesSet(JSON.stringify(legacy));
  const before = f.bytes();
  assert.deepEqual(new MockMerchantDrafts(f.options).draft(a.product_id), a);
  assert.equal(
    f.engine.save(
      f.draft.product_id,
      { edit_token: f.draft.edit_token, fields: { title: 'legacy' } },
      'a',
    ).product.title,
    'legacy',
  );
  assert.equal(f.bytes(), before);
});
test('malformed saved order, cover and identities stay errors instead of erasing the gallery', () => {
  const f = fixture();
  f.engine.save(f.draft.product_id, body(f.draft, images(f)), 'a');
  const valid = f.bytes();
  for (const corrupt of [
    (s) => {
      s.drafts[0].images[0].sort_order = 2;
    },
    (s) => {
      s.drafts[0].cover_image = null;
    },
    (s) => {
      s.drafts[0].images[1].product_image_id = s.drafts[0].images[0].product_image_id;
    },
  ]) {
    const state = JSON.parse(valid);
    corrupt(state);
    f.bytesSet(JSON.stringify(state));
    const before = f.bytes();
    assert.throws(() => f.engine.summaries(), hasCode('SERVICE_UNAVAILABLE'));
    assert.equal(f.bytes(), before);
  }
});
test('failed storage or asset reads do not partly save fields, images or receipt mappings', () => {
  const f = fixture(),
    request = { ...body(f.draft, images(f)), fields: { title: 'not saved' } },
    before = f.bytes();
  f.failSave(true);
  assert.throws(
    () => f.engine.save(f.draft.product_id, request, 'a'),
    hasCode('SERVICE_UNAVAILABLE'),
  );
  assert.equal(f.bytes(), before);
  f.failSave(false);
  f.failAssets(true);
  assert.throws(
    () => f.engine.save(f.draft.product_id, request, 'a'),
    hasCode('SERVICE_UNAVAILABLE'),
  );
  assert.equal(f.bytes(), before);
  f.failAssets(false);
  assert.equal(f.engine.save(f.draft.product_id, request, 'a').product.images.length, 3);
});
test('gallery responses and id mappings cannot mutate records or persisted replay results', () => {
  const f = fixture(),
    request = body(f.draft, images(f)),
    a = f.engine.save(f.draft.product_id, request, 'a'),
    before = f.bytes();
  a.product.images[0].url = 'tamper';
  a.id_map[0].id = 'tamper';
  const replay = f.engine.save(f.draft.product_id, request, 'a');
  assert.notEqual(replay.product.images[0].url, 'tamper');
  assert.notEqual(replay.id_map[0].id, 'tamper');
  assert.equal(f.bytes(), before);
});
test('image choice helpers preserve request identities and reorder without mutating saved arrays', () => {
  const f = fixture(),
    a = f.engine.save(f.draft.product_id, body(f.draft, images(f)), 'a').product,
    before = structuredClone(a);
  let choices = draftImageChoices(a.images),
    moved = moveDraftImage(choices, 2, 0);
  assert.equal(moved[0].product_image_id, a.images[2].product_image_id);
  assert.deepEqual(a, before);
  assert.equal(moveDraftImage(choices, 0, -1), choices);
  assert.equal(moveDraftImage(choices, 0, 3), choices);
  assert.equal(addDraftImage(choices, f.assets[0]), choices);
  choices = addDraftImage(choices, f.assets[3]);
  assert.ok(choices[3].client_key);
  assert.equal(draftImageEdits(choices)[3].url, undefined);
  assert.equal(validSavedImages(a.images), true);
});
test('unknown image save retains original payload, replays one write and reads latest gallery', async () => {
  const f = fixture();
  let unknown = true;
  const gateway = {
    create: async (key) => f.engine.create(key),
    draft: async (id) => f.engine.draft(id),
    save: async (id, request, key) => {
      const saved = f.engine.save(id, request, key);
      if (unknown) throw Error('response lost');
      return saved;
    },
  };
  const store = new MerchantDraftStore(gateway),
    request = body(f.draft, images(f));
  await assert.rejects(store.save(f.draft.product_id, request));
  request.images.reverse();
  f.assets.splice(0);
  unknown = false;
  const count = f.writes(),
    saved = await store.retry();
  assert.equal(f.writes(), count);
  assert.equal(saved.images[0].asset_id, productMediaAssets[0].asset_id);
  assert.equal(store.getSnapshot().pending, null);
});
test('confirmed image save with failed readback only retries GET and returns stable image IDs', async () => {
  const f = fixture();
  let reads = 0,
    saves = 0;
  const store = new MerchantDraftStore({
    create: async (key) => f.engine.create(key),
    draft: async (id) => {
      reads++;
      if (reads <= 2) throw new CommerceError('SERVICE_UNAVAILABLE', 'read failed');
      return f.engine.draft(id);
    },
    save: async (id, request, key) => {
      saves++;
      return f.engine.save(id, request, key);
    },
  });
  await assert.rejects(store.save(f.draft.product_id, body(f.draft, images(f))));
  await assert.rejects(store.retry());
  const saved = await store.retry();
  assert.equal(saves, 1);
  assert.equal(reads, 3);
  assert.equal(saved.images.length, 3);
});
test('stale gallery edits cannot overwrite newer main-image choices', () => {
  const f = fixture(),
    a = f.engine.save(f.draft.product_id, body(f.draft, images(f)), 'a').product,
    b = f.engine.save(
      a.product_id,
      body(a, draftImageEdits(moveDraftImage(draftImageChoices(a.images), 2, 0))),
      'b',
    ).product;
  assert.throws(() => f.engine.save(a.product_id, body(a, []), 'old'), hasCode('EDIT_CONFLICT'));
  assert.equal(f.engine.draft(a.product_id).cover_image, b.cover_image);
});
