import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { commerceAvailable, commerceGateway } from '../api/commerce.ts';
import { BuyerWorkflow, remainingTime, useClock } from '../components/BuyerWorkflow.tsx';
import { CancelPaymentConfirm } from '../components/CancelPaymentConfirm.tsx';
import { useCommerce } from '../components/CommerceContext.ts';
import { useCart } from '../components/CartContext.ts';
import { CommerceError, formatDate, orderStatuses, ordersReturnPath, paymentReturnPath } from '../lib/commerce.ts';
import { formatMoney } from '../lib/catalog.ts';
import type { PaymentGroup } from '../types/commerce.ts';

export function PaymentPage() {
  const { paymentId = '' } = useParams(), [params] = useSearchParams();
  const backTo = paymentReturnPath(params.get('return_to'));
  const orderList = backTo.startsWith('/orders/') ? ordersReturnPath(new URLSearchParams(backTo.split('?')[1]).get('return_to')) : backTo;
  const transaction = useCommerce(), cart = useCart(), now = useClock();
  const heading = useRef<HTMLHeadingElement>(null), retryButton = useRef<HTMLButtonElement>(null), focusAfterRead = useRef(false), expiryRead = useRef('');
  const [reload, setReload] = useState(0), [confirm, setConfirm] = useState(false), [notice, setNotice] = useState('');
  const [result, setResult] = useState<{ id: string; status: 'loading' | 'ready' | 'error'; payment?: PaymentGroup; error?: string; missing?: boolean }>({ id: paymentId, status: 'loading' });
  useEffect(() => {
    let current = true; setConfirm(false); setResult({ id: paymentId, status: 'loading' });
    void commerceGateway.payment(paymentId).then(payment => { if (current) setResult({ id: paymentId, status: 'ready', payment }); })
      .catch(error => { if (current) setResult({ id: paymentId, status: 'error', error: error instanceof Error ? error.message : '支付单读取失败，请重试。', missing: error instanceof CommerceError && error.code === 'NOT_FOUND' }); });
    return () => { current = false; };
  }, [paymentId, reload, transaction.state.revision]);
  const payment = result.id === paymentId && result.status === 'ready' ? result.payment : undefined;
  const expired = !!payment && Date.parse(payment.expires_at) <= now;
  const locked = transaction.state.busy || !!transaction.state.pending;
  useEffect(() => setNotice(''), [paymentId]);
  useEffect(() => {
    if (!payment || payment.status !== 'PENDING') return;
    const key = `${payment.payment_group_id}|${payment.expires_at}`;
    if (expiryRead.current === key) return;
    const timer = setTimeout(() => { expiryRead.current = key; setReload(value => value + 1); }, Math.max(0, Date.parse(payment.expires_at) - Date.now()) + 50);
    return () => clearTimeout(timer);
  }, [payment?.payment_group_id, payment?.status, payment?.expires_at]);
  useEffect(() => {
    if (result.id === paymentId && result.status !== 'loading' && focusAfterRead.current) {
      focusAfterRead.current = false; (result.status === 'error' ? retryButton.current ?? heading.current : heading.current)?.focus({ preventScroll: true });
    }
  }, [result, paymentId]);
  function refresh() { focusAfterRead.current = true; setReload(value => value + 1); }
  async function pay() {
    if (!payment || locked || payment.status !== 'PENDING' || Date.parse(payment.expires_at) <= Date.now() || !payment.allowed_actions.includes('SIMULATE_PAY')) return;
    setNotice(''); focusAfterRead.current = true;
    try {
      await transaction.store.pay(payment.payment_group_id);
      setNotice('模拟付款成功，全部关联店铺订单已进入待发货。');
      void cart.store.load().catch(() => undefined);
    } catch {
      // A definitive failure rechecks T03 before another attempt; unknown results keep the original key.
      if (!transaction.store.getSnapshot().pending) setReload(value => value + 1);
    }
  }
  async function cancel() {
    if (!payment || locked || payment.status !== 'PENDING' || Date.parse(payment.expires_at) <= Date.now() || !payment.allowed_actions.includes('CANCEL')) return;
    setConfirm(false);
    try {
      const cancelled = await transaction.store.cancel(payment.payment_group_id);
      void cart.store.load().catch(() => undefined);
      setNotice(cancelled.close_reason === 'TIMEOUT' ? '付款超时，本次结算与全部关联店铺订单已关闭。' : '本次结算已取消，全部关联店铺订单已关闭。'); focusAfterRead.current = true;
    } catch { /* The existing store owns definitive failures and unknown-result recovery. */ }
  }
  const statusLabel = payment?.status === 'PENDING' ? '等待付款' : payment?.status === 'PAID' ? '已付款' : '本次结算已关闭';
  return <BuyerWorkflow title="付款" subtitle="核对本次支付单与关联店铺订单。" backTo={backTo} backLabel={backTo.startsWith('/orders/') ? '返回订单详情' : '返回我的订单'}>
    {notice && <p className="cart-notice" role="status">{notice}</p>}
    {result.id !== paymentId || result.status === 'loading' ? <p role="status">正在读取支付单…</p> : result.status === 'error' ? <section className="empty-state" role="alert">
      <h2 ref={heading} tabIndex={-1}>{result.missing ? '没有找到这次结算' : commerceAvailable ? '暂时无法读取支付单' : '付款接口暂不可用'}</h2><p>{result.error}</p>
      {!result.missing && commerceAvailable && <button ref={retryButton} className="button" onClick={refresh}>重新读取支付单</button>}
      <Link className="button" to={orderList}>查看我的订单</Link>
    </section> : payment && <>
      <section className="workflow-panel order-state-panel" aria-label="支付单状态">
        <div><h2 ref={heading} tabIndex={-1}>{statusLabel}</h2><p>支付单号 {payment.payment_no}</p></div>
        <button className="button" disabled={locked} onClick={refresh}>刷新支付单状态</button>
        {payment.status === 'PENDING' && <p>{expired ? '付款有效期已结束，请核对最新支付单状态。' : `剩余付款时间 ${remainingTime(payment.expires_at, now)}`}</p>}
        {payment.status === 'CLOSED' && <p>{payment.close_reason === 'TIMEOUT' ? '付款超时，全部关联店铺订单已关闭，模拟库存占用已释放。' : '本次结算已取消，全部关联店铺订单已关闭，模拟库存占用已释放。'}</p>}
        {payment.status === 'PAID' && <p>本次结算已付款，请进入关联订单查看进度。</p>}
      </section>
      <div className="checkout-layout"><section className="checkout-content" aria-label="关联店铺订单">
        <p className="workflow-muted">同一支付单共 {payment.shop_orders.length} 笔店铺订单，统一结算。</p>
        {payment.shop_orders.map(order => <article className="workflow-panel payment-shop-order" key={order.order_id}>
          <div className="order-card-heading"><div><h2>{order.store_name}</h2><p>店铺订单号 {order.order_no}</p></div><span className={`order-status status-${order.status.toLowerCase()}`}>{orderStatuses[order.status]}</span></div>
          <dl className="order-metadata"><div><dt>商品金额</dt><dd>¥{formatMoney(order.goods_amount)}</dd></div><div><dt>运费</dt><dd>¥{formatMoney(order.shipping_amount)}</dd></div><div><dt>店铺合计</dt><dd>¥{formatMoney(order.total_amount)}</dd></div></dl>
          <Link className="button" to={`/orders/${encodeURIComponent(order.order_id)}?${new URLSearchParams({ return_to: orderList })}`}>查看订单详情<span className="sr-only">：{order.order_no}</span></Link>
        </article>)}
      </section><aside className="workflow-panel checkout-summary" aria-label="支付单汇总"><h2>{payment.status === 'PAID' ? '已付金额' : '本次结算金额'}</h2><strong className="checkout-total">¥{formatMoney(payment.total_amount)}</strong>
        <dl className="order-metadata"><div><dt>创建时间</dt><dd>{formatDate(payment.created_at)}</dd></div><div><dt>付款截止</dt><dd>{formatDate(payment.expires_at)}</dd></div>{payment.paid_at && <div><dt>付款时间</dt><dd>{formatDate(payment.paid_at)}</dd></div>}{payment.closed_at && <div><dt>关闭时间</dt><dd>{formatDate(payment.closed_at)}</dd></div>}</dl>
        {transaction.state.error && !transaction.state.pending && <p className="field-error" role="alert">{transaction.state.error}</p>}
        {payment.status === 'PENDING' && <><button className="button button--primary" disabled={locked || expired || !payment.allowed_actions.includes('SIMULATE_PAY')} onClick={() => void pay()} aria-describedby="payment-step-note">{transaction.state.busy && transaction.state.pending?.kind === 'pay' ? '正在模拟付款…' : '模拟付款'}</button><p id="payment-step-note" className="workflow-muted">仅用于演示，不涉及真实资金。成功后全部关联订单进入待发货。</p>
          {payment.allowed_actions.includes('CANCEL') && <button className="button" disabled={locked || expired} onClick={() => { transaction.store.clearError(); setConfirm(true); }}>取消本次结算</button>}
        </>}
        <Link className="button" to={orderList}>查看我的订单</Link>
        <p className="workflow-muted">取消会一起关闭本支付单下全部待付款店铺订单，商品不会自动放回购物车。</p>
      </aside></div>
      {confirm && <CancelPaymentConfirm payment={payment} onClose={() => setConfirm(false)} onConfirm={() => void cancel()} />}
    </>}
  </BuyerWorkflow>;
}
