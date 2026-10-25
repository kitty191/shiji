import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useBeforeUnload, useBlocker } from 'react-router-dom';
import { useCommerce } from './CommerceContext.ts';
import { CommerceError } from '../lib/commerce.ts';
import { normalizeShipping } from '../lib/merchant.ts';
import type { MerchantOrderDetail, ShipRequest } from '../types/merchant.ts';

export function ShippingDialog({ order, onClose, onSuccess, onUnknown, onStale }: {
  order: MerchantOrderDetail; onClose: () => void; onSuccess: (order: MerchantOrderDetail) => void; onUnknown: () => void; onStale: () => void;
}) {
  const { store, state } = useCommerce(), dialog = useRef<HTMLDialogElement>(null), carrier = useRef<HTMLInputElement>(null), tracking = useRef<HTMLInputElement>(null), stay = useRef<HTMLButtonElement>(null), submitButton = useRef<HTMLButtonElement>(null), staleButton = useRef<HTMLButtonElement>(null), focusFailure = useRef(false);
  const [draft, setDraft] = useState<ShipRequest>({ shipping_carrier: '', tracking_no: '' }), [error, setError] = useState(''), [stale, setStale] = useState(false), [cancelRequested, setCancelRequested] = useState(false);
  const dirty = !!(draft.shipping_carrier || draft.tracking_no), busy = state.busy;
  const blocker = useBlocker(({ currentLocation, nextLocation }) => (dirty || busy) && `${currentLocation.pathname}${currentLocation.search}` !== `${nextLocation.pathname}${nextLocation.search}`);
  const discarding = cancelRequested || blocker.state === 'blocked';
  useBeforeUnload(event => { if (dirty || busy) { event.preventDefault(); event.returnValue = ''; } });
  useEffect(() => {
    const element = dialog.current, previous = document.activeElement, overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; element?.showModal(); carrier.current?.focus();
    return () => { element?.close(); document.body.style.overflow = overflow; if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  useEffect(() => { if (discarding) stay.current?.focus(); }, [discarding]);
  useEffect(() => { if (focusFailure.current && !busy && error) { focusFailure.current = false; (stale ? staleButton.current : submitButton.current)?.focus(); } }, [error, busy, stale]);
  function resetBlocker() { if (blocker.state === 'blocked') blocker.reset(); }
  function close() { if (busy) return; if (dirty) setCancelRequested(true); else onClose(); }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (state.busy || state.pending || stale || discarding) return;
    setError('');
    if (!draft.shipping_carrier.trim()) { setError('请填写物流公司。'); carrier.current?.focus(); return; }
    if (!draft.tracking_no.trim()) { setError('请填写运单号。'); tracking.current?.focus(); return; }
    let request: ShipRequest;
    try { request = normalizeShipping(draft); } catch (problem) { setError(problem instanceof Error ? problem.message : '请检查物流信息。'); carrier.current?.focus(); return; }
    try {
      const shipped = await store.ship(order.order_id, request); resetBlocker(); onSuccess(shipped);
    } catch (problem) {
      if (store.getSnapshot().pending) { resetBlocker(); onUnknown(); return; }
      focusFailure.current = true; setError(problem instanceof Error ? problem.message : '模拟发货失败，请重试。');
      setStale(problem instanceof CommerceError && ['INVALID_STATE', 'NOT_FOUND', 'FORBIDDEN', 'IDEMPOTENCY_CONFLICT'].includes(problem.code));
    }
  }
  return <dialog ref={dialog} className="cart-delete-dialog address-leave-dialog address-delete-dialog" aria-labelledby="shipping-title" onCancel={event => { event.preventDefault(); if (discarding) { setCancelRequested(false); resetBlocker(); carrier.current?.focus(); } else close(); }}>
    <h2 id="shipping-title">模拟发货</h2><p>店铺订单号 {order.order_no}</p><p>本店整笔订单一次发货。仅演示物流，不会发起实际寄件。</p>
    <form noValidate onSubmit={event => void submit(event)}>
      <div className="address-fields"><div className="address-field"><label htmlFor="shipping-carrier">物流公司</label><input ref={carrier} id="shipping-carrier" value={draft.shipping_carrier} required disabled={busy || stale} onChange={e => { setError(''); setDraft({ ...draft, shipping_carrier: e.target.value }); }} autoComplete="off" /></div>
        <div className="address-field"><label htmlFor="shipping-number">运单号</label><input ref={tracking} id="shipping-number" value={draft.tracking_no} required disabled={busy || stale} onChange={e => { setError(''); setDraft({ ...draft, tracking_no: e.target.value }); }} autoComplete="off" /></div></div>
      {error && <p className="field-error" role="alert">{error}</p>}
      {discarding ? <section role="alert"><h3>{busy ? '发货正在提交' : '放弃未提交的物流信息？'}</h3><p>{busy ? '请等待原操作完成。' : '离开后将丢弃本次输入。'}</p><div className="address-actions"><button ref={stay} className="button" type="button" onClick={() => { setCancelRequested(false); resetBlocker(); carrier.current?.focus(); }}>{busy ? '继续等待' : '继续填写'}</button><button className="button" type="button" disabled={busy} onClick={() => { if (blocker.state === 'blocked') blocker.proceed(); else onClose(); }}>放弃填写</button></div></section>
        : <div className="address-actions"><button className="button" type="button" disabled={busy} onClick={close}>取消</button>{stale ? <button ref={staleButton} className="button" type="button" onClick={() => { resetBlocker(); onStale(); }}>返回订单并刷新</button> : <button ref={submitButton} className="button button--primary" type="submit" disabled={busy || !!state.pending}>{busy ? '正在提交发货…' : '确认模拟发货'}</button>}</div>}
    </form>
  </dialog>;
}
