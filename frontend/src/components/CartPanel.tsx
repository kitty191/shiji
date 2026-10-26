import { useCallback, useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { cartAvailable } from '../api/cart.ts';
import { useCart } from './CartContext.ts';
import { cartSubtotal, purchaseStatusText } from '../lib/cart.ts';
import { formatMoney } from '../lib/catalog.ts';
import { buyerContextPath, cartPath, productReturnPath } from '../lib/product.ts';
import type { CartItem } from '../types/cart.ts';
import { CartItemLink } from './CartItemLink.tsx';
import { CartItemEditor } from './CartItemEditor.tsx';
import { CartFeedback } from './CartFeedback.tsx';

export function CartPanel({ top, trigger }: { top: number; trigger: RefObject<HTMLButtonElement | null> }) {
  const { state, close } = useCart();
  const panel = useRef<HTMLElement>(null), closeButton = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const dismiss = useCallback(() => {
    close();
    const target = trigger.current ?? previousFocus.current;
    if (target?.isConnected) target.focus({ preventScroll: true });
  }, [close, trigger]);
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const fromCatalog = location.pathname === '/buyer' || location.pathname.startsWith('/stores/');
  const returnPath = productReturnPath(fromCatalog ? `${location.pathname}${location.search}` : params.get('return_to'));
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
    return <li key={item.item_id} className="cart-item">
      <CartItemLink item={item} storeName={storeName} returnTo={returnPath} onNavigate={close} />
      <p className="cart-item-price"><span>{item.unit_price === null ? '暂无可用报价' : `¥${formatMoney(item.unit_price)}`}</span></p>
      <CartItemEditor item={item} />
      {!item.purchasable && <p className="cart-item-status">{purchaseStatusText[item.purchase_status]}</p>}
    </li>;
  }
  return <section ref={panel} id="cart-panel" className="cart-panel" role="dialog" aria-labelledby="cart-heading" style={{ top, maxHeight: `calc(100dvh - ${top + 24}px)` }}>
    <header><div><h2 id="cart-heading">购物车</h2><small>{cartAvailable ? '模拟账号 · 加购不锁定库存' : '购物车接口暂不可用'}</small></div><button ref={closeButton} className="text-button" aria-label="关闭购物车" onClick={dismiss}>×</button></header>
    <div className="cart-panel-body" aria-busy={state.status === 'loading' || state.mutating}>
      <CartFeedback />
      {state.status === 'ready' && !state.view.item_count && <div className="cart-empty"><p>购物车还是空的</p><small>去挑选喜欢的好物吧。</small></div>}
      {state.view.groups.map(group => <section className="cart-group" key={group.store.store_id}><h3>{group.store.name}</h3><ul>{group.items.map(item => row(item, group.store.name))}</ul></section>)}
    </div>
    <footer>{(state.status === 'ready' || state.view.item_count > 0) && <><p><span>{state.view.item_count} 项 · {state.view.quantity_total} 件</span><span>可购商品合计 <strong>¥{formatMoney(cartSubtotal(state.view))}</strong></span></p><small>不可购买商品不计入合计；实际金额以结算确认为准。</small></>}
      <Link className="button cart-page-entry" to={cartPath(buyerContextPath(returnPath))} onClick={close}>查看购物车</Link>
    </footer>
  </section>;
}
