import { MockAddresses } from './address.ts';
import { MockCart } from './cart.ts';
import { MockCommerce } from './commerce.ts';
import { productDetails } from './product.ts';

export const mockMerchantStore = Object.freeze({ store_id: 'store_home', name: '好物生活馆' });
const cartKey = 'shiji:mock-cart:demo-buyer:v1',
  addressKey = 'shiji:mock-addresses:demo-buyer:v1';
export const mockAddressBook = new MockAddresses({
  load: () => localStorage.getItem(addressKey),
  save: (data) => localStorage.setItem(addressKey, data),
});
export const mockCommerce = new MockCommerce({
  merchantStore: () => mockMerchantStore,
  catalog: () => productDetails,
  addresses: () => mockAddressBook.read(),
  load: () => localStorage.getItem(cartKey),
  save: (data) => localStorage.setItem(cartKey, data),
});
export const mockCart = new MockCart({
  catalog: () => mockCommerce.catalog(),
  load: () => localStorage.getItem(cartKey),
  save: (data) => localStorage.setItem(cartKey, data),
});
