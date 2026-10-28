import type {
  CatalogQuery,
  Category,
  ProductCard,
  ProductPage,
  PublicStore,
} from '../types/catalog.ts';
import { storePageSize } from './store.ts';

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const id = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const nonnegativeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const nullableText = (value: unknown) => value === null || typeof value === 'string';

export function isCategoryResult(value: unknown): value is { items: Category[] } {
  if (!record(value) || !Array.isArray(value.items)) return false;
  const ids = new Set<string>();
  return value.items.every((item) => {
    if (
      !record(item) ||
      !id(item.category_id) ||
      ids.has(item.category_id) ||
      !nullableText(item.parent_id) ||
      typeof item.name !== 'string' ||
      typeof item.sort_order !== 'number' ||
      !Number.isSafeInteger(item.sort_order)
    )
      return false;
    ids.add(item.category_id);
    return true;
  });
}

export function isPublicStore(value: unknown, storeId: string): value is PublicStore {
  return (
    record(value) &&
    value.store_id === storeId &&
    typeof value.name === 'string' &&
    typeof value.description === 'string' &&
    nullableText(value.logo_url) &&
    id(value.main_category_id)
  );
}

function isStoreProduct(value: unknown, storeId: string): value is ProductCard {
  return (
    record(value) &&
    id(value.product_id) &&
    typeof value.name === 'string' &&
    id(value.category_id) &&
    nullableText(value.cover_image) &&
    record(value.store) &&
    value.store.store_id === storeId &&
    typeof value.store.name === 'string' &&
    nonnegativeInteger(value.display_price) &&
    nonnegativeInteger(value.min_price) &&
    nonnegativeInteger(value.max_price) &&
    value.min_price <= value.max_price &&
    (value.display_price_source === 'MERCHANT' || value.display_price_source === 'AUTO') &&
    value.currency === 'CNY' &&
    (value.stock_status === 'IN_STOCK' || value.stock_status === 'SOLD_OUT')
  );
}

export function isStoreProductPage(
  value: unknown,
  storeId: string,
  query: CatalogQuery,
): value is ProductPage {
  if (
    !record(value) ||
    value.page !== query.page ||
    value.page_size !== storePageSize ||
    !nonnegativeInteger(value.total) ||
    typeof value.has_more !== 'boolean' ||
    !nullableText(value.feed_token) ||
    !Array.isArray(value.items)
  )
    return false;
  const start = (query.page - 1) * storePageSize,
    expected = Math.max(0, Math.min(storePageSize, value.total - start));
  if (
    value.items.length !== expected ||
    value.has_more !== start + value.items.length < value.total
  )
    return false;
  const ids = new Set<string>();
  return value.items.every((item) => {
    if (!isStoreProduct(item, storeId) || ids.has(item.product_id)) return false;
    ids.add(item.product_id);
    return true;
  });
}
