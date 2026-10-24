import type { Address, AddressCreateRequest, AddressEditRequest } from '../types/address.ts';
import { AddressError, addressEditRequest, normalizeAddress } from '../lib/address.ts';

interface Options { load?: () => string | null; save?: (value: string) => void; id?: () => string; now?: () => number }

function validAddress(value: unknown): value is Address {
  if (!value || typeof value !== 'object') return false;
  const address = value as Address;
  try { normalizeAddress(address); } catch { return false; }
  return typeof address.address_id === 'string' && !!address.address_id && typeof address.is_default === 'boolean' &&
    typeof address.created_at === 'string' && Number.isFinite(Date.parse(address.created_at)) &&
    typeof address.updated_at === 'string' && Number.isFinite(Date.parse(address.updated_at)) &&
    typeof address.edit_token === 'string';
}

// A separate fictional address book; never reads the HTML prototype's snapshot.
export class MockAddresses {
  private items: Address[] = [];
  private receipts = new Map<string, { fingerprint: string; result: Address }>();
  private options: Options;
  constructor(options: Options = {}) { this.options = options; }
  read(): Address[] {
    if (this.options.load) {
      try {
        const raw = this.options.load();
        if (raw === null) this.items = [];
        else {
          const data = JSON.parse(raw);
          if (data?.version !== 1 || !Array.isArray(data.items) || !data.items.every(validAddress) ||
            new Set(data.items.map((item: Address) => item.address_id)).size !== data.items.length ||
            data.items.filter((item: Address) => item.is_default).length > 1) throw Error('Invalid snapshot');
          this.items = data.items;
        }
      } catch { throw new AddressError('SERVICE_UNAVAILABLE', '暂时无法读取地址，请稍后重试；已有资料未被覆盖。'); }
    }
    return structuredClone(this.items);
  }
  create(request: AddressCreateRequest, key: string): Address {
    const normalized = normalizeAddress(request), fingerprint = JSON.stringify(['create', normalized]);
    if (!key) throw new AddressError('INVALID_ARGUMENT', '操作标记不能为空。');
    const receipt = this.receipts.get(key);
    if (receipt) {
      if (receipt.fingerprint !== fingerprint) throw new AddressError('IDEMPOTENCY_CONFLICT', '操作标记与新增地址不一致。');
      return structuredClone(receipt.result);
    }
    const previous = this.read(), timestamp = new Date((this.options.now ?? Date.now)()).toISOString();
    const is_default = !previous.length || normalized.is_default === true;
    const address: Address = { ...normalized, is_default, address_id: (this.options.id ?? (() => crypto.randomUUID()))(),
      created_at: timestamp, updated_at: timestamp, edit_token: `mock_${crypto.randomUUID()}` };
    const next = previous.map(item => is_default && item.is_default ? { ...item, is_default: false, updated_at: timestamp, edit_token: `mock_${crypto.randomUUID()}` } : item);
    next.push(address);
    try { this.options.save?.(JSON.stringify({ version: 1, items: next })); }
    catch { throw new AddressError('SERVICE_UNAVAILABLE', '地址暂时无法保存，输入仍保留，请稍后重试。'); }
    this.items = next;
    this.receipts.set(key, { fingerprint, result: structuredClone(address) });
    while (this.receipts.size > 200) this.receipts.delete(this.receipts.keys().next().value!);
    return structuredClone(address);
  }
  setDefault(addressId: string, key: string): Address {
    if (!addressId || !key) throw new AddressError('INVALID_ARGUMENT', '地址与操作标记不能为空。');
    const fingerprint = JSON.stringify(['set-default', addressId]), receipt = this.receipts.get(key);
    // Confirm the original result without reapplying an old switch after a later one.
    if (receipt) {
      if (receipt.fingerprint !== fingerprint) throw new AddressError('IDEMPOTENCY_CONFLICT', '操作标记与默认地址不一致。');
      return structuredClone(receipt.result);
    }
    const previous = this.read(), original = previous.find(item => item.address_id === addressId);
    if (!original) throw new AddressError('NOT_FOUND', '这条地址已不存在，请重新加载地址列表。');
    let address = original;
    if (!original.is_default) {
      const timestamp = new Date((this.options.now ?? Date.now)()).toISOString();
      const next = previous.map(item => {
        const is_default = item.address_id === addressId;
        return item.is_default === is_default ? item : { ...item, is_default, updated_at: timestamp, edit_token: `mock_${crypto.randomUUID()}` };
      });
      // One snapshot write switches both flags; a storage failure leaves both intact.
      try { this.options.save?.(JSON.stringify({ version: 1, items: next })); }
      catch { throw new AddressError('SERVICE_UNAVAILABLE', '默认地址暂时无法更新，请稍后重试。'); }
      this.items = next;
      address = next.find(item => item.address_id === addressId)!;
    }
    this.receipts.set(key, { fingerprint, result: structuredClone(address) });
    while (this.receipts.size > 200) this.receipts.delete(this.receipts.keys().next().value!);
    return structuredClone(address);
  }
  update(addressId: string, request: AddressEditRequest, operationKey: string): Address {
    const normalized = addressEditRequest(request, request.edit_token);
    const fingerprint = JSON.stringify(['update', addressId, normalized]);
    if (!operationKey) throw new AddressError('INVALID_ARGUMENT', '操作标记不能为空。');
    // Local receipt recovery only; D03 has no HTTP Idempotency-Key contract.
    const receipt = this.receipts.get(operationKey);
    if (receipt) {
      if (receipt.fingerprint !== fingerprint) throw new AddressError('IDEMPOTENCY_CONFLICT', '操作标记与编辑内容不一致。');
      return structuredClone(receipt.result);
    }
    const previous = this.read(), original = previous.find(item => item.address_id === addressId);
    if (!original) throw new AddressError('NOT_FOUND', '这条地址已不存在，请重新加载地址列表。');
    if (original.edit_token !== normalized.edit_token) throw new AddressError('EDIT_CONFLICT', '这条地址已在其他页面修改，请重新载入后再编辑。');
    const { edit_token: _token, ...fields } = normalized;
    const address: Address = { ...original, ...fields, updated_at: new Date((this.options.now ?? Date.now)()).toISOString(), edit_token: `mock_${crypto.randomUUID()}` };
    const next = previous.map(item => item.address_id === addressId ? address : item);
    try { this.options.save?.(JSON.stringify({ version: 1, items: next })); }
    catch { throw new AddressError('SERVICE_UNAVAILABLE', '地址暂时无法保存，输入仍保留，请稍后重试。'); }
    this.items = next;
    this.receipts.set(operationKey, { fingerprint, result: structuredClone(address) });
    while (this.receipts.size > 200) this.receipts.delete(this.receipts.keys().next().value!);
    return structuredClone(address);
  }
}
