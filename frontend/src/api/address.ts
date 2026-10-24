import type { AddressGateway } from '../types/address.ts';
import { AddressError } from '../lib/address.ts';
import { MockAddresses } from '../mocks/address.ts';

export const addressesAvailable = import.meta.env.VITE_DATA_SOURCE !== 'api';
const storageKey = 'shiji:mock-addresses:demo-buyer:v1';
const engine = new MockAddresses({ load: () => localStorage.getItem(storageKey), save: value => localStorage.setItem(storageKey, value) });
const delay = () => new Promise<void>(resolve => setTimeout(resolve, 180));
function requireMock(): void {
  if (!addressesAvailable) throw new AddressError('SERVICE_UNAVAILABLE', '收货地址接口暂不可用。');
}
export const addressGateway: AddressGateway = {
  async read() { requireMock(); await delay(); return engine.read(); },
  async create(request, key) { requireMock(); await delay(); return engine.create(request, key); },
  async update(addressId, request, operationKey) { requireMock(); await delay(); return engine.update(addressId, request, operationKey); },
  async setDefault(addressId, key) { requireMock(); await delay(); return engine.setDefault(addressId, key); },
};
