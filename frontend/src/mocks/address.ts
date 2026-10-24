import type { Address, AddressCreateRequest } from '../types/address.ts';
import { AddressError, normalizeAddress } from '../lib/address.ts';

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
    const normalized = normalizeAddress(request), fingerprint = JSON.stringify(normalized);
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
}
