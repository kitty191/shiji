import { useEffect, useRef, useSyncExternalStore } from 'react';
import { Link, useBeforeUnload, useBlocker } from 'react-router-dom';
import { merchantDraftStore } from '../api/merchantProduct.ts';
import { merchantDraftPath } from '../lib/merchantProduct.ts';
export function useMerchantDraftState() { return useSyncExternalStore(merchantDraftStore.subscribe, merchantDraftStore.getSnapshot); }
export function DraftFeedback() {
  const state = useMerchantDraftState(), button = useRef<HTMLButtonElement>(null), focus = useRef(false), success = useRef<HTMLAnchorElement>(null);
  useEffect(() => { if (focus.current && !state.busy) { focus.current = false; (button.current ?? success.current)?.focus(); } }, [state.busy]);
  return <>
    {state.pending ? <section className="workflow-panel" role="status"><h2>{state.confirmedId ? '草稿已保存，等待重新读取' : state.busy ? '正在处理草稿' : '草稿操作结果尚未确认'}</h2><p>{state.error || '请等待原操作完成。'}</p><p>先处理原操作，再新增或保存。站内返回商品管理可继续处理；刷新不保留当前操作标记。</p><button ref={button} className="button" disabled={state.busy} onClick={() => { focus.current = true; void merchantDraftStore.retry().catch(() => undefined); }}>{state.confirmedId ? '重新读取已保存草稿' : '确认原草稿操作'}</button></section>
      : state.error ? <p className="field-error" role="alert">{state.error}</p> : state.result && <section className="workflow-panel" role="status"><p>草稿已保存。编号 {state.result.product_id}</p><Link ref={success} className="text-button" to={merchantDraftPath(state.result.product_id, '/merchant/products')}>继续编辑已保存草稿</Link></section>}
  </>;
}
export function useMerchantDraftGuard(dirty = false) {
  const state = useMerchantDraftState(), dialog = useRef<HTMLDialogElement>(null), blocked = useRef(false);
  const blocker = useBlocker(({ currentLocation, nextLocation }) => {
    const live = merchantDraftStore.getSnapshot();
    return (dirty || live.busy || !!live.pending) && `${currentLocation.pathname}${currentLocation.search}` !== `${nextLocation.pathname}${nextLocation.search}`;
  });
  blocked.current = blocker.state === 'blocked';
  useBeforeUnload(event => { const live = merchantDraftStore.getSnapshot(); if (dirty || live.busy || live.pending) { event.preventDefault(); event.returnValue = ''; } });
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    const element = dialog.current, previous = document.activeElement; element?.showModal();
    return () => { element?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true }); };
  }, [blocker.state]);
  return { isBlocked: () => blocked.current, dialog: blocker.state === 'blocked' && <dialog ref={dialog} className="cart-delete-dialog address-leave-dialog" aria-labelledby="draft-leave-title" onCancel={event => { event.preventDefault(); if (blocker.state === 'blocked') blocker.reset(); }}>
    <h2 id="draft-leave-title">{state.busy ? '草稿操作正在进行' : state.pending ? '原草稿操作尚待处理' : '离开未保存的草稿？'}</h2><p>{state.busy ? '请等待原操作完成。' : state.pending ? '站内返回商品管理可以继续确认；刷新不保留操作标记。' : '本次未保存的输入将丢弃，已保存的草稿仍会保留。'}</p>
    <div className="address-actions"><button autoFocus className="button" onClick={() => { if (blocker.state === 'blocked') blocker.reset(); }}>继续编辑或确认</button><button className="button" disabled={state.busy} onClick={() => { if (blocker.state === 'blocked') blocker.proceed(); }}>确认离开</button></div>
  </dialog> };
}
