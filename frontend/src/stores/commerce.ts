import type { CommerceGateway, PaymentGroup } from '../types/commerce.ts';
import { CommerceError } from '../lib/commerce.ts';

export type CommerceOperation = { kind: 'submit'; token: string } | { kind: 'cancel' | 'pay'; paymentId: string };
interface State { busy: boolean; pending: CommerceOperation | null; error: string | null; revision: number }
export class CommerceStore {
  private state: State = { busy: false, pending: null, error: null, revision: 0 };
  private attempt: { operation: CommerceOperation; key: string } | null = null;
  private flight: Promise<PaymentGroup> | null = null;
  private listeners = new Set<() => void>();
  private gateway: CommerceGateway; private key: () => string;
  constructor(gateway: CommerceGateway, key = () => crypto.randomUUID()) { this.gateway = gateway; this.key = key; }
  getSnapshot = (): State => this.state;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  private set(patch: Partial<State>) { this.state = { ...this.state, ...patch }; this.listeners.forEach(listener => listener()); }
  clearError = () => { if (!this.attempt) this.set({ error: null }); };
  submit = (token: string) => this.run({ kind: 'submit', token });
  pay = (paymentId: string) => this.run({ kind: 'pay', paymentId });
  cancel = (paymentId: string) => this.run({ kind: 'cancel', paymentId });
  retry = () => this.attempt ? this.run(this.attempt.operation) : Promise.reject(new CommerceError('INVALID_STATE', '当前没有待确认的交易操作。'));
  private run(operation: CommerceOperation): Promise<PaymentGroup> {
    if (this.attempt && JSON.stringify(this.attempt.operation) !== JSON.stringify(operation)) return Promise.reject(new CommerceError('REQUEST_IN_PROGRESS', '请先确认上次交易操作的结果。'));
    if (this.flight) return this.flight;
    this.attempt ??= { operation, key: this.key() }; const attempt = this.attempt;
    this.set({ busy: true, error: null, pending: operation });
    this.flight = (async () => {
      await Promise.resolve();
      try {
        const payment = operation.kind === 'submit' ? await this.gateway.submit(operation.token, attempt.key) : operation.kind === 'pay' ? await this.gateway.pay(operation.paymentId, attempt.key) : await this.gateway.cancel(operation.paymentId, attempt.key);
        this.attempt = null; this.set({ pending: null, error: null, revision: this.state.revision + 1 }); return payment;
      } catch (error) {
        const unknown = !(error instanceof CommerceError) || error.retryable;
        if (!unknown) this.attempt = null;
        this.set({ pending: unknown ? operation : null, error: error instanceof Error ? error.message : '交易结果尚未确认，请确认原操作。' });
        throw error;
      } finally { this.flight = null; this.set({ busy: false }); }
    })();
    return this.flight;
  }
}
