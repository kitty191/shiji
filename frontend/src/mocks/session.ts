import { MockAddresses } from './address.ts';
import { MockCart } from './cart.ts';
import { MockCommerce } from './commerce.ts';
import { productDetails } from './product.ts';

const cartKey = 'shiji:mock-cart:demo-buyer:v1', addressKey = 'shiji:mock-addresses:demo-buyer:v1';
export const mockAddressBook = new MockAddresses({ load: () => localStorage.getItem(addressKey), save: data => localStorage.setItem(addressKey, data) });
export const mockCommerce = new MockCommerce({ catalog: () => productDetails, addresses: () => mockAddressBook.read(),
  load: () => localStorage.getItem(cartKey), save: data => localStorage.setItem(cartKey, data) });
export const mockCart = new MockCart({ catalog: () => mockCommerce.catalog(),
  load: () => localStorage.getItem(cartKey), save: data => localStorage.setItem(cartKey, data) });
