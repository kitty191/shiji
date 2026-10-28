import type {
  Address,
  AddressCreateRequest,
  AddressDeleteResult,
  AddressEditRequest,
  AddressGateway,
  AddressOperation,
} from '../types/address.ts';
import { AddressError, addressEditRequest, normalizeAddress } from '../lib/address.ts';

interface Attempt {
  operation: AddressOperation;
  signature: string;
  key: string;
  result?: Address | AddressDeleteResult;
}
interface AddressState {
  items: Address[];
  status: 'idle' | 'loading' | 'ready' | 'error';
  saving: boolean;
  error: string | null;
  notice: string | null;
  pending: AddressOperation | null;
  failedOperation: AddressOperation | null;
  writeConfirmed: boolean;
}
const message = (error: unknown) =>
  error instanceof Error ? error.message : '操作结果暂未确认，请重试。';

export class AddressStore {
  private gateway: AddressGateway;
  private key: () => string;
  private listeners = new Set<() => void>();
  private state: AddressState = {
    items: [],
    status: 'idle',
    saving: false,
    error: null,
    notice: null,
    pending: null,
    failedOperation: null,
    writeConfirmed: false,
  };
  private loading: Promise<void> | null = null;
  private flight: Promise<void> | null = null;
  private attempt: Attempt | null = null;
  constructor(gateway: AddressGateway, key = () => crypto.randomUUID()) {
    this.gateway = gateway;
    this.key = key;
  }
  getSnapshot = (): AddressState => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private set(patch: Partial<AddressState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  clearFeedback = (): void => {
    if (!this.attempt && !this.flight && !this.loading)
      this.set({
        error: this.state.status === 'error' ? this.state.error : null,
        notice: null,
        failedOperation: null,
      });
  };
  load = (): Promise<void> => {
    if (this.flight) return this.flight;
    if (this.attempt)
      return Promise.reject(
        new AddressError('REQUEST_IN_PROGRESS', '请先确认上一次地址保存的结果。'),
      );
    if (this.loading) return this.loading;
    this.set({ status: 'loading', error: null, notice: null, failedOperation: null });
    this.loading = this.gateway
      .read()
      .then((items) => this.set({ items, status: 'ready' }))
      .catch((error) => {
        this.set({ status: 'error', error: message(error) });
        throw error;
      })
      .finally(() => {
        this.loading = null;
      });
    return this.loading;
  };
  create = (request: AddressCreateRequest): Promise<void> => {
    let normalized: AddressCreateRequest;
    try {
      normalized = normalizeAddress(request);
    } catch (error) {
      return Promise.reject(error);
    }
    return this.begin({ kind: 'create', request: normalized });
  };
  update = (addressId: string, request: AddressEditRequest): Promise<void> => {
    let normalized: AddressEditRequest;
    try {
      normalized = addressEditRequest(request, request.edit_token);
    } catch (error) {
      return Promise.reject(error);
    }
    if (!addressId)
      return Promise.reject(new AddressError('INVALID_ARGUMENT', '请先选择要编辑的地址。'));
    return this.begin({ kind: 'update', address_id: addressId, request: normalized });
  };
  setDefault = (addressId: string): Promise<void> => {
    if (!addressId)
      return Promise.reject(new AddressError('INVALID_ARGUMENT', '请先选择要设为默认的地址。'));
    return this.begin({ kind: 'set-default', address_id: addressId });
  };
  remove = (addressId: string): Promise<void> => {
    if (!addressId)
      return Promise.reject(new AddressError('INVALID_ARGUMENT', '请先选择要删除的地址。'));
    return this.begin({ kind: 'delete', address_id: addressId });
  };
  private begin(operation: AddressOperation): Promise<void> {
    const signature = JSON.stringify(operation);
    if (this.attempt && this.attempt.signature !== signature)
      return Promise.reject(
        new AddressError('REQUEST_IN_PROGRESS', '请先确认上一次地址保存的结果。'),
      );
    if (this.flight) return this.flight;
    if (!this.attempt) {
      if (this.state.status !== 'ready')
        return Promise.reject(new AddressError('REQUEST_IN_PROGRESS', '请先加载收货地址。'));
      this.attempt = { operation, signature, key: this.key() };
    }
    const attempt = this.attempt;
    this.set({
      saving: true,
      error: null,
      notice: null,
      pending: attempt.operation,
      failedOperation: null,
      writeConfirmed: !!attempt.result,
    });
    this.flight = (async () => {
      await Promise.resolve();
      try {
        if (!attempt.result)
          attempt.result =
            operation.kind === 'create'
              ? await this.gateway.create(operation.request, attempt.key)
              : operation.kind === 'update'
                ? await this.gateway.update(operation.address_id, operation.request, attempt.key)
                : operation.kind === 'set-default'
                  ? await this.gateway.setDefault(operation.address_id, attempt.key)
                  : await this.gateway.remove(operation.address_id, attempt.key);
        const items = await this.gateway.read();
        this.attempt = null;
        this.set({
          items,
          status: 'ready',
          error: null,
          pending: null,
          writeConfirmed: false,
          notice:
            operation.kind === 'create'
              ? '收货地址已保存。'
              : operation.kind === 'update'
                ? '收货地址已更新。'
                : operation.kind === 'delete'
                  ? '收货地址已删除，已显示最新地址列表。'
                  : '默认设置已确认，已显示最新地址列表。',
        });
      } catch (error) {
        const pending = !!attempt.result || !(error instanceof AddressError) || error.retryable;
        if (!pending) this.attempt = null;
        const failedOperation =
          !pending && error instanceof AddressError && error.code === 'SERVICE_UNAVAILABLE'
            ? attempt.operation
            : null;
        this.set({
          pending: pending ? attempt.operation : null,
          failedOperation,
          writeConfirmed: !!attempt.result,
          error: attempt.result
            ? operation.kind === 'delete'
              ? '地址已删除，列表暂未更新，请重新读取。'
              : operation.kind === 'set-default'
                ? '默认设置已保存，列表暂未更新，请重试读取。'
                : '地址已保存，列表暂未更新，请重试读取。'
            : message(error),
        });
        throw error;
      } finally {
        this.flight = null;
        this.set({ saving: false });
      }
    })();
    return this.flight;
  }
  retry = (): Promise<void> =>
    this.attempt
      ? this.begin(this.attempt.operation)
      : this.state.failedOperation
        ? this.begin(this.state.failedOperation)
        : this.load();
}
