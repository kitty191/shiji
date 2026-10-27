import type { MerchantProductQuery, MerchantProductSummary } from '../types/merchantProduct.ts';

export const merchantProductStatuses = { ON_SALE: '在售', OFF_SALE: '已下架', DRAFT: '草稿' } as const;
export const merchantProductPageSize = 12;
export function readMerchantProductQuery(params: URLSearchParams): MerchantProductQuery {
  const status = params.get('sale_status') || '', page = params.get('page') || '1';
  return { keyword: (params.get('keyword') || '').slice(0, 120), sale_status: Object.hasOwn(merchantProductStatuses, status) ? status as MerchantProductQuery['sale_status'] : '',
    page: /^[1-9]\d*$/.test(page) && Number.isSafeInteger(Number(page)) ? Number(page) : 1, page_size: merchantProductPageSize };
}
export function merchantProductParams(query: MerchantProductQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.keyword) params.set('keyword', query.keyword);
  if (query.sale_status) params.set('sale_status', query.sale_status);
  if (query.page > 1) params.set('page', String(query.page));
  return params;
}
const integer = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
const text = (s: unknown) => s === null || typeof s === 'string';
const date = (s: unknown) => typeof s === 'string' && Number.isFinite(Date.parse(s));
export function isMerchantProduct(value: unknown): value is MerchantProductSummary {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const p = value as Record<string, unknown>;
  return typeof p.product_id === 'string' && !!p.product_id && typeof p.store_id === 'string' && !!p.store_id && text(p.title) && text(p.cover_image) &&
    typeof p.sale_status === 'string' && Object.hasOwn(merchantProductStatuses, p.sale_status) && (p.platform_status === 'NORMAL' || p.platform_status === 'RESTRICTED') &&
    (p.display_price === null || integer(p.display_price)) && (p.display_price_override === null || integer(p.display_price_override)) &&
    integer(p.sku_count) && integer(p.available_stock_total) && (p.published_at === null || date(p.published_at)) && date(p.updated_at) && typeof p.edit_token === 'string';
}
