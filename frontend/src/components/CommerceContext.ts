import { createContext, useContext, useSyncExternalStore } from 'react';
import type { CommerceStore } from '../stores/commerce.ts';

// Keep the context identity stable when the provider refreshes in development.
export const CommerceContext = createContext<CommerceStore | null>(null);
export function useCommerce() {
  const store = useContext(CommerceContext);
  if (!store) throw Error('CommerceProvider is required');
  return { store, state: useSyncExternalStore(store.subscribe, store.getSnapshot) };
}
