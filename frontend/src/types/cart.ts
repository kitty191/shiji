import type { StoreBrief } from './catalog.ts';

export type PurchaseStatus = 'AVAILABLE' | 'INSUFFICIENT_STOCK' | 'SOLD_OUT' | 'SPEC_DISABLED' | 'PRODUCT_OFF_SALE' | 'NOT_AVAILABLE';
export interface CartItem {
  item_id: string; sku_id: string; product_id: string; name: string;
  spec_values: { dimension_name: string; value: string }[]; image_url: string | null;
  quantity: number; unit_price: number | null; line_amount: number | null; available_stock: number | null;
  purchase_status: PurchaseStatus; purchasable: boolean; image_disabled: boolean;
  navigation: { type: 'PRODUCT' | 'STORE' | 'OFF_SALE_PRODUCT' | 'NONE'; scope: 'PUBLIC' | 'NONE'; target_id: string | null };
}
export interface CartView {
  groups: { store: StoreBrief; items: CartItem[] }[]; item_count: number; quantity_total: number; currency: 'CNY';
}
export interface CartAddRequest { sku_id: string; quantity: number }
export interface CartGateway {
  read(): Promise<CartView>;
  add(request: CartAddRequest, idempotencyKey: string): Promise<CartItem>;
}
