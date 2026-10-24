import type { ProductDetail, ProductView, StoreBrief } from '../types/catalog.ts';
import type { CartAddRequest, CartItem, CartView } from '../types/cart.ts';
import { CartError, emptyCart } from '../lib/cart.ts';
import { completeSku, inStock } from '../lib/product.ts';

interface StoredItem {
  item_id: string; sku_id: string; quantity: number;
  snapshot: { product_id: string; name: string; store: StoreBrief; image_url: string | null; spec_values: CartItem['spec_values'] };
}
interface PersistedCart { version: 1; items: StoredItem[] }
interface Options {
  catalog: () => readonly ProductView[];
  load?: () => string | null;
  save?: (data: string) => void;
  id?: () => string;
}
function validItem(value: unknown): value is StoredItem {
  if (!value || typeof value !== 'object') return false;
  const row = value as StoredItem, snap = row.snapshot;
  return typeof row.item_id === 'string' && typeof row.sku_id === 'string' && Number.isSafeInteger(row.quantity) && row.quantity > 0 &&
    !!snap && typeof snap.product_id === 'string' && typeof snap.name === 'string' && !!snap.store &&
    typeof snap.store.store_id === 'string' && typeof snap.store.name === 'string' &&
    (snap.image_url === null || typeof snap.image_url === 'string') && Array.isArray(snap.spec_values) &&
    snap.spec_values.every(value => typeof value?.dimension_name === 'string' && typeof value.value === 'string');
}

// A local demo account only. No authentication, database or stock reservation.
export class MockCart {
  private items: StoredItem[] = [];
  private receipts = new Map<string, { fingerprint: string; result: CartItem }>();
  private options: Options;
  constructor(options: Options) {
    this.options = options;
    this.restore();
  }
  private restore(): void {
    if (!this.options.load) return;
    try {
      const data = JSON.parse(this.options.load() || 'null') as PersistedCart | null;
      if (data?.version === 1 && Array.isArray(data.items) && data.items.every(validItem) &&
        new Set(data.items.map(item => item.item_id)).size === data.items.length &&
        new Set(data.items.map(item => item.sku_id)).size === data.items.length) this.items = data.items;
      else this.items = [];
    } catch { /* An absent/invalid demo snapshot starts empty. */ }
  }
  private materialize(row: StoredItem): CartItem {
    const product = this.options.catalog().find(item => item.product_id === row.snapshot.product_id);
    const sku = product?.view_status === 'ON_SALE' ? product.skus.find(item => item.sku_id === row.sku_id && completeSku(product, item)) : undefined;
    const status = !product ? 'NOT_AVAILABLE' : product.view_status === 'OFF_SALE' ? 'PRODUCT_OFF_SALE' : !sku ? 'SPEC_DISABLED'
      : !inStock(sku) ? 'SOLD_OUT' : row.quantity > sku.available_stock ? 'INSUFFICIENT_STOCK' : 'AVAILABLE';
    const navigation: CartItem['navigation'] = !product ? { type: 'NONE', scope: 'NONE', target_id: null }
      : status === 'PRODUCT_OFF_SALE' ? { type: 'OFF_SALE_PRODUCT', scope: 'PUBLIC', target_id: product.product_id }
      : status === 'SPEC_DISABLED' ? { type: 'STORE', scope: 'PUBLIC', target_id: product.store.store_id }
      : { type: 'PRODUCT', scope: 'PUBLIC', target_id: product.product_id };
    let image = row.snapshot.image_url;
    if (product?.view_status === 'ON_SALE') image = product.images.find(item => item.image_id === sku?.image_id)?.url || product.cover_image;
    return { item_id: row.item_id, sku_id: row.sku_id, product_id: row.snapshot.product_id, name: row.snapshot.name,
      spec_values: structuredClone(row.snapshot.spec_values), image_url: image, quantity: row.quantity,
      unit_price: sku?.price ?? null, line_amount: sku ? sku.price * row.quantity : null, available_stock: sku?.available_stock ?? null,
      purchase_status: status, purchasable: status === 'AVAILABLE', image_disabled: status === 'SPEC_DISABLED' || status === 'NOT_AVAILABLE', navigation };
  }
  read(): CartView {
    this.restore();
    const view = emptyCart();
    for (const row of this.items) {
      const product = this.options.catalog().find(item => item.product_id === row.snapshot.product_id);
      const store = product?.store ?? row.snapshot.store;
      let group = view.groups.find(item => item.store.store_id === store.store_id);
      if (!group) { group = { store: { ...store }, items: [] }; view.groups.push(group); }
      group.items.push(this.materialize(row));
      view.item_count += 1; view.quantity_total += row.quantity;
    }
    return view;
  }
  add(request: CartAddRequest, key: string): CartItem {
    this.restore();
    if (!key || !Number.isSafeInteger(request.quantity) || request.quantity < 1) throw new CartError('INVALID_ARGUMENT', '请检查加入数量。');
    const fingerprint = JSON.stringify([request.sku_id, request.quantity]);
    const receipt = this.receipts.get(key);
    if (receipt) {
      if (receipt.fingerprint !== fingerprint) throw new CartError('IDEMPOTENCY_CONFLICT', '操作标记与请求不一致。');
      return structuredClone(receipt.result);
    }
    let product: ProductDetail | undefined;
    for (const candidate of this.options.catalog()) {
      if (candidate.view_status === 'ON_SALE' && candidate.skus.some(item => item.sku_id === request.sku_id)) { product = candidate; break; }
    }
    const sku = product?.skus.find(item => item.sku_id === request.sku_id);
    if (!product || !sku || !completeSku(product, sku) || !inStock(sku)) throw new CartError('ITEM_NOT_PURCHASABLE', '所选规格暂时不能购买，请重新查看商品。');
    const existing = this.items.find(item => item.sku_id === request.sku_id);
    const quantity = (existing?.quantity ?? 0) + request.quantity;
    if (!Number.isSafeInteger(quantity) || !Number.isSafeInteger(quantity * sku.price)) throw new CartError('INVALID_ARGUMENT', '加入数量超出范围。');
    if (quantity > sku.available_stock) throw new CartError('INSUFFICIENT_STOCK', `库存仅剩 ${sku.available_stock} 件${existing ? `，购物车中已有 ${existing.quantity} 件` : ''}，请调整加入数量。`);
    const next = structuredClone(this.items);
    let row = next.find(item => item.sku_id === request.sku_id);
    if (row) row.quantity = quantity;
    else {
      row = { item_id: (this.options.id ?? (() => crypto.randomUUID()))(), sku_id: sku.sku_id, quantity,
        snapshot: { product_id: product.product_id, name: product.name, store: { ...product.store }, image_url: product.cover_image,
          spec_values: product.dimensions.map(dimension => ({ dimension_name: dimension.name,
            value: dimension.values.find(value => value.value_id === sku.spec_values.find(item => item.dimension_id === dimension.dimension_id)?.value_id)!.value })) } };
      next.push(row);
    }
    try { this.options.save?.(JSON.stringify({ version: 1, items: next })); }
    catch { throw new CartError('SERVICE_UNAVAILABLE', '暂时无法保存购物车，请稍后重试。'); }
    this.items = next;
    const result = this.materialize(row);
    this.receipts.set(key, { fingerprint, result: structuredClone(result) });
    while (this.receipts.size > 200) this.receipts.delete(this.receipts.keys().next().value!);
    return result;
  }
}
