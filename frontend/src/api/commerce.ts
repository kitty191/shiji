import type { CommerceGateway } from '../types/commerce.ts';
import { CommerceError } from '../lib/commerce.ts';
import { mockCommerce } from '../mocks/session.ts';

export const commerceAvailable = import.meta.env.VITE_DATA_SOURCE !== 'api';
async function access<T>(run: () => T): Promise<T> {
  if (!commerceAvailable) throw new CommerceError('SERVICE_UNAVAILABLE', '结算与订单接口暂不可用。');
  await new Promise<void>(resolve => setTimeout(resolve, 180));
  return run();
}
export const commerceGateway: CommerceGateway = {
  preview: request => access(() => mockCommerce.preview(request)), submit: (token, key) => access(() => mockCommerce.submit(token, key)),
  cancel: (id, key) => access(() => mockCommerce.cancel(id, key)), orders: query => access(() => mockCommerce.orders(query)),
  order: id => access(() => mockCommerce.order(id)), payment: id => access(() => mockCommerce.payment(id)),
};
