import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { commerceAvailable, commerceGateway } from '../api/commerce.ts';
import { useAddresses } from '../components/AddressProvider.tsx';
import { useCart } from '../components/CartContext.ts';
import { useCommerce } from '../components/CommerceContext.ts';
import { BuyerWorkflow, TransactionLines, useClock, remainingTime } from '../components/BuyerWorkflow.tsx';
import { CommerceError, checkoutBackPath, readCheckoutSelection } from '../lib/commerce.ts';
import { formatMoney } from '../lib/catalog.ts';
import { hasQuantityWork } from '../stores/cart.ts';
import type { CheckoutPreview } from '../types/commerce.ts';

export function CheckoutPage() {
  const [params, setParams] = useSearchParams(), location = useLocation(), navigate = useNavigate();
  const addresses = useAddresses(), cart = useCart(), transaction = useCommerce(), now = useClock();
  const [reload, setReload] = useState(0), [invalidated, setInvalidated] = useState(false);
  const [preview, setPreview] = useState<{ key: string; status: 'loading' | 'ready' | 'error'; data?: CheckoutPreview; error?: string }>({ key: '', status: 'loading' });
  let selection, selectionError = '';
  try { selection = readCheckoutSelection(params); } catch (error) { selectionError = error instanceof Error ? error.message : '结算内容无效。'; }
  const selectionKey = selection ? JSON.stringify(selection) : '', addressId = params.get('address_id') || '', key = `${selectionKey}|${addressId}`;
  const backTo = checkoutBackPath(params.get('return_to')), blocked = transaction.state.busy || !!transaction.state.pending;
  const addressBusy = addresses.state.saving || !!addresses.state.pending || addresses.state.status !== 'ready';
  const cartBusy = cart.state.mutating || cart.state.retryPending || hasQuantityWork(cart.state);
  useEffect(() => { if (commerceAvailable && !addresses.store.getSnapshot().pending) void addresses.store.load().catch(() => undefined); }, [addresses.store]);
  useEffect(() => {
    if (!addressId && addresses.state.status === 'ready') {
      const defaultAddress = addresses.state.items.find(a => a.is_default);
      if (defaultAddress) { const next = new URLSearchParams(params); next.set('address_id', defaultAddress.address_id); setParams(next, { replace: true, preventScrollReset: true }); }
    }
  }, [addresses.state.status, addresses.state.items, addressId]);
  useEffect(() => {
    if (!commerceAvailable || !selectionKey || !addressId || addressBusy || blocked) return;
    let current = true; setInvalidated(false); setPreview({ key, status: 'loading' });
    void commerceGateway.preview({ ...JSON.parse(selectionKey), address_id: addressId }).then(data => {
      if (current) setPreview({ key, status: 'ready', data });
    }).catch(error => { if (current) setPreview({ key, status: 'error', error: error instanceof Error ? error.message : '预览失败，请重试。' }); });
    return () => { current = false; };
  }, [key, reload, addressBusy]);
  const quote = preview.key === key && preview.status === 'ready' ? preview.data : undefined;
  const expired = !!quote && Date.parse(quote.preview_expires_at) <= now;
  const validAddress = addresses.state.items.some(a => a.address_id === addressId);
  const ready = !!quote && !expired && !invalidated && !blocked && !addressBusy && !cartBusy && validAddress;
  async function refresh() {
    if (blocked) return;
    transaction.store.clearError(); setInvalidated(true);
    try { await addresses.store.load(); setReload(n => n + 1); } catch { /* Address state retains the error and recovery action. */ }
  }
  async function submit() {
    if (!ready || !quote) return;
    try {
      const payment = await transaction.store.submit(quote.preview_token);
      void cart.store.load().catch(() => undefined);
      navigate(`/orders/${encodeURIComponent(payment.shop_orders[0].order_id)}`, { replace: true });
    } catch (error) {
      if (error instanceof CommerceError && ['PRICE_CHANGED', 'ADDRESS_CHANGED', 'CART_CHANGED', 'PREVIEW_EXPIRED', 'ITEM_NOT_PURCHASABLE', 'INSUFFICIENT_STOCK'].includes(error.code)) setInvalidated(true);
    }
  }
  return <BuyerWorkflow title="确认订单" subtitle="核对收货地址与商品，按店铺生成订单。" backTo={backTo} backLabel={backTo.startsWith('/products/') ? '返回商品' : '返回购物车'}>
    {!commerceAvailable ? <div className="empty-state" role="alert"><h2>结算接口暂不可用</h2><p>当前仅接入公开商品查询。</p></div> : selectionError ? <div className="empty-state" role="alert"><h2>没有有效的结算内容</h2><p>{selectionError}</p><Link className="button" to={backTo}>重新选择商品</Link></div> : <>
      <div className="checkout-layout"><div className="checkout-content">
        <section className="workflow-panel" aria-label="结算收货地址"><div className="workflow-panel-heading"><h2>收货地址</h2><Link className="text-button" to={`/addresses?${new URLSearchParams({ return_to: `${location.pathname}${location.search}` })}`}>管理收货地址</Link></div>
          {addresses.state.status === 'loading' && <p role="status">正在读取地址…</p>}
          {addresses.state.error && <p className="field-error" role="alert">{addresses.state.error}</p>}
          {addresses.state.pending && <p role="alert">有待确认的地址操作，请进入地址管理完成处理。</p>}
          {addresses.state.status === 'ready' && !addresses.state.items.length && <p>还没有收货地址，请先添加一条虚构地址。</p>}
          {!!addresses.state.items.length && <label className="checkout-address-picker">选择收货地址<select aria-label="选择收货地址" value={addressId} disabled={blocked || addressBusy} onChange={event => {
            const next = new URLSearchParams(params); next.set('address_id', event.target.value); setParams(next, { replace: true, preventScrollReset: true }); transaction.store.clearError();
          }}><option value="">请选择地址</option>{addressId && !validAddress && <option value={addressId}>原地址已不存在，请重新选择</option>}{addresses.state.items.map(a => <option key={a.address_id} value={a.address_id}>{a.recipient_name} · {a.detail_address}{a.is_default ? '（默认）' : ''}</option>)}</select></label>}
          {quote && <div className="checkout-address-snapshot"><strong>{quote.address.recipient_name}　{quote.address.recipient_phone}</strong><p>{quote.address.province} {quote.address.city} {quote.address.district} {quote.address.detail_address}</p></div>}
        </section>
        {addressId && !addressBusy && (preview.key !== key || preview.status === 'loading') && <p role="status">正在核对结算内容…</p>}
        {preview.key === key && preview.status === 'error' && <div className="cart-error" role="alert"><p>{preview.error}</p><button className="button" disabled={blocked} onClick={() => void refresh()}>重新预览</button></div>}
        {quote?.groups.map(group => <section className="workflow-panel" key={group.store.store_id} aria-label={`${group.store.name}结算商品`}><h2>{group.store.name}</h2><TransactionLines items={group.items} /><p className="transaction-group-total">店铺合计 ¥{formatMoney(group.total_amount)}</p></section>)}
      </div><aside className="workflow-panel checkout-summary" aria-label="结算明细"><h2>结算明细</h2>
        {quote ? <><p>商品金额 <span>¥{formatMoney(quote.total_amount)}</span></p><p>运费 <span>¥0 · 演示包邮</span></p><p>涉及 {quote.groups.length} 家店铺 · {quote.groups.reduce((n, g) => n + g.items.reduce((s, i) => s + i.quantity, 0), 0)} 件商品</p><strong className="checkout-total">¥{formatMoney(quote.total_amount)}</strong><p>{expired ? '预览已过期，请重新预览' : `预览有效时间 ${remainingTime(quote.preview_expires_at, now)}`}</p></> : <p>选择地址并完成预览后显示金额。</p>}
        {cartBusy && <p role="alert">请先完成或确认购物车数量及其他操作，再提交订单。</p>}
        {invalidated && <p className="field-error" role="alert">请重新预览，核对最新内容后再提交。</p>}
        {transaction.state.error && !transaction.state.pending && <p className="field-error" role="alert">{transaction.state.error}</p>}
        <button className="button" disabled={blocked || addresses.state.saving || !!addresses.state.pending} onClick={() => void refresh()}>刷新地址与预览</button>
        <button className="button button--primary" disabled={!ready} onClick={() => void submit()}>{transaction.state.busy ? '正在提交…' : '提交订单'}</button>
        <p className="workflow-muted">预览不占库存，提交时重新核验。提交后进入待付款，模拟付款将在后续批次开放。</p>
      </aside></div>
    </>}
  </BuyerWorkflow>;
}
