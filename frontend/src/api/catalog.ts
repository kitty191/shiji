import type { CatalogQuery, Category, ProductPage } from '../types/catalog.ts';
import type { Result } from '../types/result.ts';
import { ApiError, get } from './client.ts';
import { queryParams, selectProducts } from '../lib/catalog.ts';
import { categories, products } from '../mocks/catalog.ts';

export const usesMockData = import.meta.env.VITE_DATA_SOURCE !== 'api';
function mockResult<T>(data: T, signal?: AbortSignal): Promise<Result<T>> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }
    const abort = () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve({ code: 'SUCCESS', message: '操作成功', data, request_id: `mock_${crypto.randomUUID()}` }); }, 160);
    signal?.addEventListener('abort', abort, { once: true });
  });
}
export async function getCategories(signal?: AbortSignal): Promise<Category[]> {
  const result = usesMockData ? await mockResult({ items: categories }, signal) : await get<{ items: Category[] }>('/categories', undefined, signal);
  if (result.code !== 'SUCCESS') throw new ApiError(result.code, result.message);
  return result.data.items;
}
export async function getProducts(query: CatalogQuery, signal?: AbortSignal): Promise<ProductPage> {
  const params = queryParams(query); params.set('page_size', String(query.page_size));
  const result = usesMockData ? await mockResult(selectProducts(products, query), signal) : await get<ProductPage>('/products', params, signal);
  if (result.code !== 'SUCCESS') throw new ApiError(result.code, result.message);
  return result.data;
}
