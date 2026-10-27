import { merchantAvailable } from './merchant.ts';
import { CommerceError } from '../lib/commerce.ts';
import { MockMerchantProducts, merchantCatalogSummaries } from '../mocks/merchantProduct.ts';
import { mockCommerce, mockMerchantStore } from '../mocks/session.ts';
import type { ProductDetail } from '../types/catalog.ts';
import type { MerchantProductsGateway } from '../types/merchantProduct.ts';

const mock = new MockMerchantProducts({ store: () => mockMerchantStore,
  products: () => merchantCatalogSummaries(mockCommerce.catalog().filter((p): p is ProductDetail => p.view_status === 'ON_SALE')) });
export const merchantProductsGateway: MerchantProductsGateway = {
  async products(query) {
    if (!merchantAvailable) throw new CommerceError('SERVICE_UNAVAILABLE', '商家商品接口暂不可用，需配合店铺认证接入。');
    await new Promise<void>(resolve => setTimeout(resolve, 180));
    return mock.products(query);
  },
};
