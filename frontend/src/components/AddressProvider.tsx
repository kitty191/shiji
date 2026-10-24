import { createContext, useContext, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { addressGateway } from '../api/address.ts';
import { AddressStore } from '../stores/address.ts';

const AddressContext = createContext<AddressStore | null>(null);
export function AddressProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() => new AddressStore(addressGateway));
  return <AddressContext value={store}>{children}</AddressContext>;
}
export function useAddresses() {
  const store = useContext(AddressContext);
  if (!store) throw Error('AddressProvider is required');
  return { store, state: useSyncExternalStore(store.subscribe, store.getSnapshot) };
}
