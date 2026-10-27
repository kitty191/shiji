import { merchantAvailable } from './merchant.ts';
import { CommerceError } from '../lib/commerce.ts';
import { MockMerchantProducts, merchantCatalogSummaries } from '../mocks/merchantProduct.ts';
import { categories } from '../mocks/catalog.ts';
import { MockMerchantDrafts } from '../mocks/merchantDraft.ts';
import { MerchantDraftStore } from '../stores/merchantDraft.ts';
import { mockCommerce, mockMerchantStore } from '../mocks/session.ts';
import type { ProductDetail } from '../types/catalog.ts';
import type { MerchantDraftGateway, MerchantProductsGateway } from '../types/merchantProduct.ts';

const draftKey = 'shiji:mock-merchant-products:store_home:v1';
const drafts = new MockMerchantDrafts({ store: () => mockMerchantStore, categories: () => categories,
  load: () => localStorage.getItem(draftKey), save: data => localStorage.setItem(draftKey, data) });
async function draftAccess<T>(run: () => T): Promise<T> {
  if (!merchantAvailable) throw new CommerceError('SERVICE_UNAVAILABLE', '商家商品接口暂不可用，需配合店铺认证接入。');
  await new Promise<void>(resolve => setTimeout(resolve, 180)); return run();
}
export const merchantDraftGateway: MerchantDraftGateway = {
  create: key => draftAccess(() => drafts.create(key)), draft: id => draftAccess(() => drafts.draft(id)), save: (id, request, key) => draftAccess(() => drafts.save(id, request, key)),
};
export const merchantDraftStore = new MerchantDraftStore(merchantDraftGateway);
const mock = new MockMerchantProducts({ store: () => mockMerchantStore,
  products: () => [...merchantCatalogSummaries(mockCommerce.catalog().filter((p): p is ProductDetail => p.view_status === 'ON_SALE')), ...drafts.summaries()] });
export const merchantProductsGateway: MerchantProductsGateway = {
  async products(query) {
    if (!merchantAvailable) throw new CommerceError('SERVICE_UNAVAILABLE', '商家商品接口暂不可用，需配合店铺认证接入。');
    await new Promise<void>(resolve => setTimeout(resolve, 180));
    return mock.products(query);
  },
};
