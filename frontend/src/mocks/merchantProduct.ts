import type { ProductDetail, StoreBrief } from '../types/catalog.ts';
import type { MerchantProductPage, MerchantProductQuery, MerchantProductSummary } from '../types/merchantProduct.ts';
import { CommerceError } from '../lib/commerce.ts';
import { isMerchantProduct, merchantProductStatuses } from '../lib/merchantProduct.ts';

// Adapt existing private mock records, including the ledger's currently available stock.
// This does not infer private drafts/off-sale records from a public API or create new products.
export function merchantCatalogSummaries(products: ProductDetail[]): MerchantProductSummary[] {
  return products.map(p => ({ product_id: p.product_id, store_id: p.store.store_id, title: p.name, cover_image: p.cover_image,
    sale_status: 'ON_SALE', platform_status: 'NORMAL', display_price_override: p.display_price_source === 'MERCHANT' ? p.display_price : null,
    display_price: p.display_price, sku_count: p.skus.length, available_stock_total: p.skus.reduce((sum, sku) => sum + sku.available_stock, 0),
    published_at: p.published_at, updated_at: p.published_at, edit_token: `mock-read-only:${p.product_id}` }));
}
export class MockMerchantProducts {
  private options: { store: () => StoreBrief | null; products: () => MerchantProductSummary[] };
  constructor(options: { store: () => StoreBrief | null; products: () => MerchantProductSummary[] }) { this.options = options; }
  products(query: MerchantProductQuery): MerchantProductPage {
    const store = this.options.store();
    if (!store?.store_id || !store.name) throw new CommerceError('FORBIDDEN', '当前账号没有可查看的店铺商品。');
    if (typeof query.keyword !== 'string' || typeof query.sale_status !== 'string' || (query.sale_status && !Object.hasOwn(merchantProductStatuses, query.sale_status)) ||
      !Number.isSafeInteger(query.page) || query.page < 1 || !Number.isSafeInteger(query.page_size) || query.page_size < 1 || query.page_size > 50) throw new CommerceError('INVALID_ARGUMENT', '商品筛选条件无效，请重新查询。');
    let source: MerchantProductSummary[];
    try { source = this.options.products(); }
    catch (error) { if (error instanceof CommerceError) throw error; throw new CommerceError('SERVICE_UNAVAILABLE', '暂时无法读取本店商品，请稍后重试。'); }
    if (!Array.isArray(source)) throw new CommerceError('SERVICE_UNAVAILABLE', '本店商品资料暂时不可用。');
    const owned = source.filter(p => p?.store_id === store.store_id), ids = new Set<string>();
    if (owned.some(p => { if (!isMerchantProduct(p) || ids.has(p.product_id)) return true; ids.add(p.product_id); return false; })) throw new CommerceError('SERVICE_UNAVAILABLE', '本店商品资料暂时不可用。');
    const keyword = query.keyword.trim().toLocaleLowerCase();
    const rows = owned.filter(p => (!query.sale_status || p.sale_status === query.sale_status) && (!keyword || (p.title || '').toLocaleLowerCase().includes(keyword)))
      .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at) || (a.product_id < b.product_id ? -1 : a.product_id > b.product_id ? 1 : 0));
    const start = (query.page - 1) * query.page_size;
    const items = rows.slice(start, start + query.page_size).map(({ product_id, store_id, title, cover_image, sale_status, platform_status, display_price_override, display_price, sku_count, available_stock_total, published_at, updated_at, edit_token }) =>
      ({ product_id, store_id, title, cover_image, sale_status, platform_status, display_price_override, display_price, sku_count, available_stock_total, published_at, updated_at, edit_token }));
    return { items, page: query.page, page_size: query.page_size, total: rows.length, has_more: start + query.page_size < rows.length };
  }
}
