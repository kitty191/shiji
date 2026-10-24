import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { cartAvailable } from '../api/cart.ts';
import { useCart } from './CartContext.ts';
import { cartSubtotal, purchaseStatusText } from '../lib/cart.ts';
import { formatMoney, prototypeUrl } from '../lib/catalog.ts';
import { buyerReturnPath } from '../lib/product.ts';
import type { CartItem } from '../types/cart.ts';

function CartImage({ item }: { item: CartItem }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [item.image_url]);
  return <span className={`cart-image ${item.image_disabled ? 'is-disabled' : ''}`}>
    {item.image_url && !failed ? <img src={item.image_url} alt="" onError={() => setFailed(true)} /> : <span>暂无图片</span>}
  </span>;
}
export function CartPanel({ top, trigger }: { top: number; trigger: RefObject<HTMLButtonElement | null> }) {
  const { state, store, close } = useCart();
  const panel = useRef<HTMLElement>(null), closeButton = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const dismiss = useCallback(() => {
    close();
    const target = trigger.current ?? previousFocus.current;
    if (target?.isConnected) target.focus({ preventScroll: true });
  }, [close, trigger]);
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const returnPath = buyerReturnPath(location.pathname === '/buyer' ? `${location.pathname}${location.search}` : params.get('return_to'));
  useEffect(() => {
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButton.current?.focus({ preventScroll: true });
    function key(event: KeyboardEvent) { if (event.key === 'Escape') dismiss(); }
    function outside(event: PointerEvent) {
      if (event.target instanceof Node && !panel.current?.contains(event.target) && !trigger.current?.contains(event.target)) close();
    }
    document.addEventListener('keydown', key); document.addEventListener('pointerdown', outside);
    return () => {
      document.removeEventListener('keydown', key); document.removeEventListener('pointerdown', outside);
    };
  }, [close, dismiss, trigger]);
  function row(item: CartItem, storeName: string) {
    const content = <><CartImage item={item} /><span className="cart-item-copy"><strong>{item.name}</strong><small>{item.spec_values.map(value => value.value).join(' · ') || '默认规格'}</small></span></>;
    const nav = item.navigation;
    return <li key={item.item_id} className="cart-item">
      {nav.scope === 'PUBLIC' && nav.target_id && (nav.type === 'PRODUCT' || nav.type === 'OFF_SALE_PRODUCT')
        ? <Link className="cart-item-link" onClick={close} to={`/products/${encodeURIComponent(nav.target_id)}?${new URLSearchParams({ sku_id: item.sku_id, return_to: returnPath })}`}>{content}</Link>
        : nav.scope === 'PUBLIC' && nav.type === 'STORE' && nav.target_id
          ? <a className="cart-item-link" href={prototypeUrl('store', { storeName })} target="_blank" rel="noopener noreferrer" title="查看原店铺交互原型">{content}</a>
          : <div className="cart-item-link">{content}</div>}
      <p className="cart-item-price"><span>{item.unit_price === null ? '暂无可用报价' : `¥${formatMoney(item.unit_price)}`}</span><span>× {item.quantity}</span></p>
      {!item.purchasable && <p className="cart-item-status">{purchaseStatusText[item.purchase_status]}</p>}
    </li>;
  }
  return <section ref={panel} id="cart-panel" className="cart-panel" role="dialog" aria-labelledby="cart-heading" style={{ top, maxHeight: `calc(100dvh - ${top + 24}px)` }}>
    <header><div><h2 id="cart-heading">购物车</h2><small>{cartAvailable ? '模拟账号 · 加购不锁定库存' : '购物车接口暂不可用'}</small></div><button ref={closeButton} className="text-button" aria-label="关闭购物车" onClick={dismiss}>×</button></header>
    <div className="cart-panel-body" aria-busy={state.status === 'loading' || state.adding}>
      {state.notice && <p className="cart-notice" role="status">{state.notice}</p>}
      {(state.error || state.retryPending) && <div className="cart-error" role="alert"><p>{state.error || '上次加购结果仍待确认。'}</p><button className="button" disabled={state.adding || state.status === 'loading'} onClick={() => void store.retry().catch(() => undefined)}>{state.retryPending ? '确认上次加购' : '重新加载购物车'}</button></div>}
      {state.status === 'loading' && <p role="status">正在更新购物车…</p>}
      {state.status === 'ready' && !state.view.item_count && <div className="cart-empty"><p>购物车还是空的</p><small>去挑选喜欢的好物吧。</small></div>}
      {state.view.groups.map(group => <section className="cart-group" key={group.store.store_id}><h3>{group.store.name}</h3><ul>{group.items.map(item => row(item, group.store.name))}</ul></section>)}
    </div>
    {(state.status === 'ready' || state.view.item_count > 0) && <footer><p><span>{state.view.item_count} 项 · {state.view.quantity_total} 件</span><span>可购商品合计 <strong>¥{formatMoney(cartSubtotal(state.view))}</strong></span></p><small>不可购买商品不计入合计；实际金额以结算确认为准。</small></footer>}
  </section>;
}
