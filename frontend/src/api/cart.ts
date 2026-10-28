import type { CartGateway } from '../types/cart.ts';
import { CartError } from '../lib/cart.ts';
import { mockCart as engine } from '../mocks/session.ts';

export const cartAvailable = import.meta.env.VITE_DATA_SOURCE !== 'api';
const delay = () => new Promise<void>((resolve) => setTimeout(resolve, 180));
function requireMock(): void {
  if (!cartAvailable) throw new CartError('SERVICE_UNAVAILABLE', '购物车接口暂不可用。');
}
// Private API transport is intentionally pending the authentication decision.
// Never silently use the demo cart alongside real public-product API data.
export const cartGateway: CartGateway = {
  async read() {
    requireMock();
    await delay();
    return engine.read();
  },
  async add(request, key) {
    requireMock();
    await delay();
    return engine.add(request, key);
  },
  async update(itemId, request, key) {
    requireMock();
    await delay();
    return engine.update(itemId, request, key);
  },
  async remove(itemIds, key) {
    requireMock();
    await delay();
    return engine.remove(itemIds, key);
  },
  async restore(token, key) {
    requireMock();
    await delay();
    return engine.restore(token, key);
  },
};
