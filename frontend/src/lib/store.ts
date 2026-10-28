import type { CatalogQuery, MockProduct, ProductPage } from '../types/catalog.ts';
import { queryParams, readQuery, selectProducts } from './catalog.ts';

export const storePageSize = 12;
export function selectStoreProducts(
  products: readonly MockProduct[],
  storeId: string,
  query: CatalogQuery = readQuery(new URLSearchParams()),
): ProductPage {
  return selectProducts(
    products.filter((product) => product.store.store_id === storeId),
    { ...query, page_size: storePageSize },
  );
}
export function storeProductsParams(
  storeId: string,
  query: CatalogQuery = readQuery(new URLSearchParams()),
): URLSearchParams {
  const params = queryParams(query);
  params.set('store_id', storeId);
  params.set('page', String(query.page));
  params.set('page_size', String(storePageSize));
  return params;
}
