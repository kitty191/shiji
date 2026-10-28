import type { ProductDetail, ProductView, StoreBrief } from '../types/catalog.ts';
import type {
  CartAddRequest,
  CartDeletion,
  CartItem,
  CartQuantityRequest,
  CartRestoration,
  CartView,
} from '../types/cart.ts';
import { CartError, emptyCart } from '../lib/cart.ts';
import { completeSku, inStock } from '../lib/product.ts';

export interface StoredItem {
  item_id: string;
  sku_id: string;
  quantity: number;
  snapshot: {
    product_id: string;
    name: string;
    store: StoreBrief;
    image_url: string | null;
    spec_values: CartItem['spec_values'];
  };
}
export interface PersistedCart {
  version: 1;
  items: StoredItem[];
  checkout?: unknown;
}
interface Options {
  catalog: () => readonly ProductView[];
  load?: () => string | null;
  save?: (data: string) => void;
  id?: () => string;
  now?: () => number;
}
function validItem(value: unknown): value is StoredItem {
  if (!value || typeof value !== 'object') return false;
  const row = value as StoredItem,
    snap = row.snapshot;
  return (
    typeof row.item_id === 'string' &&
    typeof row.sku_id === 'string' &&
    Number.isSafeInteger(row.quantity) &&
    row.quantity > 0 &&
    !!snap &&
    typeof snap.product_id === 'string' &&
    typeof snap.name === 'string' &&
    !!snap.store &&
    typeof snap.store.store_id === 'string' &&
    typeof snap.store.name === 'string' &&
    (snap.image_url === null || typeof snap.image_url === 'string') &&
    Array.isArray(snap.spec_values) &&
    snap.spec_values.every(
      (value) => typeof value?.dimension_name === 'string' && typeof value.value === 'string',
    )
  );
}

export function parseCartSnapshot(raw: string | null): PersistedCart {
  try {
    if (raw === null) return { version: 1, items: [] };
    const data = JSON.parse(raw) as PersistedCart;
    if (
      data?.version !== 1 ||
      !Array.isArray(data.items) ||
      !data.items.every(validItem) ||
      new Set(data.items.map((item) => item.item_id)).size !== data.items.length ||
      new Set(data.items.map((item) => item.sku_id)).size !== data.items.length
    )
      throw Error('Invalid cart snapshot');
    return data;
  } catch {
    throw new CartError(
      'SERVICE_UNAVAILABLE',
      '暂时无法读取购物车，请稍后重试；已有商品未被覆盖。',
    );
  }
}

// A local demo account only. No authentication, database or stock reservation.
export class MockCart {
  private items: StoredItem[] = [];
  private checkout: unknown;
  private receipts = new Map<string, { fingerprint: string; result: unknown }>();
  private deletions = new Map<
    string,
    { rows: StoredItem[]; until: number; result?: CartRestoration }
  >();
  private options: Options;
  constructor(options: Options) {
    this.options = options;
  }
  private readSnapshot(): void {
    if (!this.options.load) return;
    try {
      const data = parseCartSnapshot(this.options.load());
      this.items = data.items;
      this.checkout = data.checkout;
    } catch {
      throw new CartError(
        'SERVICE_UNAVAILABLE',
        '暂时无法读取购物车，请稍后重试；已有商品未被覆盖。',
      );
    }
  }
  private materialize(row: StoredItem): CartItem {
    const product = this.options
      .catalog()
      .find((item) => item.product_id === row.snapshot.product_id);
    const sku =
      product?.view_status === 'ON_SALE'
        ? product.skus.find((item) => item.sku_id === row.sku_id && completeSku(product, item))
        : undefined;
    const status = !product
      ? 'NOT_AVAILABLE'
      : product.view_status === 'OFF_SALE'
        ? 'PRODUCT_OFF_SALE'
        : !sku
          ? 'SPEC_DISABLED'
          : !inStock(sku)
            ? 'SOLD_OUT'
            : row.quantity > sku.available_stock
              ? 'INSUFFICIENT_STOCK'
              : 'AVAILABLE';
    const navigation: CartItem['navigation'] = !product
      ? { type: 'NONE', scope: 'NONE', target_id: null }
      : status === 'PRODUCT_OFF_SALE'
        ? { type: 'OFF_SALE_PRODUCT', scope: 'PUBLIC', target_id: product.product_id }
        : status === 'SPEC_DISABLED'
          ? { type: 'STORE', scope: 'PUBLIC', target_id: product.store.store_id }
          : { type: 'PRODUCT', scope: 'PUBLIC', target_id: product.product_id };
    let image = row.snapshot.image_url;
    if (product?.view_status === 'ON_SALE')
      image =
        product.images.find((item) => item.image_id === sku?.image_id)?.url || product.cover_image;
    return {
      item_id: row.item_id,
      sku_id: row.sku_id,
      product_id: row.snapshot.product_id,
      name: row.snapshot.name,
      spec_values: structuredClone(row.snapshot.spec_values),
      image_url: image,
      quantity: row.quantity,
      unit_price: sku?.price ?? null,
      line_amount: sku ? sku.price * row.quantity : null,
      available_stock: sku?.available_stock ?? null,
      purchase_status: status,
      purchasable: status === 'AVAILABLE',
      image_disabled: status === 'SPEC_DISABLED' || status === 'NOT_AVAILABLE',
      navigation,
    };
  }
  read(): CartView {
    this.readSnapshot();
    const view = emptyCart();
    for (const row of this.items) {
      const product = this.options
        .catalog()
        .find((item) => item.product_id === row.snapshot.product_id);
      const store = product?.store ?? row.snapshot.store;
      let group = view.groups.find((item) => item.store.store_id === store.store_id);
      if (!group) {
        group = { store: { ...store }, items: [] };
        view.groups.push(group);
      }
      group.items.push(this.materialize(row));
      view.item_count += 1;
      view.quantity_total += row.quantity;
    }
    return view;
  }
  add(request: CartAddRequest, key: string): CartItem {
    if (!key || !Number.isSafeInteger(request.quantity) || request.quantity < 1)
      throw new CartError('INVALID_ARGUMENT', '请检查加入数量。');
    const fingerprint = JSON.stringify([request.sku_id, request.quantity]);
    const receipt = this.replay<CartItem>(key, `add:${fingerprint}`);
    if (receipt) return receipt;
    this.readSnapshot();
    let product: ProductDetail | undefined;
    for (const candidate of this.options.catalog()) {
      if (
        candidate.view_status === 'ON_SALE' &&
        candidate.skus.some((item) => item.sku_id === request.sku_id)
      ) {
        product = candidate;
        break;
      }
    }
    const sku = product?.skus.find((item) => item.sku_id === request.sku_id);
    if (!product || !sku || !completeSku(product, sku) || !inStock(sku))
      throw new CartError('ITEM_NOT_PURCHASABLE', '所选规格暂时不能购买，请重新查看商品。');
    const existing = this.items.find((item) => item.sku_id === request.sku_id);
    const quantity = (existing?.quantity ?? 0) + request.quantity;
    if (!Number.isSafeInteger(quantity) || !Number.isSafeInteger(quantity * sku.price))
      throw new CartError('INVALID_ARGUMENT', '加入数量超出范围。');
    if (quantity > sku.available_stock)
      throw new CartError(
        'INSUFFICIENT_STOCK',
        `库存仅剩 ${sku.available_stock} 件${existing ? `，购物车中已有 ${existing.quantity} 件` : ''}，请调整加入数量。`,
      );
    const next = structuredClone(this.items);
    let row = next.find((item) => item.sku_id === request.sku_id);
    if (row) row.quantity = quantity;
    else {
      row = {
        item_id: (this.options.id ?? (() => crypto.randomUUID()))(),
        sku_id: sku.sku_id,
        quantity,
        snapshot: {
          product_id: product.product_id,
          name: product.name,
          store: { ...product.store },
          image_url: product.cover_image,
          spec_values: product.dimensions.map((dimension) => ({
            dimension_name: dimension.name,
            value: dimension.values.find(
              (value) =>
                value.value_id ===
                sku.spec_values.find((item) => item.dimension_id === dimension.dimension_id)
                  ?.value_id,
            )!.value,
          })),
        },
      };
      next.push(row);
    }
    this.commit(next);
    const result = this.materialize(row);
    this.remember(key, `add:${fingerprint}`, result);
    return result;
  }
  private replay<T>(key: string, fingerprint: string): T | undefined {
    if (!key) throw new CartError('INVALID_ARGUMENT', '操作标记不能为空。');
    const receipt = this.receipts.get(key);
    if (!receipt) return undefined;
    if (receipt.fingerprint !== fingerprint)
      throw new CartError('IDEMPOTENCY_CONFLICT', '操作标记与请求不一致。');
    return structuredClone(receipt.result) as T;
  }
  private remember(key: string, fingerprint: string, result: unknown): void {
    this.receipts.set(key, { fingerprint, result: structuredClone(result) });
    while (this.receipts.size > 200) this.receipts.delete(this.receipts.keys().next().value!);
  }
  private commit(next: StoredItem[]): void {
    try {
      this.options.save?.(
        JSON.stringify({
          version: 1,
          items: next,
          ...(this.checkout === undefined ? {} : { checkout: this.checkout }),
        }),
      );
    } catch {
      throw new CartError('SERVICE_UNAVAILABLE', '暂时无法保存购物车，请稍后重试。');
    }
    this.items = next;
  }
  update(itemId: string, request: CartQuantityRequest, key: string): CartItem {
    const fingerprint = JSON.stringify([
      'update',
      itemId,
      request.quantity,
      request.expected_quantity,
    ]);
    const replay = this.replay<CartItem>(key, fingerprint);
    if (replay) return replay;
    this.readSnapshot();
    if (
      ![request.quantity, request.expected_quantity].every(
        (value) => Number.isSafeInteger(value) && value > 0,
      )
    )
      throw new CartError('INVALID_ARGUMENT', '数量必须为正整数。');
    const row = this.items.find((item) => item.item_id === itemId);
    if (!row || row.quantity !== request.expected_quantity)
      throw new CartError(
        'CART_CHANGED',
        '商品数量已在其他页面变化，已重新核对购物车，请确认后再修改。',
      );
    const current = this.materialize(row);
    if (!['AVAILABLE', 'INSUFFICIENT_STOCK'].includes(current.purchase_status))
      throw new CartError('ITEM_NOT_PURCHASABLE', '所选商品暂时不能购买，无法修改数量。');
    if (request.quantity > current.available_stock!)
      throw new CartError(
        'INSUFFICIENT_STOCK',
        `当前库存仅剩 ${current.available_stock} 件，请确认后再修改。`,
      );
    if (!Number.isSafeInteger(request.quantity * current.unit_price!))
      throw new CartError('INVALID_ARGUMENT', '数量超出范围。');
    const next = structuredClone(this.items),
      updated = next.find((item) => item.item_id === itemId)!;
    updated.quantity = request.quantity;
    this.commit(next);
    const result = this.materialize(updated);
    this.remember(key, fingerprint, result);
    return result;
  }
  remove(itemIds: readonly string[], key: string): CartDeletion {
    if (!itemIds.length || itemIds.length > 50 || new Set(itemIds).size !== itemIds.length)
      throw new CartError('INVALID_ARGUMENT', '每次请选择 1 至 50 个不同商品项。');
    const fingerprint = JSON.stringify(['remove', [...itemIds].sort()]);
    const replay = this.replay<CartDeletion>(key, fingerprint);
    if (replay) return replay;
    this.readSnapshot();
    const rows = itemIds.map((id) => this.items.find((item) => item.item_id === id));
    if (rows.some((row) => !row))
      throw new CartError('CART_CHANGED', '部分商品项已变化，本次未删除，请重新确认。');
    const token = `undo_${(this.options.id ?? (() => crypto.randomUUID()))()}`;
    const until = (this.options.now ?? Date.now)() + 8000;
    this.commit(this.items.filter((item) => !itemIds.includes(item.item_id)));
    this.deletions.set(token, { rows: structuredClone(rows as StoredItem[]), until });
    while (this.deletions.size > 200) this.deletions.delete(this.deletions.keys().next().value!);
    const result = {
      deleted_item_ids: [...itemIds],
      restore_token: token,
      undo_expires_at: new Date(until).toISOString(),
    };
    this.remember(key, fingerprint, result);
    return result;
  }
  restore(token: string, key: string): CartRestoration {
    const fingerprint = JSON.stringify(['restore', token]);
    const replay = this.replay<CartRestoration>(key, fingerprint);
    if (replay) return replay;
    const record = this.deletions.get(token);
    if (record?.result) {
      this.remember(key, fingerprint, record.result);
      return structuredClone(record.result);
    }
    if (!record || record.until <= (this.options.now ?? Date.now)())
      throw new CartError('RESTORE_EXPIRED', '已超过 8 秒撤销时间。');
    this.readSnapshot();
    const next = structuredClone(this.items),
      restored: StoredItem[] = [];
    for (const saved of record.rows) {
      let row = next.find((item) => item.sku_id === saved.sku_id);
      if (row) {
        if (!Number.isSafeInteger(row.quantity + saved.quantity))
          throw new CartError('INVALID_ARGUMENT', '恢复后的数量超出范围。');
        row.quantity += saved.quantity;
      } else {
        row = structuredClone(saved);
        next.push(row);
      }
      const view = this.materialize(row);
      if (view.line_amount !== null && !Number.isSafeInteger(view.line_amount))
        throw new CartError('INVALID_ARGUMENT', '恢复后的金额超出范围。');
      restored.push(row);
    }
    this.commit(next);
    const result = { items: restored.map((row) => this.materialize(row)) };
    record.result = structuredClone(result);
    this.remember(key, fingerprint, result);
    return result;
  }
}
