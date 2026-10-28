import { createContext, useContext, useSyncExternalStore } from 'react';
import type { CartStore } from '../stores/cart.ts';

// Keep context identity outside the refreshable provider component module.
export const CartContext = createContext<{
  store: CartStore;
  open: boolean;
  show: () => void;
  close: () => void;
} | null>(null);
export function useCart() {
  const context = useContext(CartContext);
  if (!context) throw new Error('CartProvider is required.');
  return {
    ...context,
    state: useSyncExternalStore(
      context.store.subscribe,
      context.store.getSnapshot,
      context.store.getSnapshot,
    ),
  };
}
