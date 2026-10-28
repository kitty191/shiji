import type {
  CatalogQuery,
  Category,
  ProductPage,
  ProductView,
  PublicStore,
  RecommendationResult,
} from '../types/catalog.ts';
import type { Result } from '../types/result.ts';
import { ApiError, get } from './client.ts';
import { queryParams, selectProducts } from '../lib/catalog.ts';
import { categories, products } from '../mocks/catalog.ts';
import { mockProductView } from '../mocks/product.ts';
import { mockCommerce } from '../mocks/session.ts';
import { publicStores } from '../mocks/store.ts';
import { selectStoreProducts, storeProductsParams } from '../lib/store.ts';
import {
  isCategoryResult,
  isPublicStore,
  isStoreProductPage,
  isProductPage,
  isProductView,
  isRecommendationResult,
} from '../lib/catalogValidation.ts';
function mockCards() {
  const current = mockCommerce.catalog();
  return products.map((card) => {
    const product = current.find((p) => p.product_id === card.product_id);
    return product?.view_status === 'ON_SALE'
      ? {
          ...card,
          display_price: product.display_price,
          min_price: product.min_price,
          max_price: product.max_price,
          stock_status: product.stock_status,
        }
      : card;
  });
}

export const usesMockData = import.meta.env.VITE_DATA_SOURCE !== 'api';
function mockResult<T>(data: T, signal?: AbortSignal): Promise<Result<T>> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const abort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve({
        code: 'SUCCESS',
        message: '操作成功',
        data,
        request_id: `mock_${crypto.randomUUID()}`,
      });
    }, 160);
    signal?.addEventListener('abort', abort, { once: true });
  });
}
export async function getCategories(signal?: AbortSignal): Promise<Category[]> {
  const result = usesMockData
    ? await mockResult({ items: categories }, signal)
    : await get<{ items: Category[] }>('/categories', undefined, signal);
  if (result.code !== 'SUCCESS') throw new ApiError(result.code, result.message);
  if (!isCategoryResult(result.data))
    throw new ApiError('SERVICE_UNAVAILABLE', '商品分类暂时不可用，请稍后重试。');
  return result.data.items;
}
export async function getProducts(query: CatalogQuery, signal?: AbortSignal): Promise<ProductPage> {
  const params = queryParams(query);
  params.set('page_size', String(query.page_size));
  const result = usesMockData
    ? await mockResult(selectProducts(mockCards(), query), signal)
    : await get<ProductPage>('/products', params, signal);
  if (result.code !== 'SUCCESS') throw new ApiError(result.code, result.message);
  if (!isProductPage(result.data, query))
    throw new ApiError('SERVICE_UNAVAILABLE', '商品列表暂时不可用，请稍后重试。');
  return result.data;
}

export async function getProductView(
  productId: string,
  signal?: AbortSignal,
): Promise<ProductView> {
  if (!productId || productId === '.' || productId === '..')
    throw new ApiError('NOT_FOUND', '没有找到这件商品。');
  const result = usesMockData
    ? await mockResult(
        mockCommerce.catalog().find((p) => p.product_id === productId) ??
          mockProductView(productId) ??
          null,
        signal,
      )
    : await get<ProductView>(`/products/${encodeURIComponent(productId)}`, undefined, signal);
  if (result.code !== 'SUCCESS') throw new ApiError(result.code, result.message);
  if (!result.data) throw new ApiError('NOT_FOUND', '没有找到这件商品。');
  if (!isProductView(result.data, productId))
    throw new ApiError('SERVICE_UNAVAILABLE', '商品资料暂时不可用，请稍后重试。');
  return result.data;
}

export async function getRecommendations(
  productId: string,
  signal?: AbortSignal,
): Promise<RecommendationResult> {
  // The off-sale mock has two same-store, same-category candidates; no service algorithm is claimed here.
  const sample: RecommendationResult = {
    items:
      usesMockData && productId === 'stand'
        ? mockCards()
            .filter(
              (product) =>
                product.category_id === 'category_digital' && product.stock_status === 'IN_STOCK',
            )
            .toSorted((a, b) => a.display_price - b.display_price)
            .slice(0, 4)
            .map(({ published_order: _order, ...card }) => card)
        : [],
    checked_at: new Date().toISOString(),
  };
  const result = usesMockData
    ? await mockResult(sample, signal)
    : await get<RecommendationResult>(
        `/products/${encodeURIComponent(productId)}/recommendations`,
        new URLSearchParams({ limit: '4' }),
        signal,
      );
  if (result.code !== 'SUCCESS') throw new ApiError(result.code, result.message);
  if (!isRecommendationResult(result.data))
    throw new ApiError('SERVICE_UNAVAILABLE', '推荐商品暂时不可用，请稍后重试。');
  return result.data;
}

export async function getStore(storeId: string, signal?: AbortSignal): Promise<PublicStore> {
  if (!storeId || storeId === '.' || storeId === '..')
    throw new ApiError('NOT_FOUND', '没有找到这家店铺。');
  const result = usesMockData
    ? await mockResult(publicStores.find((store) => store.store_id === storeId) ?? null, signal)
    : await get<PublicStore>(`/stores/${encodeURIComponent(storeId)}`, undefined, signal);
  if (result.code !== 'SUCCESS') throw new ApiError(result.code, result.message);
  const store = result.data;
  if (!store) throw new ApiError('NOT_FOUND', '没有找到这家店铺。');
  if (!isPublicStore(store, storeId)) {
    throw new ApiError('SERVICE_UNAVAILABLE', '店铺资料暂时不可用，请稍后重试。');
  }
  return store;
}

export async function getStoreProducts(
  storeId: string,
  query: CatalogQuery,
  signal?: AbortSignal,
): Promise<ProductPage> {
  const result = usesMockData
    ? await mockResult(selectStoreProducts(mockCards(), storeId, query), signal)
    : await get<ProductPage>('/products', storeProductsParams(storeId, query), signal);
  if (result.code !== 'SUCCESS') throw new ApiError(result.code, result.message);
  if (!isStoreProductPage(result.data, storeId, query)) {
    throw new ApiError('SERVICE_UNAVAILABLE', '本店商品暂时不可用，请稍后重试。');
  }
  return result.data;
}
