import { useEffect, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { cartAvailable } from '../api/cart.ts';
import { Header } from '../components/Header.tsx';
import { FloatingTools, useRailState } from '../components/FloatingTools.tsx';
import { CartFeedback } from '../components/CartFeedback.tsx';
import { CartItemLink } from '../components/CartItemLink.tsx';
import { useCart } from '../components/CartContext.ts';
import { cartCheckState, cartSelectionSummary, purchaseStatusText, selectableCartItem } from '../lib/cart.ts';
import { formatMoney, prototypeUrl, queryParams, readQuery } from '../lib/catalog.ts';
import { buyerReturnPath, cartPath } from '../lib/product.ts';
import type { CartItem } from '../types/cart.ts';

function CartCheck({ items, label, disabled = false }: { items: readonly CartItem[]; label: string; disabled?: boolean }) {
  const { state, store } = useCart();
  const input = useRef<HTMLInputElement>(null);
  const check = cartCheckState(items, state.choices);
  useEffect(() => { if (input.current) input.current.indeterminate = check.mixed; }, [check.mixed]);
  return <input ref={input} type="checkbox" aria-label={label} checked={check.checked} disabled={disabled || check.disabled}
    onChange={event => store.select(items.map(item => item.item_id), event.target.checked)} />;
}

export function CartPage() {
  const { state, store } = useCart();
  const [params] = useSearchParams(), navigate = useNavigate();
  const returnPath = buyerReturnPath(params.get('return_to'));
  const detailReturn = cartPath(returnPath);
  const [collapsed, setCollapsed] = useRailState();
  useEffect(() => {
    if (!store.getSnapshot().retryPending) void store.load().catch(() => undefined);
  }, [store]);
  const items = state.view.groups.flatMap(group => group.items);
  const selection = cartSelectionSummary(state.view, state.choices);
  const busy = state.status === 'loading' || state.adding;
  const selectionDisabled = busy || state.status !== 'ready' || state.retryPending;
  const keyword = readQuery(new URLSearchParams(returnPath.split('?')[1])).keyword;
  return <div className="site-shell">
    <div className="preview-note"><span>购物车预览 · {cartAvailable ? '模拟数据' : 'API 数据'}</span><a href={prototypeUrl('buyer')} target="_blank" rel="noopener noreferrer">查看完整交互原型 ↗</a></div>
    <Header keyword={keyword} onSearch={value => navigate(`/buyer?${queryParams({ ...readQuery(new URLSearchParams()), keyword: value })}`)} />
    <main className={`catalog-page cart-page ${collapsed ? 'rail-collapsed' : ''}`} id="main-content">
      <nav className="detail-breadcrumb" aria-label="购物车导航"><Link to={returnPath} state={{ restoreCatalog: true }}>‹ 继续逛逛</Link><span>购物车</span></nav>
      <div className="cart-page-heading"><div><h1>我的购物车</h1><p>按店铺查看商品，勾选喜欢的好物。</p></div>
        {cartAvailable && <button className="button" disabled={busy || state.retryPending} onClick={() => void store.load().catch(() => undefined)}>刷新购物车</button>}
      </div>
      <section className="cart-page-content" aria-label="购物车内容" aria-busy={busy}>
        <CartFeedback />
        {state.status === 'ready' && !items.length && <div className="empty-state"><h2>购物车还是空的</h2><p>去挑选喜欢的好物吧。</p><Link className="button button--primary" to={returnPath} state={{ restoreCatalog: true }}>去逛逛</Link></div>}
        {!items.length && (state.status === 'idle' || state.status === 'loading') && <div className="cart-page-loading" aria-hidden="true" />}
        {!!items.length && <>
          <div className="cart-page-count">共 {state.view.item_count} 项 · {state.view.quantity_total} 件</div>
          <table className="cart-table"><caption className="sr-only">购物车商品清单</caption>
            <thead><tr><th scope="col">选择</th><th scope="col">商品信息</th><th scope="col">单价</th><th scope="col">数量</th><th scope="col">小计</th></tr></thead>
            {state.view.groups.map(group => <tbody key={group.store.store_id} aria-label={`${group.store.name}商品`}>
              <tr className="cart-store-row"><th colSpan={5} scope="rowgroup"><label><CartCheck items={group.items} label={`选择${group.store.name}全部可购商品`} disabled={selectionDisabled} /><span>{group.store.name}</span></label></th></tr>
              {group.items.map(item => <tr key={item.item_id} className={!item.purchasable ? 'cart-row-unavailable' : undefined}>
                <td><CartCheck items={[item]} label={`选择${item.name} ${item.spec_values.map(value => value.value).join(' · ') || '默认规格'}`} disabled={selectionDisabled} /></td>
                <th scope="row"><CartItemLink item={item} storeName={group.store.name} returnTo={detailReturn} fromCart />
                  {!item.purchasable && <p className="cart-item-status">{purchaseStatusText[item.purchase_status]}{item.purchase_status === 'INSUFFICIENT_STOCK' && item.available_stock !== null ? `，当前库存 ${item.available_stock} 件` : ''}</p>}
                </th>
                <td className="cart-money">{item.unit_price === null ? '暂无可用报价' : `¥${formatMoney(item.unit_price)}`}</td>
                <td className="cart-quantity" aria-label={`${item.name}数量 ${item.quantity}`}>{item.quantity}</td>
                <td className="cart-money">{item.line_amount === null ? '—' : `¥${formatMoney(item.line_amount)}`}</td>
              </tr>)}
            </tbody>)}
          </table>
          {items.some(item => !selectableCartItem(item)) && <p className="cart-exclusion-note">不可购买商品不参与勾选与合计。</p>}
        </>}
      </section>
      {!!items.length && <section className="cart-page-summary" aria-label="购物车汇总">
        <label><CartCheck items={items} label="全选可购商品" disabled={selectionDisabled} /><span>全选可购商品</span></label>
        <div className="cart-selection-total" aria-live="polite" aria-atomic="true"><p>已选 {selection.item_count} 项 · {selection.quantity_total} 件 · {selection.store_count} 家店</p><p>商品合计 <strong>¥{formatMoney(selection.amount)}</strong></p></div>
        <div className="cart-checkout"><button className="button button--primary" disabled aria-describedby="cart-checkout-note">去结算</button><p id="cart-checkout-note">结算暂未开放</p></div>
      </section>}
      <p className="catalog-note">商品、店铺与交易资料均为虚构演示数据；加购不锁定库存，实际金额以结算确认为准。</p>
    </main>
    <FloatingTools collapsed={collapsed} onCollapse={setCollapsed} />
  </div>;
}
