import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useBeforeUnload, useBlocker, useNavigate, useSearchParams } from 'react-router-dom';
import { addressesAvailable } from '../api/address.ts';
import { useAddresses } from '../components/AddressProvider.tsx';
import { Header } from '../components/Header.tsx';
import { FloatingTools, useRailState } from '../components/FloatingTools.tsx';
import { AddressError, addressFields, emptyAddress, normalizeAddress } from '../lib/address.ts';
import type { AddressField, AddressFieldErrors } from '../lib/address.ts';
import { prototypeUrl, queryParams, readQuery } from '../lib/catalog.ts';
import { buyerReturnPath } from '../lib/product.ts';

function LeaveAddressConfirm({ saving, onStay, onLeave }: { saving: boolean; onStay: () => void; onLeave: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement, element = dialog.current;
    element?.showModal();
    return () => { element?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  return <dialog ref={dialog} className="cart-delete-dialog address-leave-dialog" aria-labelledby="address-leave-title" onCancel={onStay}>
    <h2 id="address-leave-title">{saving ? '地址正在保存' : '离开新增地址？'}</h2>
    <p>{saving ? '请等待本次保存完成。' : '尚未保存的输入将被丢弃。结果待确认的新增请求仍会保留，可返回地址页继续确认。'}</p>
    <div><button className="button" autoFocus onClick={onStay}>继续填写</button><button className="button button--primary" disabled={saving} onClick={onLeave}>确认离开</button></div>
  </dialog>;
}

export function AddressesPage() {
  const { store, state } = useAddresses();
  const [params] = useSearchParams(), navigate = useNavigate();
  const returnPath = buyerReturnPath(params.get('return_to'));
  const keyword = readQuery(new URLSearchParams(returnPath.split('?')[1])).keyword;
  const [collapsed, setCollapsed] = useRailState();
  const [creating, setCreating] = useState(() => !!state.pending);
  const [draft, setDraft] = useState(() => ({ ...(state.pending ?? emptyAddress()) }));
  const [errors, setErrors] = useState<AddressFieldErrors>({});
  const [cancelRequested, setCancelRequested] = useState(false);
  const firstInput = useRef<HTMLInputElement>(null), addButton = useRef<HTMLButtonElement>(null);
  const dirty = creating && (addressFields.some(field => !!draft[field.name]) || draft.is_default === true);
  const needsGuard = dirty || state.saving;
  const blocker = useBlocker(({ currentLocation, nextLocation }) => needsGuard &&
    `${currentLocation.pathname}${currentLocation.search}` !== `${nextLocation.pathname}${nextLocation.search}`);
  useBeforeUnload(useCallback((event: BeforeUnloadEvent) => {
    if (needsGuard || state.pending) { event.preventDefault(); event.returnValue = ''; }
  }, [needsGuard, state.pending]));
  useEffect(() => {
    if (!store.getSnapshot().pending) void store.load().catch(() => undefined);
  }, [store]);
  useEffect(() => { if (creating) firstInput.current?.focus(); }, [creating]);
  useEffect(() => { if (blocker.state === 'blocked' && !needsGuard) blocker.proceed(); }, [blocker, needsGuard]);
  function closeForm() {
    setCreating(false); setDraft(emptyAddress()); setErrors({}); setCancelRequested(false);
    requestAnimationFrame(() => addButton.current?.focus({ preventScroll: true }));
  }
  function update(name: AddressField, value: string) {
    setDraft(previous => ({ ...previous, [name]: value }));
    setErrors(previous => ({ ...previous, [name]: undefined }));
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    try {
      const request = normalizeAddress(draft);
      setErrors({}); await store.create(request); closeForm();
    } catch (error) {
      if (error instanceof AddressError && Object.keys(error.fields).length) {
        setErrors(error.fields);
        const field = addressFields.find(field => error.fields[field.name]);
        if (field) document.getElementById(`address-${field.name}`)?.focus();
      }
    }
  }
  async function retry() {
    try { await store.retry(); if (creating && state.pending) closeForm(); } catch { /* Keep input and pending operation visible. */ }
  }
  const busy = state.saving || state.status === 'loading';
  const locked = busy || !!state.pending;
  return <div className="site-shell">
    <div className="preview-note"><span>收货地址预览 · {addressesAvailable ? '模拟数据' : 'API 数据'}</span><a href={prototypeUrl('addresses')} target="_blank" rel="noopener noreferrer">查看完整交互原型 ↗</a></div>
    <Header keyword={keyword} onSearch={value => navigate(`/buyer?${queryParams({ ...readQuery(new URLSearchParams()), keyword: value })}`)} />
    <main id="main-content" className={`catalog-page addresses-page ${collapsed ? 'rail-collapsed' : ''}`}>
      <nav className="detail-breadcrumb" aria-label="地址导航"><Link to={returnPath} state={{ restoreCatalog: true }}>‹ 返回商城</Link><span>收货地址</span></nav>
      <div className="cart-page-heading"><div><h1>收货地址</h1><p>保存常用地址，下次收货更方便。</p></div>
        {addressesAvailable && !creating && <button ref={addButton} className="button button--primary" disabled={busy || state.status !== 'ready' || !!state.pending} onClick={() => { setDraft(emptyAddress()); setErrors({}); setCreating(true); }}>新增地址</button>}
      </div>
      <p className="address-demo-note">当前为本机演示，请填写虚构信息，不会发起实际配送。</p>
      {state.notice && <p className="cart-notice" role="status">{state.notice}</p>}
      {state.error && <div className="cart-error" role="alert"><p>{state.error}</p><button className="button" disabled={busy} onClick={() => void retry()}>{state.pending ? '确认上次新增结果' : '重新加载地址'}</button></div>}
      {state.pending && !state.saving && <p className="address-demo-note">上次新增结果尚待确认，暂不能重复新增或更改本次输入。</p>}
      <section aria-label="地址簿" aria-busy={busy}>
        {state.status === 'loading' && <p className="cart-loading-copy" role="status">正在加载地址…</p>}
        {creating && <form className="address-form" aria-label="新增收货地址" noValidate onSubmit={save}>
          <h2>新增地址</h2>
          <div className="address-fields">{addressFields.map((field, index) => <div className={field.name === 'detail_address' ? 'address-field address-field-wide' : 'address-field'} key={field.name}>
            <label htmlFor={`address-${field.name}`}>{field.label}<span aria-hidden="true"> *</span></label>
            <input ref={index === 0 ? firstInput : undefined} id={`address-${field.name}`} name={field.name} value={draft[field.name]}
              maxLength={field.maxLength} required autoComplete="off" inputMode={field.name === 'recipient_phone' ? 'numeric' : 'text'}
              disabled={locked} aria-invalid={!!errors[field.name]} aria-describedby={errors[field.name] ? `address-error-${field.name}` : undefined}
              onChange={event => update(field.name, event.target.value)} />
            {errors[field.name] && <p className="field-error" id={`address-error-${field.name}`} role="alert">{errors[field.name]}</p>}
          </div>)}</div>
          <label className="address-default-check"><input type="checkbox" checked={draft.is_default === true} disabled={locked} onChange={event => setDraft(previous => ({ ...previous, is_default: event.target.checked }))} />设为默认地址</label>
          <p className="address-demo-note">首条收货地址会自动设为默认；已有地址时，勾选才会切换默认地址。</p>
          <div className="address-actions"><button className="button button--primary" type="submit" disabled={locked || state.status !== 'ready'}>{state.saving ? '正在保存…' : '保存地址'}</button><button className="button" type="button" disabled={state.saving} onClick={() => dirty ? setCancelRequested(true) : closeForm()}>取消</button></div>
        </form>}
        {state.status === 'ready' && !state.items.length && !creating && <div className="empty-state"><h2>还没有收货地址</h2><p>点击新增地址，保存第一条虚构演示地址。</p></div>}
        {!!state.items.length && <div className="address-grid">{state.items.map(address => <article className="address-card" key={address.address_id}>
          <div><h2>{address.recipient_name}</h2>{address.is_default && <span className="address-default-badge">默认地址</span>}</div>
          <p>{address.recipient_phone}</p><p>{address.province} {address.city} {address.district}</p><p>{address.detail_address}</p>
        </article>)}</div>}
      </section>
    </main>
    {(cancelRequested || blocker.state === 'blocked') && <LeaveAddressConfirm saving={state.saving}
      onStay={() => { setCancelRequested(false); if (blocker.state === 'blocked') blocker.reset(); }}
      onLeave={() => { if (blocker.state === 'blocked') blocker.proceed(); else closeForm(); }} />}
    <FloatingTools collapsed={collapsed} onCollapse={setCollapsed} />
  </div>;
}
