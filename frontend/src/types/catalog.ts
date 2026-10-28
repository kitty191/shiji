// Public catalog contracts follow docs/openapi.json; money is integer cents.
export interface StoreBrief {
  store_id: string;
  name: string;
}
export interface PublicStore extends StoreBrief {
  logo_url: string | null;
  description: string;
  main_category_id: string;
}
export interface Category {
  category_id: string;
  parent_id: string | null;
  name: string;
  sort_order: number;
}
export interface ProductCard {
  product_id: string;
  name: string;
  category_id: string;
  cover_image: string | null;
  store: StoreBrief;
  display_price: number;
  display_price_source: 'MERCHANT' | 'AUTO';
  min_price: number;
  max_price: number;
  currency: 'CNY';
  stock_status: 'IN_STOCK' | 'SOLD_OUT';
}
export interface ProductPage {
  items: ProductCard[];
  page: number;
  page_size: number;
  total: number;
  has_more: boolean;
  feed_token: string | null;
}
export type Sort = 'default' | 'price_asc' | 'price_desc' | 'newest';
export interface CatalogQuery {
  keyword: string;
  category_id: string;
  min_price?: number;
  max_price?: number;
  sort: Sort;
  page: number;
  page_size: number;
  feed_token?: string;
}
export interface MockProduct extends ProductCard {
  published_order: number;
}
export interface ProductImage {
  image_id: string;
  url: string;
  sort_order: number;
}
export interface SpecDimension {
  dimension_id: string;
  name: string;
  values: { value_id: string; value: string }[];
}
export interface PublicSku {
  sku_id: string;
  spec_values: { dimension_id: string; value_id: string }[];
  price: number;
  currency: 'CNY';
  available_stock: number;
  status: 'IN_STOCK' | 'SOLD_OUT';
  image_id: string | null;
  image_url: string | null;
}
export interface ProductDetail extends ProductCard {
  view_status: 'ON_SALE';
  description: string;
  attributes: { name: string; value: string }[];
  images: ProductImage[];
  dimensions: SpecDimension[];
  skus: PublicSku[];
  default_sku_id: string | null;
  published_at: string;
}
export interface OffSaleView {
  product_id: string;
  view_status: 'OFF_SALE';
  store: StoreBrief;
}
export type ProductView = ProductDetail | OffSaleView;
export interface RecommendationResult {
  items: ProductCard[];
  checked_at: string;
}
