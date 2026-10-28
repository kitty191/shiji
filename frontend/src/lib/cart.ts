import type { CartItem, CartView, PurchaseStatus } from '../types/cart.ts';
import type { ResultCode } from '../types/result.ts';
import { productReturnPath } from './product.ts';

export class CartError extends Error {
  readonly code: ResultCode;
  readonly retryable: boolean;
  constructor(code: ResultCode, message: string, retryable = false) {
    super(message);
    this.name = 'CartError';
    this.code = code;
    this.retryable = retryable;
  }
}
export function emptyCart(): CartView {
  return { groups: [], item_count: 0, quantity_total: 0, currency: 'CNY' };
}
export function cartSubtotal(view: CartView): number {
  return view.groups.reduce(
    (sum, group) =>
      sum +
      group.items.reduce(
        (amount, item) =>
          amount + (item.purchasable && item.line_amount !== null ? item.line_amount : 0),
        0,
      ),
    0,
  );
}
export type CartChoices = Record<string, boolean>;
export function selectableCartItem(item: CartItem): boolean {
  return item.purchasable && item.unit_price !== null && item.line_amount !== null;
}
export function cartCheckState(items: readonly CartItem[], choices: CartChoices) {
  const eligible = items.filter(selectableCartItem);
  const selected = eligible.filter((item) => choices[item.item_id] !== false);
  return {
    checked: eligible.length > 0 && selected.length === eligible.length,
    mixed: selected.length > 0 && selected.length < eligible.length,
    disabled: !eligible.length,
  };
}
export function cartSelectionSummary(view: CartView, choices: CartChoices) {
  const selected = view.groups.flatMap((group) =>
    group.items.filter((item) => selectableCartItem(item) && choices[item.item_id] !== false),
  );
  return {
    item_count: selected.length,
    quantity_total: selected.reduce((sum, item) => sum + item.quantity, 0),
    store_count: view.groups.filter((group) => group.items.some((item) => selected.includes(item)))
      .length,
    amount: selected.reduce((sum, item) => sum + item.line_amount!, 0),
  };
}
export function cartItemTarget(
  item: CartItem,
  returnTo: string,
): { type: 'product'; to: string } | { type: 'store' } | null {
  const nav = item.navigation;
  if (nav.scope !== 'PUBLIC' || !nav.target_id) return null;
  if (nav.type === 'STORE') return { type: 'store' };
  if (nav.type === 'PRODUCT' || nav.type === 'OFF_SALE_PRODUCT')
    return {
      type: 'product',
      to: `/products/${encodeURIComponent(nav.target_id)}?${new URLSearchParams({ sku_id: item.sku_id, return_to: productReturnPath(returnTo) })}`,
    };
  return null;
}
export const purchaseStatusText: Record<PurchaseStatus, string> = {
  AVAILABLE: '',
  INSUFFICIENT_STOCK: '库存不足',
  SOLD_OUT: '已售罄',
  SPEC_DISABLED: '所选商品不能购买',
  PRODUCT_OFF_SALE: '商品已下架',
  NOT_AVAILABLE: '当前商品无法购买',
};
