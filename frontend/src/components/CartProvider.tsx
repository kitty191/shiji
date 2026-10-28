import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { cartGateway } from '../api/cart.ts';
import { CartStore } from '../stores/cart.ts';
import { CartContext } from './CartContext.ts';

export function CartProvider({ children }: { children: ReactNode }) {
  // Bind one store to this provider lifecycle, including development refreshes.
  const [store] = useState(() => new CartStore(cartGateway));
  const [open, setOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);
  const show = useCallback(() => {
    setOpen(true);
    if (!store.getSnapshot().retryPending && !store.getSnapshot().error)
      void store.load().catch(() => undefined);
  }, [store]);
  const close = useCallback(() => setOpen(false), []);
  useEffect(() => {
    void store.load().catch(() => undefined);
  }, [store]);
  return <CartContext value={{ store, open, show, close }}>{children}</CartContext>;
}
