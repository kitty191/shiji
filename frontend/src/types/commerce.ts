import type { AddressCreateRequest } from './address.ts';
import type { StoreBrief } from './catalog.ts';
import type { CartItem } from './cart.ts';

export type AddressSnapshot = Omit<AddressCreateRequest, 'is_default'>;
export type CheckoutSelection = { source: 'CART'; cart_item_ids: string[] } | { source: 'DIRECT'; items: { sku_id: string; quantity: number }[] };
export type CheckoutRequest = CheckoutSelection & { address_id: string };
export interface CheckoutLine {
  cart_item_id: string | null; sku_id: string; product_id: string; name: string; spec_values: CartItem['spec_values'];
  image_url: string | null; quantity: number; unit_price: number; line_amount: number;
}
export interface CheckoutGroup { store: StoreBrief; items: CheckoutLine[]; goods_amount: number; shipping_amount: number; total_amount: number }
export interface CheckoutPreview {
  source: 'CART' | 'DIRECT'; groups: CheckoutGroup[]; address: AddressSnapshot; total_amount: number; currency: 'CNY';
  checked_at: string; preview_token: string; preview_expires_at: string;
}
export type OrderStatus = 'PENDING_PAYMENT' | 'PENDING_SHIPMENT' | 'PENDING_RECEIPT' | 'COMPLETED' | 'CLOSED';
export interface OrderLine extends Omit<CheckoutLine, 'cart_item_id'> { order_item_id: string }
export interface PaymentOrderLink {
  order_id: string; order_no: string; store_id: string; store_name: string; status: OrderStatus;
  goods_amount: number; shipping_amount: number; total_amount: number;
}
export interface BuyerOrder extends PaymentOrderLink {
  payment_group_id: string; items: OrderLine[]; currency: 'CNY'; created_at: string; allowed_actions: string[];
  address: AddressSnapshot; payment_status: 'PENDING' | 'PAID' | 'CLOSED'; paid_at: string | null;
  shipping_carrier: string | null; tracking_no: string | null; shipped_at: string | null; received_at: string | null;
  closed_at: string | null; close_reason: string | null; payment_expires_at: string;
}
export interface PaymentGroup {
  payment_group_id: string; payment_no: string; status: 'PENDING' | 'PAID' | 'CLOSED'; total_amount: number; currency: 'CNY';
  expires_at: string; paid_at: string | null; closed_at: string | null; close_reason: string | null;
  created_at: string; checked_at: string; shop_orders: PaymentOrderLink[]; allowed_actions: string[];
}
export interface OrderQuery { status: OrderStatus | ''; order_no: string; page: number; page_size: number }
export interface OrderPage { items: BuyerOrder[]; page: number; page_size: number; total: number; has_more: boolean }
export interface CommerceGateway {
  preview(request: CheckoutRequest): Promise<CheckoutPreview>;
  submit(token: string, key: string): Promise<PaymentGroup>;
  pay(paymentId: string, key: string): Promise<PaymentGroup>;
  cancel(paymentId: string, key: string): Promise<PaymentGroup>;
  confirmReceipt(orderId: string, key: string): Promise<BuyerOrder>;
  orders(query: OrderQuery): Promise<OrderPage>;
  order(id: string): Promise<BuyerOrder>;
  payment(id: string): Promise<PaymentGroup>;
}
