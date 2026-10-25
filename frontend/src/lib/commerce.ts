import type { CheckoutSelection, OrderQuery, OrderStatus } from '../types/commerce.ts';
import type { ResultCode } from '../types/result.ts';
import { buyerReturnPath, cartPath, productReturnPath } from './product.ts';

export class CommerceError extends Error {
  code: ResultCode; retryable: boolean;
  constructor(code: ResultCode, message: string, retryable = false) { super(message); this.name = 'CommerceError'; this.code = code; this.retryable = retryable; }
}
export const orderStatuses: Record<OrderStatus, string> = { PENDING_PAYMENT: '待付款', PENDING_SHIPMENT: '待发货', PENDING_RECEIPT: '待收货', COMPLETED: '已完成', CLOSED: '已关闭' };
export function normalizeSelection(value: CheckoutSelection): CheckoutSelection {
  if (value.source === 'CART') {
    if (!Array.isArray(value.cart_item_ids) || !value.cart_item_ids.length || value.cart_item_ids.some(id => typeof id !== 'string' || !id) ||
      new Set(value.cart_item_ids).size !== value.cart_item_ids.length || 'items' in value) throw new CommerceError('INVALID_ARGUMENT', '请从购物车重新选择要结算的商品。');
    return { source: 'CART', cart_item_ids: [...value.cart_item_ids] };
  }
  if (value.source !== 'DIRECT' || 'cart_item_ids' in value || !Array.isArray(value.items) || value.items.length !== 1 ||
    typeof value.items[0]?.sku_id !== 'string' || !value.items[0].sku_id || !Number.isSafeInteger(value.items[0].quantity) || value.items[0].quantity < 1) throw new CommerceError('INVALID_ARGUMENT', '请从商品详情重新选择规格与数量。');
  return { source: 'DIRECT', items: [{ ...value.items[0] }] };
}
export function readCheckoutSelection(params: URLSearchParams): CheckoutSelection {
  if (params.get('source') === 'CART') return normalizeSelection({ source: 'CART', cart_item_ids: params.getAll('item_id') });
  if (params.get('source') === 'DIRECT') return normalizeSelection({ source: 'DIRECT', items: [{ sku_id: params.get('sku_id') || '', quantity: Number(params.get('quantity')) }] });
  throw new CommerceError('INVALID_ARGUMENT', '没有有效的结算内容，请重新选择商品。');
}
function checkoutParams(selection: CheckoutSelection): URLSearchParams {
  const next = normalizeSelection(selection), params = new URLSearchParams({ source: next.source });
  if (next.source === 'CART') next.cart_item_ids.forEach(id => params.append('item_id', id));
  else { params.set('sku_id', next.items[0].sku_id); params.set('quantity', String(next.items[0].quantity)); }
  return params;
}
export function checkoutBackPath(value: string | null): string {
  if (value?.startsWith('/products/') && !value.includes('#')) {
    const [path, query] = value.split('?');
    if (/^\/products\/[^/]+$/.test(path)) {
      const p = new URLSearchParams(query), next = new URLSearchParams();
      for (const field of ['sku_id', 'quantity', 'image_id']) if (p.has(field)) next.set(field, p.get(field)!);
      next.set('return_to', productReturnPath(p.get('return_to')));
      return `${path}?${next}`;
    }
  }
  return cartPath(value?.startsWith('/cart?') ? new URLSearchParams(value.slice(6)).get('return_to') : buyerReturnPath(value));
}
export function checkoutPath(selection: CheckoutSelection, returnTo: string): string {
  const params = checkoutParams(selection); params.set('return_to', checkoutBackPath(returnTo)); return `/checkout?${params}`;
}
export function addressReturnPath(value: string | null): string {
  if (value?.startsWith('/checkout?') && !value.includes('#')) {
    try {
      const raw = new URLSearchParams(value.slice(10)), params = checkoutParams(readCheckoutSelection(raw));
      params.set('return_to', checkoutBackPath(raw.get('return_to')));
      if (raw.get('address_id')) params.set('address_id', raw.get('address_id')!);
      return `/checkout?${params}`;
    } catch { /* A broken checkout return falls back to the buyer page. */ }
  }
  return buyerReturnPath(value);
}
export function readOrderQuery(params: URLSearchParams): OrderQuery {
  const status = params.get('status') || '', page = Number(params.get('page') || 1);
  return { status: Object.hasOwn(orderStatuses, status) ? status as OrderStatus : '', order_no: (params.get('order_no') || '').slice(0, 100),
    page: Number.isSafeInteger(page) && page > 0 ? page : 1, page_size: 12 };
}
export function ordersReturnPath(value: string | null): string {
  if (value === '/orders') return value;
  if (value?.startsWith('/orders?') && !value.includes('#')) {
    const q = readOrderQuery(new URLSearchParams(value.slice(8))), p = new URLSearchParams();
    if (q.status) p.set('status', q.status); if (q.order_no) p.set('order_no', q.order_no); if (q.page > 1) p.set('page', String(q.page));
    return `/orders${p.size ? `?${p}` : ''}`;
  }
  return '/orders';
}
// Payment pages may return to an order list or one order, never another checkout/payment page.
export function paymentReturnPath(value: string | null): string {
  if (value?.startsWith('/orders/') && !value.includes('#')) {
    const split = value.indexOf('?'), path = split < 0 ? value : value.slice(0, split);
    if (/^\/orders\/[^/?]+$/.test(path)) {
      const params = new URLSearchParams(split < 0 ? '' : value.slice(split + 1));
      return `${path}?${new URLSearchParams({ return_to: ordersReturnPath(params.get('return_to')) })}`;
    }
  }
  return ordersReturnPath(value);
}
export function paymentPath(id: string, returnTo: string | null = '/orders'): string {
  const path = `/payments/${encodeURIComponent(id)}`, back = paymentReturnPath(returnTo);
  return back === '/orders' ? path : `${path}?${new URLSearchParams({ return_to: back })}`;
}

export function formatDate(value: string): string { return new Date(value).toLocaleString('zh-CN', { hour12: false }); }
