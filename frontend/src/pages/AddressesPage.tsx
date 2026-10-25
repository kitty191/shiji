import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useBeforeUnload, useBlocker, useNavigate, useSearchParams } from 'react-router-dom';
import { addressesAvailable } from '../api/address.ts';
import { useAddresses } from '../components/AddressProvider.tsx';
import { Header } from '../components/Header.tsx';
import { FloatingTools, useRailState } from '../components/FloatingTools.tsx';
import { AddressError, addressEditRequest, addressFields, emptyAddress, normalizeAddress } from '../lib/address.ts';
import type { AddressField, AddressFieldErrors } from '../lib/address.ts';
import type { Address, AddressCreateRequest, AddressOperation } from '../types/address.ts';
import { prototypeUrl, queryParams, readQuery } from '../lib/catalog.ts';
import { buyerReturnPath } from '../lib/product.ts';

type FormSession =
  | { kind: 'create'; initial: AddressCreateRequest }
  | { kind: 'update'; address_id: string; edit_token: string; initial: AddressCreateRequest };

function pendingSession(operation: AddressOperation | null): FormSession | null {
  if (!operation || operation.kind === 'set-default') return null;
  const initial = { ...operation.request };
  return operation.kind === 'create' ? { kind: 'create', initial }
    : { kind: 'update', address_id: operation.address_id, edit_token: operation.request.edit_token, initial };
}

function LeaveAddressConfirm({ saving, editing, pending, writeConfirmed, onStay, onLeave }: { saving: boolean; editing: boolean; pending: boolean; writeConfirmed: boolean; onStay: () => void; onLeave: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement, element = dialog.current;
    element?.showModal();
    return () => { element?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  return <dialog ref={dialog} className="cart-delete-dialog address-leave-dialog" aria-labelledby="address-leave-title" onCancel={onStay}>
    <h2 id="address-leave-title">{saving ? '地址正在保存' : pending ? writeConfirmed ? '离开待刷新列表？' : '离开待确认操作？' : editing ? '离开地址编辑？' : '离开新增地址？'}</h2>
    <p>{saving ? '请等待本次操作完成。' : pending ? `${writeConfirmed ? '操作已保存，列表尚未更新。' : '上次操作结果尚未确认。'}站内离开后可返回地址页继续处理；刷新或关闭页面不保留本次操作标记。` : '尚未保存的输入将被丢弃，确定离开吗？'}</p>
    <div><button className="button" autoFocus onClick={onStay}>{saving ? '继续等待' : pending ? writeConfirmed ? '继续读取' : '继续确认' : '继续填写'}</button><button className="button button--primary" disabled={saving} onClick={onLeave}>确认离开</button></div>
  </dialog>;
}

export function AddressesPage() {
  const { store, state } = useAddresses();
  const [params] = useSearchParams(), navigate = useNavigate();
  const returnPath = buyerReturnPath(params.get('return_to'));
  const keyword = readQuery(new URLSearchParams(returnPath.split('?')[1])).keyword;
  const [collapsed, setCollapsed] = useRailState();
  const [session, setSession] = useState(() => pendingSession(state.pending));
  const [draft, setDraft] = useState<AddressCreateRequest>(() => ({ ...(pendingSession(state.pending)?.initial ?? emptyAddress()) }));
  const [errors, setErrors] = useState<AddressFieldErrors>({});
  const [editProblem, setEditProblem] = useState<string | null>(null);
  const [cancelRequested, setCancelRequested] = useState(false);
  const firstInput = useRef<HTMLInputElement>(null), addButton = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const addressHeadings = useRef(new Map<string, HTMLHeadingElement>());
  const formGeneration = useRef(0);
  const editing = session?.kind === 'update';
  const dirty = !!session && (addressFields.some(field => draft[field.name] !== session.initial[field.name]) ||
    session.kind === 'create' && !!draft.is_default !== !!session.initial.is_default);
  const needsGuard = dirty || state.saving || !!state.pending;
  const blocker = useBlocker(({ currentLocation, nextLocation }) => needsGuard &&
    `${currentLocation.pathname}${currentLocation.search}` !== `${nextLocation.pathname}${nextLocation.search}`);
  useBeforeUnload(useCallback((event: BeforeUnloadEvent) => {
    if (needsGuard || state.pending) { event.preventDefault(); event.returnValue = ''; }
  }, [needsGuard, state.pending]));
  useEffect(() => {
    if (!store.getSnapshot().pending) void store.load().catch(() => undefined);
  }, [store]);
  useEffect(() => { if (session) firstInput.current?.focus(); }, [session]);
  useEffect(() => () => { formGeneration.current++; }, []);
  useEffect(() => { if (blocker.state === 'blocked' && !needsGuard) blocker.proceed(); }, [blocker, needsGuard]);
  function closeForm(saved = false) {
    formGeneration.current++;
    if (!saved) store.clearFeedback();
    setSession(null); setDraft(emptyAddress()); setErrors({}); setEditProblem(null); setCancelRequested(false);
    requestAnimationFrame(() => {
      const target = returnFocus.current?.isConnected ? returnFocus.current : addButton.current;
      target?.focus({ preventScroll: true });
    });
  }
  function edit(address: Address, trigger: HTMLElement) {
    formGeneration.current++;
    store.clearFeedback();
    const initial = normalizeAddress(address);
    returnFocus.current = trigger;
    setSession({ kind: 'update', address_id: address.address_id, edit_token: address.edit_token, initial });
    setDraft({ ...initial }); setErrors({}); setEditProblem(null);
  }
  async function reloadOriginal() {
    if (session?.kind !== 'update') return;
    const generation = formGeneration.current;
    try {
      await store.load();
      if (generation !== formGeneration.current) return;
      const address = store.getSnapshot().items.find(item => item.address_id === session.address_id);
      if (!address) { setEditProblem('这条地址已不存在，请取消编辑并查看最新列表。'); return; }
      const initial = normalizeAddress(address);
      setSession({ ...session, edit_token: address.edit_token, initial });
      setDraft({ ...initial }); setErrors({}); setEditProblem(null);
    } catch (error) {
      if (generation === formGeneration.current) setEditProblem(error instanceof Error ? error.message : '重新读取失败，请稍后重试；当前输入仍保留。');
    }
  }
  function update(name: AddressField, value: string) {
    setDraft(previous => ({ ...previous, [name]: value }));
    setErrors(previous => ({ ...previous, [name]: undefined }));
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    await saveDraft();
  }
  async function saveDraft() {
    if (!session || editProblem || store.getSnapshot().saving || store.getSnapshot().pending || store.getSnapshot().status !== 'ready') return;
    try {
      const request = normalizeAddress(draft);
      setErrors({});
      if (session.kind === 'update') await store.update(session.address_id, addressEditRequest(request, session.edit_token));
      else await store.create(request);
      closeForm(true);
    } catch (error) {
      if (error instanceof AddressError && Object.keys(error.fields).length) {
        setErrors(error.fields);
        const field = addressFields.find(field => error.fields[field.name]);
        if (field) document.getElementById(`address-${field.name}`)?.focus();
      }
      if (session.kind === 'update' && error instanceof AddressError && ['EDIT_CONFLICT', 'NOT_FOUND'].includes(error.code)) setEditProblem(error.message);
    }
  }
  function focusAddress(addressId: string) {
    requestAnimationFrame(() => addressHeadings.current.get(addressId)?.focus({ preventScroll: true }));
  }
  async function setDefault(addressId: string) {
    try { await store.setDefault(addressId); focusAddress(addressId); } catch { /* Store exposes the error and recovery action. */ }
  }
  async function retry() {
    // A rejected write may be corrected in the form; retry the visible draft.
    if (!state.pending && state.failedOperation && state.failedOperation.kind !== 'set-default' && session) { await saveDraft(); return; }
    try {
      await store.retry();
      if (state.pending?.kind === 'set-default') focusAddress(state.pending.address_id);
      else if (state.failedOperation?.kind === 'set-default') focusAddress(state.failedOperation.address_id);
      else if (session && state.pending) closeForm(true);
    } catch (error) {
      if (editing && error instanceof AddressError && ['EDIT_CONFLICT', 'NOT_FOUND'].includes(error.code)) setEditProblem(error.message);
    }
  }
  const busy = state.saving || state.status === 'loading';
  const locked = busy || !!state.pending;
  return <div className="site-shell">
    <div className="preview-note"><span>收货地址预览 · {addressesAvailable ? '模拟数据' : 'API 数据'}</span><a href={prototypeUrl('addresses')} target="_blank" rel="noopener noreferrer">查看完整交互原型 ↗</a></div>
    <Header keyword={keyword} onSearch={value => navigate(`/buyer?${queryParams({ ...readQuery(new URLSearchParams()), keyword: value })}`)} />
    <main id="main-content" className={`catalog-page addresses-page ${collapsed ? 'rail-collapsed' : ''}`}>
      <nav className="detail-breadcrumb" aria-label="地址导航"><Link to={returnPath} state={{ restoreCatalog: true }}>‹ 返回商城</Link><span>收货地址</span></nav>
      <div className="cart-page-heading"><div><h1>收货地址</h1><p>保存常用地址，下次收货更方便。</p></div>
        {addressesAvailable && !session && <button ref={addButton} className="button button--primary" disabled={busy || state.status !== 'ready' || !!state.pending} onClick={event => {
          formGeneration.current++; store.clearFeedback();
          returnFocus.current = event.currentTarget;
          const initial = emptyAddress(); setDraft({ ...initial }); setErrors({}); setEditProblem(null); setSession({ kind: 'create', initial });
        }}>新增地址</button>}
      </div>
      <p className="address-demo-note">当前为本机演示，请填写虚构信息，不会发起实际配送。</p>
      {state.notice && <p className="cart-notice" role="status">{state.notice}</p>}
      {state.error && !editProblem && <div className="cart-error" role="alert"><p>{state.error}</p><button className="button" disabled={busy} onClick={() => void retry()}>{state.writeConfirmed ? '重新读取地址列表' : state.pending ? state.pending.kind === 'set-default' ? '确认上次默认设置结果' : state.pending.kind === 'update' ? '确认上次编辑结果' : '确认上次新增结果' : state.failedOperation ? state.failedOperation.kind === 'set-default' ? '重试默认设置' : '重试保存地址' : '重新加载地址'}</button></div>}
      {state.pending && !state.saving && <p className="address-demo-note">{state.writeConfirmed ? '操作已保存，请重新读取地址列表后继续。' : state.pending.kind === 'set-default' ? '上次默认设置结果尚待确认，暂不能新增、编辑或再次切换默认地址。' : '上次保存结果尚待确认，暂不能再次保存或更改本次输入。'}</p>}
      <section aria-label="地址簿" aria-busy={busy}>
        {state.status === 'loading' && <p className="cart-loading-copy" role="status">正在加载地址…</p>}
        {session && <form className="address-form" aria-label={editing ? '编辑收货地址' : '新增收货地址'} noValidate onSubmit={save}>
          <h2>{editing ? '编辑地址' : '新增地址'}</h2>
          {editProblem && <div className="cart-error"><p role="alert">{editProblem}</p><button type="button" className="button" disabled={locked} onClick={() => void reloadOriginal()}>重新载入原地址（替换当前输入）</button></div>}
          <div className="address-fields">{addressFields.map((field, index) => <div className={field.name === 'detail_address' ? 'address-field address-field-wide' : 'address-field'} key={field.name}>
            <label htmlFor={`address-${field.name}`}>{field.label}<span aria-hidden="true"> *</span></label>
            <input ref={index === 0 ? firstInput : undefined} id={`address-${field.name}`} name={field.name} value={draft[field.name]}
              maxLength={field.maxLength} required autoComplete="off" inputMode={field.name === 'recipient_phone' ? 'numeric' : 'text'}
              disabled={locked} aria-invalid={!!errors[field.name]} aria-describedby={errors[field.name] ? `address-error-${field.name}` : undefined}
              onChange={event => update(field.name, event.target.value)} />
            {errors[field.name] && <p className="field-error" id={`address-error-${field.name}`} role="alert">{errors[field.name]}</p>}
          </div>)}</div>
          {!editing && <><label className="address-default-check"><input type="checkbox" checked={draft.is_default === true} disabled={locked} onChange={event => setDraft(previous => ({ ...previous, is_default: event.target.checked }))} />设为默认地址</label>
            <p className="address-demo-note">首条收货地址会自动设为默认；已有地址时，勾选才会切换默认地址。</p></>}
          <div className="address-actions"><button className="button button--primary" type="submit" disabled={locked || state.status !== 'ready' || !!editProblem || editing && !dirty}>{state.saving ? '正在保存…' : '保存地址'}</button><button className="button" type="button" disabled={state.saving} onClick={() => dirty || state.pending ? setCancelRequested(true) : closeForm()}>取消</button></div>
        </form>}
        {state.status === 'ready' && !state.items.length && !session && <div className="empty-state"><h2>还没有收货地址</h2><p>点击新增地址，保存第一条虚构演示地址。</p></div>}
        {!!state.items.length && <div className="address-grid">{state.items.map(address => <article className="address-card" key={address.address_id} data-address-id={address.address_id}>
          <div><h2 tabIndex={-1} ref={element => { if (element) addressHeadings.current.set(address.address_id, element); else addressHeadings.current.delete(address.address_id); }}>{address.recipient_name}</h2>{address.is_default && <span className="address-default-badge">默认地址</span>}</div>
          <p>{address.recipient_phone}</p><p>{address.province} {address.city} {address.district}</p><p>{address.detail_address}</p>
          {addressesAvailable && <div className="address-actions">
            <button className="text-button" aria-label={`编辑${address.recipient_name}的地址`} disabled={locked || state.status !== 'ready' || !!session} onClick={event => edit(address, event.currentTarget)}>编辑</button>
            {!address.is_default && <button className="text-button" aria-label={`将${address.recipient_name}的地址设为默认`} disabled={locked || state.status !== 'ready' || !!session} onClick={() => void setDefault(address.address_id)}>{state.saving && state.pending?.kind === 'set-default' && state.pending.address_id === address.address_id ? '正在设置…' : '设为默认'}</button>}
          </div>}
        </article>)}</div>}
      </section>
    </main>
    {(cancelRequested || blocker.state === 'blocked') && <LeaveAddressConfirm saving={state.saving} editing={editing} pending={!!state.pending} writeConfirmed={state.writeConfirmed}
      onStay={() => { setCancelRequested(false); if (blocker.state === 'blocked') blocker.reset(); }}
      onLeave={() => { if (blocker.state === 'blocked') blocker.proceed(); else closeForm(); }} />}
    <FloatingTools collapsed={collapsed} onCollapse={setCollapsed} />
  </div>;
}
