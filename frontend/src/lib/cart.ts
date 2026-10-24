import type { CartView, PurchaseStatus } from '../types/cart.ts';
import type { ResultCode } from '../types/result.ts';

export class CartError extends Error {
  readonly code: ResultCode;
  readonly retryable: boolean;
  constructor(code: ResultCode, message: string, retryable = false) {
    super(message); this.name = 'CartError'; this.code = code; this.retryable = retryable;
  }
}
export function emptyCart(): CartView { return { groups: [], item_count: 0, quantity_total: 0, currency: 'CNY' }; }
export function cartSubtotal(view: CartView): number {
  return view.groups.reduce((sum, group) => sum + group.items.reduce((amount, item) => amount +
    (item.purchasable && item.line_amount !== null ? item.line_amount : 0), 0), 0);
}
export const purchaseStatusText: Record<PurchaseStatus, string> = {
  AVAILABLE: '', INSUFFICIENT_STOCK: '库存不足', SOLD_OUT: '已售罄', SPEC_DISABLED: '所选商品不能购买',
  PRODUCT_OFF_SALE: '商品已下架', NOT_AVAILABLE: '当前商品无法购买',
};
