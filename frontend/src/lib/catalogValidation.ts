import type {
  CatalogQuery,
  Category,
  ProductCard,
  ProductPage,
  PublicStore,
  ProductView,
  RecommendationResult,
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

export function isProductCard(value: unknown): value is ProductCard {
  return (
    record(value) &&
    id(value.product_id) &&
    typeof value.name === 'string' &&
    id(value.category_id) &&
    nullableText(value.cover_image) &&
    record(value.store) &&
    id(value.store.store_id) &&
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

export function isProductPage(value: unknown, query: CatalogQuery): value is ProductPage {
  if (
    !record(value) ||
    value.page !== query.page ||
    value.page_size !== query.page_size ||
    !nonnegativeInteger(value.total) ||
    typeof value.has_more !== 'boolean' ||
    !nullableText(value.feed_token) ||
    !Array.isArray(value.items)
  )
    return false;
  const start = (query.page - 1) * query.page_size;
  const expected = Math.max(0, Math.min(query.page_size, value.total - start));
  if (
    value.items.length !== expected ||
    value.has_more !== start + value.items.length < value.total
  )
    return false;
  return uniqueRows(value.items, 'product_id', isProductCard);
}

export function isStoreProductPage(
  value: unknown,
  storeId: string,
  query: CatalogQuery,
): value is ProductPage {
  return (
    query.page_size === storePageSize &&
    isProductPage(value, query) &&
    value.items.every((item) => item.store.store_id === storeId)
  );
}

function uniqueRows(
  value: unknown,
  key: string,
  valid: (row: Record<string, unknown>) => boolean,
): boolean {
  if (!Array.isArray(value)) return false;
  const ids = new Set<string>();
  return value.every((row) => {
    if (!record(row) || !id(row[key]) || ids.has(row[key]) || !valid(row)) return false;
    ids.add(row[key]);
    return true;
  });
}

export function isProductView(value: unknown, productId: string): value is ProductView {
  if (
    !record(value) ||
    value.product_id !== productId ||
    !record(value.store) ||
    !id(value.store.store_id) ||
    typeof value.store.name !== 'string'
  )
    return false;
  if (value.view_status === 'OFF_SALE') return true;
  if (
    value.view_status !== 'ON_SALE' ||
    !isProductCard(value) ||
    typeof value.description !== 'string' ||
    typeof value.published_at !== 'string' ||
    !Number.isFinite(Date.parse(value.published_at)) ||
    !nullableText(value.default_sku_id)
  )
    return false;
  return (
    Array.isArray(value.attributes) &&
    value.attributes.every(
      (attribute) =>
        record(attribute) &&
        typeof attribute.name === 'string' &&
        typeof attribute.value === 'string',
    ) &&
    uniqueRows(
      value.images,
      'image_id',
      (image) => id(image.url) && nonnegativeInteger(image.sort_order),
    ) &&
    uniqueRows(
      value.dimensions,
      'dimension_id',
      (dimension) =>
        typeof dimension.name === 'string' &&
        uniqueRows(dimension.values, 'value_id', (option) => typeof option.value === 'string'),
    ) &&
    uniqueRows(
      value.skus,
      'sku_id',
      (sku) =>
        nonnegativeInteger(sku.price) &&
        sku.currency === 'CNY' &&
        nonnegativeInteger(sku.available_stock) &&
        (sku.status === 'IN_STOCK' || sku.status === 'SOLD_OUT') &&
        nullableText(sku.image_id) &&
        nullableText(sku.image_url) &&
        Array.isArray(sku.spec_values) &&
        sku.spec_values.every(
          (selection) => record(selection) && id(selection.dimension_id) && id(selection.value_id),
        ),
    )
  );
}

export function isRecommendationResult(value: unknown): value is RecommendationResult {
  return (
    record(value) &&
    typeof value.checked_at === 'string' &&
    Number.isFinite(Date.parse(value.checked_at)) &&
    uniqueRows(value.items, 'product_id', isProductCard)
  );
}
