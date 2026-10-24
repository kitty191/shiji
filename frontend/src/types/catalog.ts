// Public catalog contracts follow docs/openapi.json; money is integer cents.
export interface StoreBrief { store_id: string; name: string }
export interface Category { category_id: string; parent_id: string | null; name: string; sort_order: number }
export interface ProductCard {
  product_id: string; name: string; category_id: string; cover_image: string | null;
  store: StoreBrief; display_price: number; display_price_source: 'MERCHANT' | 'AUTO';
  min_price: number; max_price: number; currency: 'CNY'; stock_status: 'IN_STOCK' | 'SOLD_OUT';
}
export interface ProductPage {
  items: ProductCard[]; page: number; page_size: number; total: number; has_more: boolean; feed_token: string | null;
}
export type Sort = 'default' | 'price_asc' | 'price_desc' | 'newest';
export interface CatalogQuery { keyword: string; category_id: string; min_price?: number; max_price?: number; sort: Sort; page: number; page_size: number; feed_token?: string }
export interface MockProduct extends ProductCard { published_order: number }
