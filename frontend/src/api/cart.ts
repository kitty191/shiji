import type { CartGateway } from '../types/cart.ts';
import { CartError } from '../lib/cart.ts';
import { MockCart } from '../mocks/cart.ts';
import { productDetails } from '../mocks/product.ts';

export const cartAvailable = import.meta.env.VITE_DATA_SOURCE !== 'api';
const storageKey = 'shiji:mock-cart:demo-buyer:v1';
const engine = new MockCart({ catalog: () => productDetails,
  load: () => localStorage.getItem(storageKey), save: data => localStorage.setItem(storageKey, data) });
const delay = () => new Promise<void>(resolve => setTimeout(resolve, 180));
function requireMock(): void {
  if (!cartAvailable) throw new CartError('SERVICE_UNAVAILABLE', '购物车接口暂不可用。');
}
// Private API transport is intentionally pending the authentication decision.
// Never silently use the demo cart alongside real public-product API data.
export const cartGateway: CartGateway = {
  async read() { requireMock(); await delay(); return engine.read(); },
  async add(request, key) { requireMock(); await delay(); return engine.add(request, key); },
};
