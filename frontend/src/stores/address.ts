import type { Address, AddressCreateRequest, AddressGateway } from '../types/address.ts';
import { AddressError, normalizeAddress } from '../lib/address.ts';

interface Attempt { request: AddressCreateRequest; signature: string; key: string; result?: Address }
interface AddressState {
  items: Address[]; status: 'idle' | 'loading' | 'ready' | 'error'; saving: boolean;
  error: string | null; notice: string | null; pending: AddressCreateRequest | null;
}
const message = (error: unknown) => error instanceof Error ? error.message : '操作结果暂未确认，请重试。';

export class AddressStore {
  private gateway: AddressGateway;
  private key: () => string;
  private listeners = new Set<() => void>();
  private state: AddressState = { items: [], status: 'idle', saving: false, error: null, notice: null, pending: null };
  private loading: Promise<void> | null = null;
  private flight: Promise<void> | null = null;
  private attempt: Attempt | null = null;
  constructor(gateway: AddressGateway, key = () => crypto.randomUUID()) { this.gateway = gateway; this.key = key; }
  getSnapshot = (): AddressState => this.state;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  private set(patch: Partial<AddressState>): void { this.state = { ...this.state, ...patch }; this.listeners.forEach(listener => listener()); }
  load = (): Promise<void> => {
    if (this.flight) return this.flight;
    if (this.attempt) return Promise.reject(new AddressError('REQUEST_IN_PROGRESS', '请先确认上一次新增地址的结果。'));
    if (this.loading) return this.loading;
    this.set({ status: 'loading', error: null });
    this.loading = this.gateway.read().then(items => this.set({ items, status: 'ready' }))
      .catch(error => { this.set({ status: 'error', error: message(error) }); throw error; }).finally(() => { this.loading = null; });
    return this.loading;
  };
  create = (request: AddressCreateRequest): Promise<void> => {
    let normalized: AddressCreateRequest;
    try { normalized = normalizeAddress(request); } catch (error) { return Promise.reject(error); }
    const signature = JSON.stringify(normalized);
    if (this.attempt && this.attempt.signature !== signature) return Promise.reject(new AddressError('REQUEST_IN_PROGRESS', '请先确认上一次新增地址的结果。'));
    if (this.flight) return this.flight;
    if (!this.attempt) {
      if (this.state.status !== 'ready') return Promise.reject(new AddressError('REQUEST_IN_PROGRESS', '请先加载收货地址。'));
      this.attempt = { request: normalized, signature, key: this.key() };
    }
    const attempt = this.attempt;
    this.set({ saving: true, error: null, notice: null, pending: attempt.request });
    this.flight = (async () => {
      await Promise.resolve();
      try {
        if (!attempt.result) attempt.result = await this.gateway.create(attempt.request, attempt.key);
        const items = await this.gateway.read();
        this.attempt = null;
        this.set({ items, status: 'ready', error: null, pending: null, notice: '收货地址已保存。' });
      } catch (error) {
        const pending = !!attempt.result || !(error instanceof AddressError) || error.retryable;
        if (!pending) this.attempt = null;
        this.set({ pending: pending ? attempt.request : null, error: attempt.result ? '地址已保存，列表暂未更新，请重试读取。' : message(error) });
        throw error;
      } finally { this.flight = null; this.set({ saving: false }); }
    })();
    return this.flight;
  };
  retry = (): Promise<void> => this.attempt ? this.create(this.attempt.request) : this.load();
}
