// G01 read-only projection from docs/openapi.json; money is integer cents.
export type SaleStatus = 'DRAFT' | 'ON_SALE' | 'OFF_SALE';
export interface MerchantProductSummary {
  product_id: string; store_id: string; title: string | null; cover_image: string | null;
  sale_status: SaleStatus; platform_status: 'NORMAL' | 'RESTRICTED';
  display_price_override: number | null; display_price: number | null;
  sku_count: number; available_stock_total: number; published_at: string | null; updated_at: string; edit_token: string;
}
export interface MerchantProductQuery { keyword: string; sale_status: SaleStatus | ''; page: number; page_size: number }
export interface MerchantProductPage { items: MerchantProductSummary[]; page: number; page_size: number; total: number; has_more: boolean }
export interface MerchantProductsGateway { products(query: MerchantProductQuery): Promise<MerchantProductPage> }
