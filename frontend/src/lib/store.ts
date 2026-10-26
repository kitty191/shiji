import type { MockProduct, ProductPage } from '../types/catalog.ts';
import { readQuery, selectProducts } from './catalog.ts';

export const storePageSize = 12;
export function selectStoreProducts(products: readonly MockProduct[], storeId: string): ProductPage {
  return selectProducts(products.filter(product => product.store.store_id === storeId), {
    ...readQuery(new URLSearchParams()), page_size: storePageSize,
  });
}
export function storeProductsParams(storeId: string): URLSearchParams {
  return new URLSearchParams({ store_id: storeId, page: '1', page_size: String(storePageSize) });
}
