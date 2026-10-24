import type { CartAddRequest, CartGateway, CartView } from '../types/cart.ts';
import { CartError, emptyCart } from '../lib/cart.ts';

interface CartState {
  view: CartView; status: 'idle' | 'loading' | 'ready' | 'error'; adding: boolean;
  error: string | null; notice: string | null; retryPending: boolean;
}
interface Attempt { request: CartAddRequest; key: string; confirmed: boolean }

export class CartStore {
  private gateway: CartGateway;
  private key: () => string;
  private state: CartState = { view: emptyCart(), status: 'idle', adding: false, error: null, notice: null, retryPending: false };
  private listeners = new Set<() => void>();
  private loading: Promise<void> | null = null;
  private adding: Promise<void> | null = null;
  private attempt: Attempt | null = null;
  constructor(gateway: CartGateway, key = () => crypto.randomUUID()) { this.gateway = gateway; this.key = key; }
  getSnapshot = (): CartState => this.state;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  private set(patch: Partial<CartState>): void { this.state = { ...this.state, ...patch }; this.listeners.forEach(listener => listener()); }
  load = (): Promise<void> => {
    if (this.adding) return this.adding;
    if (this.loading) return this.loading;
    this.set({ status: 'loading', error: null });
    this.loading = this.gateway.read().then(view => { this.set({ view, status: 'ready', error: null }); })
      .catch(error => { this.set({ status: 'error', error: error instanceof Error ? error.message : '购物车暂时无法加载。' }); throw error; })
      .finally(() => { this.loading = null; });
    return this.loading;
  };
  add = (request: CartAddRequest): Promise<void> => {
    if (this.attempt && (this.attempt.request.sku_id !== request.sku_id || this.attempt.request.quantity !== request.quantity)) return Promise.reject(new CartError('REQUEST_IN_PROGRESS', '请先确认上一次加购结果。'));
    if (this.adding) return this.adding;
    if (!this.attempt) this.attempt = { request: { ...request }, key: this.key(), confirmed: false };
    const attempt = this.attempt;
    const reading = this.loading;
    this.set({ adding: true, error: null, notice: null, retryPending: false });
    this.adding = (async () => {
      await reading?.catch(() => undefined);
      try {
        if (!attempt.confirmed) { await this.gateway.add(attempt.request, attempt.key); attempt.confirmed = true; }
        const view = await this.gateway.read();
        this.attempt = null;
        this.set({ view, status: 'ready', notice: '已加入购物车', error: null, retryPending: false });
      } catch (error) {
        const uncertain = attempt.confirmed || !(error instanceof CartError) || error.retryable;
        if (!uncertain) this.attempt = null;
        this.set({ error: attempt.confirmed ? '加购已确认，购物车列表暂未更新，请重试读取。' : error instanceof Error ? error.message : '暂未确认加购结果，请重试。',
          retryPending: uncertain, notice: null });
        throw error;
      } finally { this.adding = null; this.set({ adding: false }); }
    })();
    return this.adding;
  };
  retry = (): Promise<void> => this.attempt ? this.add(this.attempt.request) : this.load();
}
