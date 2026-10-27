import type { DraftSaveRequest, MerchantDraft, MerchantDraftGateway } from '../types/merchantProduct.ts';
import { CommerceError } from '../lib/commerce.ts';
export type DraftOperation = { action: 'create'; key: string } | { action: 'save'; key: string; id: string; request: DraftSaveRequest };
export interface DraftState { busy: boolean; pending: DraftOperation | null; confirmedId: string | null; error: string | null; code: string | null; result: MerchantDraft | null; revision: number }
export class MerchantDraftStore {
  private gateway: MerchantDraftGateway; private state: DraftState = { busy: false, pending: null, confirmedId: null, error: null, code: null, result: null, revision: 0 };
  private listeners = new Set<() => void>();
  constructor(gateway: MerchantDraftGateway) { this.gateway = gateway; }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private set(patch: Partial<DraftState>) { this.state = { ...this.state, ...patch }; this.listeners.forEach(fn => fn()); }
  private async run(op: DraftOperation): Promise<MerchantDraft> {
    if (this.state.busy) throw new CommerceError('REQUEST_IN_PROGRESS', '请等待原草稿操作完成。');
    this.set({ busy: true, pending: op, error: null, code: null, result: null });
    try {
      let id = this.state.confirmedId;
      if (!id) { const product = op.action === 'create' ? await this.gateway.create(op.key) : (await this.gateway.save(op.id, op.request, op.key)).product; id = product.product_id; this.set({ confirmedId: id }); }
      const current = await this.gateway.draft(id);
      this.set({ pending: null, confirmedId: null, result: current, revision: this.state.revision + 1 }); return current;
    } catch (error) {
      const code = error instanceof CommerceError ? error.code : 'RESULT_UNKNOWN', uncertain = code === 'RESULT_UNKNOWN' || code === 'REQUEST_IN_PROGRESS' || this.state.confirmedId !== null;
      this.set({ error: error instanceof Error ? error.message : '原操作结果尚未确认，请继续确认。', code, ...(uncertain ? {} : { pending: null, confirmedId: null }) }); throw error;
    } finally { this.set({ busy: false }); }
  }
  clearFeedback() { if (!this.state.busy && !this.state.pending) this.set({ result: null, error: null, code: null }); }
  create(): Promise<MerchantDraft> { if (this.state.pending) return Promise.reject(new CommerceError('REQUEST_IN_PROGRESS', '请先确认原草稿操作。')); return this.run({ action: 'create', key: crypto.randomUUID() }); }
  save(id: string, request: DraftSaveRequest): Promise<MerchantDraft> { if (this.state.pending) return Promise.reject(new CommerceError('REQUEST_IN_PROGRESS', '请先确认原草稿操作。')); return this.run({ action: 'save', id, request: structuredClone(request), key: crypto.randomUUID() }); }
  retry(): Promise<MerchantDraft> { const op = this.state.pending; if (!op) return Promise.reject(new CommerceError('INVALID_STATE', '没有待确认的草稿操作。')); return this.run(op); }
}
