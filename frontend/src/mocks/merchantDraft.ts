import type { Category, StoreBrief } from '../types/catalog.ts';
import type { DraftFields, DraftSaveRequest, MerchantDraft } from '../types/merchantProduct.ts';
import { isMerchantProduct } from '../lib/merchantProduct.ts';
import { CommerceError } from '../lib/commerce.ts';
const fields = ['title', 'category_id', 'description', 'display_price_override'] as const;
interface Receipt { key: string; action: 'create' | 'save'; target: string; fingerprint: string; result: MerchantDraft }
interface Snapshot { version: 1; drafts: MerchantDraft[]; receipts: Receipt[] }
interface Options { store: () => StoreBrief | null; categories: () => Category[]; load: () => string | null; save: (data: string) => void; id?: () => string; now?: () => number }
export class MockMerchantDrafts {
  private options: Options;
  constructor(options: Options) { this.options = options; }
  private store(): StoreBrief { const store = this.options.store(); if (!store?.store_id || !store.name) throw new CommerceError('FORBIDDEN', '当前账号没有商品草稿管理权限。'); return store; }
  private valid(d: unknown, storeId: string): d is MerchantDraft {
    if (!isMerchantProduct(d)) return false;
    const row = d as MerchantDraft;
    return row.store_id === storeId && row.sale_status === 'DRAFT' && row.platform_status === 'NORMAL' && row.published_at === null && row.cover_image === null && row.sku_count === 0 && row.available_stock_total === 0 &&
      (row.category_id === null || typeof row.category_id === 'string') && (row.description === null || typeof row.description === 'string') && row.display_price === row.display_price_override &&
      typeof row.created_at === 'string' && Number.isFinite(Date.parse(row.created_at)) && row.platform_restriction_reason === null &&
      ['images','dimensions','historical_dimensions','skus','attributes'].every(k => Array.isArray(row[k as keyof MerchantDraft]) && (row[k as keyof MerchantDraft] as unknown[]).length === 0);
  }
  private read(storeId: string): Snapshot {
    try {
      const raw = this.options.load(); if (raw === null) return { version: 1, drafts: [], receipts: [] };
      const s = JSON.parse(raw) as Snapshot;
      if (s?.version !== 1 || !Array.isArray(s.drafts) || !Array.isArray(s.receipts) || !s.drafts.every(d => this.valid(d, storeId)) || new Set(s.drafts.map(d => d.product_id)).size !== s.drafts.length ||
        !s.receipts.every(r => r && typeof r.key === 'string' && !!r.key && ['create','save'].includes(r.action) && typeof r.fingerprint === 'string' && s.drafts.some(d => d.product_id === r.target) && r.target === r.result?.product_id && this.valid(r.result, storeId)) || new Set(s.receipts.map(r => r.key)).size !== s.receipts.length) throw Error('invalid');
      return s;
    } catch { throw new CommerceError('SERVICE_UNAVAILABLE', '草稿读取失败，请重试；未用空数据覆盖已保存内容。'); }
  }
  private write(snapshot: Snapshot): void { try { this.options.save(JSON.stringify(snapshot)); } catch { throw new CommerceError('SERVICE_UNAVAILABLE', '草稿保存失败，请检查浏览器存储后重试。'); } }
  private key(key: string) { if (typeof key !== 'string' || !key) throw new CommerceError('INVALID_ARGUMENT', '缺少操作标记，请重新操作。'); }
  private replay(s: Snapshot, key: string, action: Receipt['action'], target: string | null, fingerprint: string): MerchantDraft | null {
    const previous = s.receipts.find(r => r.key === key); if (!previous) return null;
    if (previous.action !== action || target !== null && previous.target !== target || previous.fingerprint !== fingerprint) throw new CommerceError('IDEMPOTENCY_CONFLICT', '操作标记与原请求不一致，请先确认原操作。');
    return structuredClone(previous.result);
  }
  private normalize(input: Partial<DraftFields>): Partial<DraftFields> {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !fields.includes(k as typeof fields[number]))) throw new CommerceError('INVALID_ARGUMENT', '本批只接受草稿基本资料。');
    const result: Partial<DraftFields> = {};
    for (const field of fields) if (Object.hasOwn(input, field)) {
      const value = input[field];
      if (field === 'display_price_override') {
        if (value !== null && (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)) throw new CommerceError('INVALID_ARGUMENT', '展示价必须是非负整数分或留空。');
        result.display_price_override = value as number | null;
      } else {
        if (value !== null && typeof value !== 'string') throw new CommerceError('INVALID_ARGUMENT', '草稿字段格式不正确。');
        result[field] = typeof value === 'string' ? value.trim() || null : null;
      }
    }
    if (result.category_id && !this.options.categories().some(c => c.category_id === result.category_id)) throw new CommerceError('INVALID_ARGUMENT', '所选分类已不可用，请重新选择。');
    return result;
  }
  summaries(): MerchantDraft[] { const store = this.store(); return structuredClone(this.read(store.store_id).drafts); }
  draft(id: string): MerchantDraft { const d = this.summaries().find(d => d.product_id === id); if (!d) throw new CommerceError('NOT_FOUND', '没有找到可编辑的本店草稿。'); return d; }
  create(key: string): MerchantDraft {
    const store = this.store(); this.key(key); const s = this.read(store.store_id), previous = this.replay(s, key, 'create', null, '{}'); if (previous) return previous;
    const id = `draft_${this.options.id?.() ?? crypto.randomUUID()}`, now = new Date(this.options.now?.() ?? Date.now()).toISOString();
    if (s.drafts.some(d => d.product_id === id)) throw new CommerceError('SERVICE_UNAVAILABLE', '草稿编号冲突，请重试。');
    const draft: MerchantDraft = { product_id: id, store_id: store.store_id, title: null, cover_image: null, sale_status: 'DRAFT', platform_status: 'NORMAL', display_price_override: null, display_price: null,
      sku_count: 0, available_stock_total: 0, published_at: null, updated_at: now, created_at: now, edit_token: crypto.randomUUID(), category_id: null, description: null, attributes: [], platform_restriction_reason: null,
      images: [], dimensions: [], historical_dimensions: [], skus: [] };
    s.drafts.push(draft); s.receipts.push({ key, action: 'create', target: id, fingerprint: '{}', result: structuredClone(draft) }); this.write(s); return structuredClone(draft);
  }
  save(id: string, request: DraftSaveRequest, key: string): { product: MerchantDraft; id_map: never[] } {
    const store = this.store(); this.key(key); const s = this.read(store.store_id), d = s.drafts.find(d => d.product_id === id);
    if (!d) throw new CommerceError('NOT_FOUND', '没有找到可编辑的本店草稿。');
    if (!request || typeof request.edit_token !== 'string' || Object.keys(request).some(k => !['edit_token','fields'].includes(k))) throw new CommerceError('INVALID_ARGUMENT', '草稿保存参数无效。');
    const normalized = this.normalize(request.fields), fingerprint = JSON.stringify({ edit_token: request.edit_token, fields: normalized });
    const previous = this.replay(s, key, 'save', id, fingerprint); if (previous) return { product: previous, id_map: [] };
    if (d.edit_token !== request.edit_token) throw new CommerceError('EDIT_CONFLICT', '草稿已被其他页面修改，请重新读取后再编辑；当前输入仍保留。');
    Object.assign(d, normalized); d.display_price = d.display_price_override; d.updated_at = new Date(this.options.now?.() ?? Date.now()).toISOString(); d.edit_token = crypto.randomUUID();
    s.receipts.push({ key, action: 'save', target: id, fingerprint, result: structuredClone(d) }); this.write(s); return { product: structuredClone(d), id_map: [] };
  }
}
