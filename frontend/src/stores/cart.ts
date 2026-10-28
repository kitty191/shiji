import type {
  CartAddRequest,
  CartDeletion,
  CartGateway,
  CartItem,
  CartQuantityRequest,
  CartRestoration,
  CartView,
} from '../types/cart.ts';
import { CartError, emptyCart, selectableCartItem } from '../lib/cart.ts';
import type { CartChoices } from '../lib/cart.ts';

export interface QuantityEdit {
  target: number;
  pending: boolean;
  retryPending: boolean;
  error: string | null;
}
interface UndoInfo {
  deletion: CartDeletion;
  choices: Record<string, boolean>;
}
interface CartState {
  view: CartView;
  status: 'idle' | 'loading' | 'ready' | 'error';
  adding: boolean;
  mutating: boolean;
  error: string | null;
  notice: string | null;
  retryPending: boolean;
  actionError: boolean;
  choices: CartChoices;
  quantityEdits: Record<string, QuantityEdit>;
  undo: UndoInfo | null;
}
type Action =
  | { kind: 'add'; request: CartAddRequest }
  | { kind: 'remove'; ids: readonly string[] }
  | { kind: 'restore'; undo: UndoInfo };
interface Attempt {
  action: Action;
  signature: string;
  key: string;
  result?: CartItem | CartDeletion | CartRestoration;
  choices?: Record<string, boolean>;
}
interface QuantityJob {
  confirmed: number;
  target: number;
  pending: boolean;
  recovering: boolean;
  needsRead: boolean;
  error: string | null;
  request?: { body: CartQuantityRequest; key: string; result?: CartItem };
  flight?: Promise<void>;
}
const message = (error: unknown) =>
  error instanceof Error ? error.message : '操作结果暂未确认，请重试。';
const uncertain = (error: unknown) => !(error instanceof CartError) || error.retryable;
function recount(view: CartView): CartView {
  const groups = view.groups.filter((group) => group.items.length);
  return {
    ...view,
    groups,
    item_count: groups.reduce((sum, group) => sum + group.items.length, 0),
    quantity_total: groups.reduce(
      (sum, group) => sum + group.items.reduce((count, item) => count + item.quantity, 0),
      0,
    ),
  };
}
export function hasQuantityWork(state: Pick<CartState, 'quantityEdits'>): boolean {
  return Object.values(state.quantityEdits).some((edit) => edit.pending || edit.retryPending);
}

export class CartStore {
  private gateway: CartGateway;
  private key: () => string;
  private state: CartState = {
    view: emptyCart(),
    status: 'idle',
    adding: false,
    mutating: false,
    error: null,
    notice: null,
    retryPending: false,
    actionError: false,
    choices: {},
    quantityEdits: {},
    undo: null,
  };
  private listeners = new Set<() => void>();
  private loading: Promise<void> | null = null;
  private mutation: Promise<void> | null = null;
  private attempt: Attempt | null = null;
  private jobs = new Map<string, QuantityJob>();
  constructor(gateway: CartGateway, key = () => crypto.randomUUID()) {
    this.gateway = gateway;
    this.key = key;
  }
  getSnapshot = (): CartState => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private set(patch: Partial<CartState>): void {
    if (patch.view) {
      const ids = new Set(
        patch.view.groups.flatMap((group) => group.items.map((item) => item.item_id)),
      );
      patch.choices = Object.fromEntries(
        Object.entries(patch.choices ?? this.state.choices).filter(([id]) => ids.has(id)),
      );
    }
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  select = (ids: readonly string[], checked: boolean): void => {
    const eligible = new Set(
      this.state.view.groups.flatMap((group) =>
        group.items.filter(selectableCartItem).map((item) => item.item_id),
      ),
    );
    const choices = { ...this.state.choices };
    ids.forEach((id) => {
      if (eligible.has(id)) choices[id] = checked;
    });
    this.set({ choices });
  };
  private item(id: string): CartItem | undefined {
    return this.state.view.groups
      .flatMap((group) => group.items)
      .find((item) => item.item_id === id);
  }
  private patchItem(id: string, item?: CartItem): void {
    this.set({
      view: recount({
        ...this.state.view,
        groups: this.state.view.groups.map((group) => ({
          ...group,
          items: group.items.flatMap((row) => (row.item_id !== id ? [row] : item ? [item] : [])),
        })),
      }),
    });
    if (!item) this.set({ notice: '商品项已在其他页面移除，已更新购物车。' });
  }
  private async readItem(id: string): Promise<CartItem | undefined> {
    return (await this.gateway.read()).groups
      .flatMap((group) => group.items)
      .find((item) => item.item_id === id);
  }
  private publishJob(id: string, job: QuantityJob): void {
    const edits = { ...this.state.quantityEdits };
    if (!this.item(id) || (!job.pending && !job.recovering && !job.needsRead && !job.error)) {
      delete edits[id];
      this.jobs.delete(id);
    } else
      edits[id] = {
        target: job.target,
        pending: job.pending,
        retryPending: job.recovering || job.needsRead,
        error: job.error,
      };
    this.set({ quantityEdits: edits });
  }
  private async flushQuantities(): Promise<void> {
    await Promise.allSettled(
      [...this.jobs.values()].flatMap((job) => (job.flight ? [job.flight] : [])),
    );
    if ([...this.jobs.values()].some((job) => job.pending || job.recovering || job.needsRead))
      throw new CartError('REQUEST_IN_PROGRESS', '请先确认未完成的数量修改，再进行此操作。');
  }
  load = (): Promise<void> => {
    if (this.mutation) return this.mutation;
    if (this.loading) return this.loading;
    if (hasQuantityWork(this.state)) return this.flushQuantities().then(() => this.load());
    this.set({ status: 'loading', error: null, actionError: false });
    this.loading = this.gateway
      .read()
      .then((view) => {
        this.jobs.clear();
        this.set({ view, status: 'ready', error: null, quantityEdits: {} });
      })
      .catch((error) => {
        this.set({ status: 'error', error: message(error) });
        throw error;
      })
      .finally(() => {
        this.loading = null;
      });
    return this.loading;
  };
  changeQuantity = (id: string, quantity: number): Promise<void> => {
    const item = this.item(id);
    if (this.state.mutating || this.state.retryPending || this.state.status !== 'ready')
      return Promise.reject(new CartError('REQUEST_IN_PROGRESS', '请等待当前操作完成。'));
    if (!item || !['AVAILABLE', 'INSUFFICIENT_STOCK'].includes(item.purchase_status))
      return Promise.reject(new CartError('ITEM_NOT_PURCHASABLE', '所选商品不能修改数量。'));
    if (!Number.isSafeInteger(quantity) || quantity < 1)
      return Promise.reject(new CartError('INVALID_ARGUMENT', '数量必须为正整数。'));
    if (quantity > item.available_stock!)
      return Promise.reject(new CartError('INSUFFICIENT_STOCK', '目标数量超过当前库存。'));
    let job = this.jobs.get(id);
    if (job?.recovering || job?.needsRead)
      return Promise.reject(new CartError('REQUEST_IN_PROGRESS', '请先确认上一次数量修改。'));
    if (!job) {
      job = {
        confirmed: item.quantity,
        target: item.quantity,
        pending: false,
        recovering: false,
        needsRead: false,
        error: null,
      };
      this.jobs.set(id, job);
    }
    job.target = quantity;
    job.error = null;
    return this.runQuantity(id, job);
  };
  retryQuantity = (id: string): Promise<void> => {
    const job = this.jobs.get(id);
    if (this.state.mutating || this.state.retryPending)
      return Promise.reject(new CartError('REQUEST_IN_PROGRESS', '请等待当前操作完成。'));
    return job ? this.runQuantity(id, job) : this.load();
  };
  private runQuantity(id: string, job: QuantityJob): Promise<void> {
    if (job.flight) {
      this.publishJob(id, job);
      return job.flight;
    }
    job.pending = true;
    job.error = null;
    this.publishJob(id, job);
    job.flight = (async () => {
      await Promise.resolve();
      try {
        while (job.request || job.target !== job.confirmed || job.needsRead) {
          if (job.needsRead && !job.request) {
            try {
              const fresh = await this.readItem(id);
              this.patchItem(id, fresh);
              if (fresh) job.confirmed = job.target = fresh.quantity;
              job.needsRead = false;
              job.error = null;
              break;
            } catch (error) {
              job.error = message(error);
              throw error;
            }
          }
          if (!job.request)
            job.request = {
              body: { quantity: job.target, expected_quantity: job.confirmed },
              key: this.key(),
            };
          const request = job.request;
          try {
            if (!request.result)
              request.result = await this.gateway.update(id, request.body, request.key);
            let fresh: CartItem | undefined = request.result;
            if (job.recovering) fresh = await this.readItem(id);
            this.patchItem(id, fresh);
            const conflict =
              !fresh ||
              fresh.quantity !== request.result.quantity ||
              !['AVAILABLE', 'INSUFFICIENT_STOCK'].includes(fresh.purchase_status) ||
              job.target > (fresh.available_stock ?? 0);
            if (fresh) job.confirmed = fresh.quantity;
            if (conflict) {
              job.target = job.confirmed;
              job.error = fresh
                ? fresh.quantity !== request.result.quantity
                  ? '数量已在其他页面变化，请确认后再修改。'
                  : '库存或可售状态已变化，请确认后再修改。'
                : null;
            }
            job.request = undefined;
            job.recovering = false;
            this.publishJob(id, job);
            if (conflict) break;
          } catch (error) {
            if (request.result || uncertain(error)) {
              job.recovering = true;
              job.error = request.result
                ? '数量已保存，最新结果暂未读取，请重试。'
                : message(error);
            } else {
              job.request = undefined;
              job.target = job.confirmed;
              job.error = message(error);
              try {
                const fresh = await this.readItem(id);
                this.patchItem(id, fresh);
                if (fresh) job.confirmed = job.target = fresh.quantity;
              } catch {
                job.needsRead = true;
                job.error += ' 最新数量暂未读取，请重试。';
              }
            }
            throw error;
          }
        }
      } finally {
        job.pending = false;
        job.flight = undefined;
        this.publishJob(id, job);
      }
    })();
    return job.flight;
  }
  add = (request: CartAddRequest): Promise<void> =>
    this.begin({ kind: 'add', request: { ...request } });
  remove = (ids: readonly string[]): Promise<void> => this.begin({ kind: 'remove', ids: [...ids] });
  restore = (): Promise<void> => {
    if (!this.state.undo)
      return Promise.reject(new CartError('RESTORE_EXPIRED', '当前没有可撤销的删除。'));
    // A confirmed deletion can be undone even if its subsequent list refresh failed.
    if (!this.mutation && this.attempt?.action.kind === 'remove' && this.attempt.result)
      this.attempt = null;
    return this.begin({ kind: 'restore', undo: this.state.undo });
  };
  canRestore = (): boolean =>
    !!this.state.undo &&
    (!this.attempt ||
      this.attempt.action.kind === 'restore' ||
      (this.attempt.action.kind === 'remove' && !!this.attempt.result));
  dismissFeedback = (): void => {
    if (!this.state.retryPending && !this.state.mutating)
      this.set({ error: null, actionError: false });
  };
  dismissUndo = (): void => this.set({ undo: null });
  private begin(action: Action): Promise<void> {
    const signature = JSON.stringify(
      action.kind === 'add'
        ? ['add', action.request.sku_id, action.request.quantity]
        : action.kind === 'remove'
          ? ['remove', [...action.ids].sort()]
          : ['restore', action.undo.deletion.restore_token],
    );
    if (this.attempt && this.attempt.signature !== signature)
      return Promise.reject(new CartError('REQUEST_IN_PROGRESS', '请先确认上一次操作结果。'));
    if (this.mutation) return this.mutation;
    if (!this.attempt) this.attempt = { action, signature, key: this.key() };
    const attempt = this.attempt,
      reading = this.loading;
    this.set({
      adding: action.kind === 'add',
      mutating: true,
      error: null,
      notice: null,
      retryPending: false,
      actionError: false,
    });
    this.mutation = (async () => {
      await reading?.catch(() => undefined);
      try {
        await this.flushQuantities();
        if (!attempt.result) {
          if (action.kind === 'add')
            attempt.result = await this.gateway.add(action.request, attempt.key);
          else if (action.kind === 'remove') {
            attempt.choices = Object.fromEntries(
              this.state.view.groups
                .flatMap((group) => group.items)
                .filter((item) => action.ids.includes(item.item_id))
                .map((item) => [item.sku_id, this.state.choices[item.item_id] !== false]),
            );
            const result = await this.gateway.remove(action.ids, attempt.key);
            attempt.result = result;
            const view = recount({
              ...this.state.view,
              groups: this.state.view.groups.map((group) => ({
                ...group,
                items: group.items.filter(
                  (item) => !result.deleted_item_ids.includes(item.item_id),
                ),
              })),
            });
            this.set({ view, undo: { deletion: result, choices: attempt.choices } });
          } else
            attempt.result = await this.gateway.restore(
              action.undo.deletion.restore_token,
              attempt.key,
            );
        }
        const view = await this.gateway.read(),
          choices = { ...this.state.choices };
        if (action.kind === 'add')
          view.groups
            .flatMap((group) => group.items)
            .filter((item) => item.sku_id === action.request.sku_id)
            .forEach((item) => {
              choices[item.item_id] = true;
            });
        if (action.kind === 'restore')
          view.groups
            .flatMap((group) => group.items)
            .forEach((item) => {
              if (item.sku_id in action.undo.choices)
                choices[item.item_id] = action.undo.choices[item.sku_id];
            });
        this.attempt = null;
        this.jobs.clear();
        this.set({
          view,
          status: 'ready',
          choices,
          quantityEdits: {},
          error: null,
          retryPending: false,
          ...(action.kind === 'restore' ? { undo: null } : {}),
          notice:
            action.kind === 'add'
              ? '已加入购物车'
              : action.kind === 'remove'
                ? '已删除商品，8 秒内可撤销最近一次删除。'
                : '已恢复原商品；库存与可售状态以当前提示为准。',
        });
      } catch (error) {
        const pending = !!attempt.result || uncertain(error);
        if (!pending) {
          this.attempt = null;
          if (
            action.kind === 'restore' &&
            error instanceof CartError &&
            error.code === 'RESTORE_EXPIRED'
          )
            this.set({ undo: null });
          if (!hasQuantityWork(this.state)) {
            try {
              const view = await this.gateway.read();
              this.jobs.clear();
              this.set({ view, status: 'ready', quantityEdits: {} });
            } catch {
              this.set({ status: 'error' });
            }
          }
        }
        this.set({
          error: attempt.result ? '操作已确认，购物车列表暂未更新，请重试读取。' : message(error),
          notice: null,
          retryPending: pending,
          actionError: true,
        });
        throw error;
      } finally {
        this.mutation = null;
        this.set({ adding: false, mutating: false });
      }
    })();
    return this.mutation;
  }
  retry = (): Promise<void> => (this.attempt ? this.begin(this.attempt.action) : this.load());
}
