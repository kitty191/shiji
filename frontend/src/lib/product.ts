import type { CatalogQuery, ProductDetail, ProductImage, PublicSku } from '../types/catalog.ts';
import { queryParams, readQuery } from './catalog.ts';

export function completeSku(product: ProductDetail, sku: PublicSku): boolean {
  return sku.spec_values.length === product.dimensions.length &&
    new Set(sku.spec_values.map(value => value.dimension_id)).size === product.dimensions.length &&
    product.dimensions.every(dimension => sku.spec_values.some(selection => selection.dimension_id === dimension.dimension_id &&
      dimension.values.some(value => value.value_id === selection.value_id)));
}

export function inStock(sku: PublicSku): boolean {
  return sku.status === 'IN_STOCK' && sku.available_stock > 0;
}

// An explicit retired/invalid selection must not silently become a different SKU.
export function selectedSku(product: ProductDetail, requested: string | null): PublicSku | undefined {
  if (requested !== null) return product.skus.find(sku => sku.sku_id === requested && completeSku(product, sku));
  return product.skus.find(sku => completeSku(product, sku) && inStock(sku));
}

export function skuLabel(product: ProductDetail, sku: PublicSku): string {
  return product.dimensions.map(dimension => {
    const selected = sku.spec_values.find(value => value.dimension_id === dimension.dimension_id);
    return dimension.values.find(value => value.value_id === selected?.value_id)?.value || '未知规格';
  }).join(' · ') || '默认规格';
}

export function quantityLimit(sku?: PublicSku): number {
  return sku && inStock(sku) ? Math.min(99, sku.available_stock) : 0;
}

export function productQuantity(raw: string | null, sku?: PublicSku): number {
  const number = Number(raw);
  return Number.isSafeInteger(number) && number > 0 ? Math.min(number, Math.max(1, quantityLimit(sku))) : 1;
}

// Persist the resolved selection and visible quantity, so a later response cannot
// silently select another SKU or resurrect a quantity already reduced by stock.
export function normalizeProductParams(product: ProductDetail, params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(params);
  const sku = selectedSku(product, params.get('sku_id'));
  if (sku && !params.has('sku_id')) next.set('sku_id', sku.sku_id);
  next.set('quantity', String(productQuantity(params.get('quantity'), sku)));
  return next;
}

export interface GalleryFrame extends ProductImage { label: string; cropped: boolean }
export function galleryFrames(product: ProductDetail): GalleryFrame[] {
  const images = product.images.toSorted((a, b) => a.sort_order - b.sort_order);
  if (!images.length && product.cover_image) images.push({ image_id: 'cover', url: product.cover_image, sort_order: 0 });
  const frames = images.map((image, index) => ({ ...image, label: index === 0 ? '商品主图' : `商品图 ${index + 1}`, cropped: false }));
  // The existing prototype uses an explicitly labelled crop when only one asset exists.
  if (frames.length === 1) frames.push({ ...frames[0], image_id: `${frames[0].image_id}:crop`, label: '局部放大', cropped: true });
  return frames;
}

export function skuFrame(product: ProductDetail, sku?: PublicSku): string | undefined {
  return product.images.find(image => image.image_id === sku?.image_id && image.url)?.image_id;
}

export function buyerReturnPath(value: string | null): string {
  return value === '/buyer' || (value?.startsWith('/buyer?') && !value.includes('#')) ? value : '/buyer';
}

export function storePath(storeId: string, returnTo: string | null = '/buyer', query?: CatalogQuery): string {
  const base = `/stores/${encodeURIComponent(storeId)}`, buyer = buyerReturnPath(returnTo);
  const params = query ? queryParams(query) : new URLSearchParams();
  if (buyer !== '/buyer') params.set('return_to', buyer);
  return params.size ? `${base}?${params}` : base;
}

function normalizedStorePath(value: string | null): string | undefined {
  if (!value || value.includes('#')) return;
  const match = /^\/stores\/([^/?#]+)(?:\?(.*))?$/.exec(value);
  if (!match) return;
  try {
    const id = decodeURIComponent(match[1]);
    if (!id || id === '.' || id === '..') return;
    const params = new URLSearchParams(match[2]);
    return storePath(id, params.get('return_to'), readQuery(params));
  }
  catch { return; }
}

export function cartPath(value: string | null): string {
  const buyer = buyerReturnPath(value);
  return buyer === '/buyer' ? '/cart' : `/cart?${new URLSearchParams({ return_to: buyer })}`;
}

// Cart and store returns carry only a buyer context, preventing recursive return links.
// Canonicalizing here also rejects arbitrary destinations.
export function productReturnPath(value: string | null): string {
  if (value === '/cart') return value;
  if (value?.startsWith('/cart?') && !value.includes('#')) return cartPath(new URLSearchParams(value.slice(6)).get('return_to'));
  return normalizedStorePath(value) ?? buyerReturnPath(value);
}

export function buyerContextPath(value: string | null): string {
  const path = productReturnPath(value);
  return path === '/cart' || path.startsWith('/cart?') || path.startsWith('/stores/')
    ? buyerReturnPath(new URLSearchParams(path.split('?')[1]).get('return_to')) : path;
}

// Re-entering the same store from a product keeps its existing browse query.
export function storeEntryPath(storeId: string, returnTo: string | null): string {
  const context = productReturnPath(returnTo);
  return context.split('?')[0] === `/stores/${encodeURIComponent(storeId)}` ? context : storePath(storeId, buyerContextPath(context));
}
