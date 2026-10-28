import type { MerchantOrderQuery, ShipRequest } from '../types/merchant.ts';
import { CommerceError, readOrderQuery } from './commerce.ts';

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
    const p = merchantOrderParams(
      readMerchantOrderQuery(new URLSearchParams(value.slice('/merchant/orders?'.length))),
    );
    return `/merchant/orders${p.size ? `?${p}` : ''}`;
  }
  return '/merchant/orders';
}
export function merchantOrderPath(id: string, returnTo: string): string {
  return `/merchant/orders/${encodeURIComponent(id)}?${new URLSearchParams({ return_to: merchantOrdersReturnPath(returnTo) })}`;
}

export function normalizeShipping(input: ShipRequest): ShipRequest {
  const shipping_carrier =
    typeof input?.shipping_carrier === 'string' ? input.shipping_carrier.trim() : '';
  const tracking_no = typeof input?.tracking_no === 'string' ? input.tracking_no.trim() : '';
  if (
    !shipping_carrier ||
    !tracking_no ||
    /[\u0000-\u001f\u007f]/.test(shipping_carrier + tracking_no)
  )
    throw new CommerceError('INVALID_ARGUMENT', '请填写有效的物流公司和运单号。');
  return { shipping_carrier, tracking_no };
}
