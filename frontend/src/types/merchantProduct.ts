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

export interface DraftFields { title: string | null; category_id: string | null; description: string | null; display_price_override: number | null }
export interface MerchantDraft extends MerchantProductSummary, DraftFields {
  sale_status: 'DRAFT'; published_at: null; created_at: string; attributes: { name: string; value: string }[];
  platform_restriction_reason: null; images: MerchantProductImage[]; dimensions: never[]; historical_dimensions: never[]; skus: never[];
}
export interface MerchantProductImage { product_image_id: string; asset_id: string; url: string; sort_order: number }
export type ImageEdit = { asset_id: string; product_image_id: string; client_key?: never } | { asset_id: string; client_key: string; product_image_id?: never };
export interface ImageIdMapping { kind: 'IMAGE'; client_key: string; id: string }
export interface ProductMediaAsset { asset_id: string; url: string; content_type: string; size_bytes: number; status: 'READY'; created_at: string }
export interface OwnedProductMediaAsset extends ProductMediaAsset { owner_store_id: string; purpose: 'PRODUCT_IMAGE' }
export interface DraftSaveRequest { edit_token: string; fields?: Partial<DraftFields>; images?: ImageEdit[] }
export interface MerchantDraftGateway {
  create(key: string): Promise<MerchantDraft>;
  draft(id: string): Promise<MerchantDraft>;
  save(id: string, request: DraftSaveRequest, key: string): Promise<{ product: MerchantDraft; id_map: ImageIdMapping[] }>;
}
