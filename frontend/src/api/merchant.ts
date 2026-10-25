import type { MerchantGateway } from '../types/merchant.ts';
import { CommerceError } from '../lib/commerce.ts';
import { mockCommerce, mockMerchantStore } from '../mocks/session.ts';

export const merchantAvailable = import.meta.env.VITE_DATA_SOURCE !== 'api';
export const merchantStoreName = mockMerchantStore.name;
async function access<T>(run: () => T): Promise<T> {
  if (!merchantAvailable) throw new CommerceError('SERVICE_UNAVAILABLE', '商家订单接口暂不可用。');
  await new Promise<void>(resolve => setTimeout(resolve, 180));
  return run();
}
export const merchantGateway: MerchantGateway = {
  orders: query => access(() => mockCommerce.merchantOrders(query)),
  order: id => access(() => mockCommerce.merchantOrder(id)),
};
