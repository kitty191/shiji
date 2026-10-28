import type { CatalogQuery, MockProduct, ProductPage, Sort } from '../types/catalog.ts';

export function formatMoney(cents: number): string {
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(cents / 100);
}
export function priceToCents(input: string): number | undefined {
  const value = input.trim();
  if (!value) return undefined;
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) throw new Error('价格须为非负金额，最多保留两位小数。');
  const [whole, fraction = ''] = value.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents)) throw new Error('价格超出可填写范围。');
  return cents;
}
export function readQuery(params: URLSearchParams): CatalogQuery {
  const sort = params.get('sort');
  const allowed: Sort[] = ['default', 'price_asc', 'price_desc', 'newest'];
  const amount = (name: string) => {
    const value = params.get(name);
    return value && /^\d+$/.test(value) && Number.isSafeInteger(Number(value))
      ? Number(value)
      : undefined;
  };
  const rawPage = Number(params.get('page') || 1);
  return {
    keyword: (params.get('keyword') || '').slice(0, 120),
    category_id: params.get('category_id') || '',
    min_price: amount('min_price'),
    max_price: amount('max_price'),
    sort: allowed.includes(sort as Sort) ? (sort as Sort) : 'default',
    page: Number.isSafeInteger(rawPage) && rawPage > 0 ? rawPage : 1,
    page_size: 12,
    feed_token: params.get('feed_token') || undefined,
  };
}
export function queryParams(query: CatalogQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.keyword) params.set('keyword', query.keyword);
  if (query.category_id) params.set('category_id', query.category_id);
  if (query.min_price !== undefined) params.set('min_price', String(query.min_price));
  if (query.max_price !== undefined) params.set('max_price', String(query.max_price));
  if (query.sort !== 'default') params.set('sort', query.sort);
  if (query.page > 1) params.set('page', String(query.page));
  if (query.feed_token) params.set('feed_token', query.feed_token);
  return params;
}
export function changeQuery(
  query: CatalogQuery,
  patch: Partial<Omit<CatalogQuery, 'feed_token'>>,
): CatalogQuery {
  const next = { ...query, ...patch, page: patch.page ?? 1 };
  const sameFeed = (
    ['keyword', 'category_id', 'min_price', 'max_price', 'sort', 'page_size'] as const
  ).every((field) => next[field] === query[field]);
  if (patch.page === undefined || !sameFeed) next.feed_token = undefined;
  return next;
}
export function selectProducts(products: readonly MockProduct[], query: CatalogQuery): ProductPage {
  const keyword = query.keyword.trim().toLocaleLowerCase();
  let matches = products.filter(
    (p) =>
      (!keyword || `${p.name} ${p.store.name}`.toLocaleLowerCase().includes(keyword)) &&
      (!query.category_id || query.category_id === p.category_id) &&
      (query.min_price === undefined || p.display_price >= query.min_price) &&
      (query.max_price === undefined || p.display_price <= query.max_price),
  );
  if (query.sort === 'price_asc')
    matches = matches.toSorted((a, b) => a.display_price - b.display_price);
  if (query.sort === 'price_desc')
    matches = matches.toSorted((a, b) => b.display_price - a.display_price);
  if (query.sort === 'newest')
    matches = matches.toSorted((a, b) => b.published_order - a.published_order);
  const start = (query.page - 1) * query.page_size;
  return {
    items: matches
      .slice(start, start + query.page_size)
      .map(({ published_order: _order, ...card }) => card),
    page: query.page,
    page_size: query.page_size,
    total: matches.length,
    has_more: start + query.page_size < matches.length,
    feed_token: 'shiji_demo_feed_v1',
  };
}
export function prototypeUrl(page: string, params: Record<string, string> = {}): string {
  const query = new URLSearchParams(params).toString();
  return `${import.meta.env.BASE_URL}prototype/index.html#/${page}${query ? `?${query}` : ''}`;
}
