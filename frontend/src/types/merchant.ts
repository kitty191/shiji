import type { BuyerOrder, OrderQuery } from './commerce.ts';

// Whitelist the F01/F02 projections; merchant reads never receive a payment group or sibling orders.
export type MerchantOrderSummary = Pick<
  BuyerOrder,
  | 'order_id'
  | 'order_no'
  | 'store_id'
  | 'store_name'
  | 'status'
  | 'goods_amount'
  | 'shipping_amount'
  | 'total_amount'
  | 'items'
  | 'currency'
  | 'created_at'
  | 'allowed_actions'
>;
export interface MerchantOrderDetail
  extends MerchantOrderSummary,
    Pick<
      BuyerOrder,
      | 'address'
      | 'payment_status'
      | 'paid_at'
      | 'shipping_carrier'
      | 'tracking_no'
      | 'shipped_at'
      | 'received_at'
      | 'closed_at'
      | 'close_reason'
    > {}
export interface MerchantOrderQuery extends OrderQuery {
  keyword: string;
}
export interface MerchantOrderPage {
  items: MerchantOrderSummary[];
  page: number;
  page_size: number;
  total: number;
  has_more: boolean;
}
export interface ShipRequest {
  shipping_carrier: string;
  tracking_no: string;
}
export interface MerchantGateway {
  ship(id: string, request: ShipRequest, key: string): Promise<MerchantOrderDetail>;
  orders(query: MerchantOrderQuery): Promise<MerchantOrderPage>;
  order(id: string): Promise<MerchantOrderDetail>;
}
