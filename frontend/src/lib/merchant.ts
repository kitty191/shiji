import type { MerchantOrderQuery } from '../types/merchant.ts';
import { readOrderQuery } from './commerce.ts';

export function readMerchantOrderQuery(params: URLSearchParams): MerchantOrderQuery {
  return { ...readOrderQuery(params), keyword: (params.get('keyword') || '').slice(0, 120) };
}
export function merchantOrderParams(query: MerchantOrderQuery): URLSearchParams {
  const p = new URLSearchParams();
  if (query.status) p.set('status', query.status);
  if (query.order_no) p.set('order_no', query.order_no);
  if (query.keyword) p.set('keyword', query.keyword);
  if (query.page > 1) p.set('page', String(query.page));
  return p;
}
export function merchantOrdersReturnPath(value: string | null): string {
  if (value === '/merchant/orders') return value;
  if (value?.startsWith('/merchant/orders?') && !value.includes('#')) {
    const p = merchantOrderParams(readMerchantOrderQuery(new URLSearchParams(value.slice('/merchant/orders?'.length))));
    return `/merchant/orders${p.size ? `?${p}` : ''}`;
  }
  return '/merchant/orders';
}
export function merchantOrderPath(id: string, returnTo: string): string {
  return `/merchant/orders/${encodeURIComponent(id)}?${new URLSearchParams({ return_to: merchantOrdersReturnPath(returnTo) })}`;
}
