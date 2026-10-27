import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { merchantAvailable } from '../api/merchant.ts';
import { merchantDraftGateway, merchantDraftStore } from '../api/merchantProduct.ts';
import { getCategories } from '../api/catalog.ts';
import { BuyerWorkflow } from '../components/BuyerWorkflow.tsx';
import { DraftFeedback, useMerchantDraftGuard, useMerchantDraftState } from '../components/MerchantDraftState.tsx';
import { draftFields, draftForm, DraftInputError } from '../lib/merchantDraft.ts';
import type { DraftForm } from '../lib/merchantDraft.ts';
import { merchantProductsReturnPath } from '../lib/merchantProduct.ts';
import type { MerchantDraft } from '../types/merchantProduct.ts';
import type { Category } from '../types/catalog.ts';
import { formatDate } from '../lib/commerce.ts';

export function MerchantDraftEditorPage() {
  const { productId = '' } = useParams(), [params] = useSearchParams(), state = useMerchantDraftState();
  const back = merchantProductsReturnPath(params.get('return_to'));
  const [record, setRecord] = useState<MerchantDraft | null>(null), [form, setForm] = useState<DraftForm>({ title: '', category_id: '', description: '', price: '' });
  const [categories, setCategories] = useState<Category[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState(''), [fieldError, setFieldError] = useState(''), [stale, setStale] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null), retry = useRef<HTMLButtonElement>(null), submit = useRef<HTMLButtonElement>(null), generation = useRef(0), alive = useRef(true);
  const current = record?.product_id === productId ? record : null, dirty = !!current && JSON.stringify(form) !== JSON.stringify(draftForm(current));
  const guard = useMerchantDraftGuard(dirty), disabled = state.busy || !!state.pending || stale;
  function adopt(draft: MerchantDraft) { setRecord(draft); setForm(draftForm(draft)); setStale(false); setFieldError(''); setError(''); }
  async function load(focus = false) {
    const request = ++generation.current; setLoading(true); setError('');
    try {
      const [draft, options] = await Promise.all([merchantDraftGateway.draft(productId), merchantAvailable ? getCategories() : Promise.resolve([])]);
      if (request !== generation.current) return;
      adopt(draft); setCategories(options); if (focus) requestAnimationFrame(() => heading.current?.focus({ preventScroll: true }));
    } catch (problem) { if (request === generation.current) { setError(problem instanceof Error ? problem.message : '读取草稿失败，请重试。'); if (focus) requestAnimationFrame(() => retry.current?.focus()); } }
    finally { if (request === generation.current) setLoading(false); }
  }
  useEffect(() => { alive.current = true; merchantDraftStore.clearFeedback(); setRecord(null); void load(); return () => { generation.current++; alive.current = false; }; }, [productId]);
  useEffect(() => { if (record?.product_id === productId && state.result?.product_id === productId) { generation.current++; setLoading(false); adopt(state.result); requestAnimationFrame(() => submit.current?.focus({ preventScroll: true })); } }, [state.result, productId, record?.product_id]);
  async function save(event: FormEvent) {
    event.preventDefault(); if (!current || disabled || loading) return;
    setFieldError('');
    try { const fields = draftFields(form); await merchantDraftStore.save(productId, { edit_token: current.edit_token, fields }); }
    catch (problem) {
      if (!alive.current) return;
      if (problem instanceof DraftInputError) { setFieldError(problem.message); document.getElementById(`draft-${problem.field}`)?.focus(); }
      else { if (merchantDraftStore.getSnapshot().code === 'EDIT_CONFLICT') setStale(true); requestAnimationFrame(() => submit.current?.focus({ preventScroll: true })); }
    }
  }
  function change(field: keyof DraftForm, value: string) { setForm(previous => ({ ...previous, [field]: value })); setFieldError(''); }
  return <BuyerWorkflow title="编辑商品草稿" subtitle="保存基本资料，下次打开继续完善。" backTo={back} backLabel="返回商品管理">
    {guard.dialog}<DraftFeedback />
    {loading && <p role="status">正在读取已保存草稿…</p>}
    {error && <section className="cart-error" role="alert"><h2>{merchantAvailable ? '暂时无法读取草稿' : '商家商品接口暂不可用'}</h2><p>{error}</p>{merchantAvailable && <button ref={retry} className="button" onClick={() => void load(true)}>重新读取草稿</button>}<Link className="button" to={back}>返回商品管理</Link></section>}
    {current && <section className="workflow-panel merchant-draft-panel"><h2 ref={heading} tabIndex={-1}>{current.title || '未命名商品'} · 草稿</h2><p className="workflow-muted">编号 {current.product_id} · 创建于 {formatDate(current.created_at)}</p><p>资料可以暂缺，保存不会发布。此草稿尚未包含图片和规格。</p>
      <form noValidate onSubmit={event => void save(event)}><fieldset disabled={disabled || loading} className="merchant-draft-fields">
        <div className="address-field"><label htmlFor="draft-title">商品名称</label><input id="draft-title" value={form.title} onChange={e => change('title', e.target.value)} /></div>
        <div className="address-field"><label htmlFor="draft-category_id">商品分类</label><select id="draft-category_id" value={form.category_id} onChange={e => change('category_id', e.target.value)}><option value="">暂不选择</option>{categories.map(category => <option key={category.category_id} value={category.category_id}>{category.name}</option>)}</select></div>
        <div className="address-field merchant-draft-wide"><label htmlFor="draft-description">商品简介</label><textarea id="draft-description" rows={5} value={form.description} onChange={e => change('description', e.target.value)} /></div>
        <div className="address-field"><label htmlFor="draft-price">展示价（元，可选）</label><input id="draft-price" inputMode="decimal" value={form.price} aria-describedby={fieldError ? 'draft-price-error draft-price-help' : 'draft-price-help'} aria-invalid={!!fieldError} onChange={e => change('price', e.target.value)} /><p id="draft-price-help" className="workflow-muted">留空恢复自动取价；草稿尚无规格时显示待完善。</p></div>
      </fieldset>{fieldError && <p id="draft-price-error" className="field-error" role="alert">{fieldError}</p>}
      {stale && <section role="alert"><p>当前输入仍保留。重新读取会用已保存内容替换当前输入。</p><button className="button" disabled={loading || state.busy} onClick={() => void load(true)} type="button">重新读取并替换当前输入</button></section>}
      <div className="address-actions"><button ref={submit} className="button button--primary" type="submit" disabled={disabled || loading}>{state.busy ? '正在处理…' : '保存草稿'}</button><Link className="button" to={back}>返回商品管理</Link><span className="workflow-muted">{dirty ? '有未保存的修改' : '内容与已保存草稿一致'}</span></div></form>
    </section>}
  </BuyerWorkflow>;
}
