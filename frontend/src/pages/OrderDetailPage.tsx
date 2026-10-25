import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { commerceAvailable, commerceGateway } from '../api/commerce.ts';
import { BuyerWorkflow, TransactionLines, remainingTime, useClock } from '../components/BuyerWorkflow.tsx';
import { useCommerce } from '../components/CommerceContext.ts';
import { useCart } from '../components/CartContext.ts';
import { CommerceError, formatDate, ordersReturnPath, orderStatuses, paymentPath } from '../lib/commerce.ts';
import { formatMoney } from '../lib/catalog.ts';
import { CancelPaymentConfirm } from '../components/CancelPaymentConfirm.tsx';
import type { BuyerOrder, PaymentGroup } from '../types/commerce.ts';

export function OrderDetailPage() {
  const location = useLocation();
  const { orderId = '' } = useParams(), [params] = useSearchParams(), backTo = ordersReturnPath(params.get('return_to'));
  const transaction = useCommerce(), cart = useCart(), now = useClock(), heading = useRef<HTMLHeadingElement>(null);
  const focusAfterReload = useRef(false);
  const [reload, setReload] = useState(0), [confirm, setConfirm] = useState(false), [notice, setNotice] = useState('');
  const [result, setResult] = useState<{ id: string; status: 'loading' | 'ready' | 'error'; order?: BuyerOrder; payment?: PaymentGroup; error?: string; missing?: boolean }>({ id: orderId, status: 'loading' });
  useEffect(() => {
    let current = true; setConfirm(false); setResult({ id: orderId, status: 'loading' });
    void commerceGateway.order(orderId).then(async order => {
      const payment = await commerceGateway.payment(order.payment_group_id);
      if (payment.status !== order.payment_status) {
        order = { ...order, payment_status: payment.status, status: payment.shop_orders.find(o => o.order_id === order.order_id)!.status, paid_at: payment.paid_at, closed_at: payment.closed_at, close_reason: payment.close_reason, allowed_actions: payment.allowed_actions };
      }
      return { order, payment };
    }).then(data => { if (current) setResult({ id: orderId, status: 'ready', ...data }); })
      .catch(error => { if (current) setResult({ id: orderId, status: 'error', error: error instanceof Error ? error.message : '订单加载失败。', missing: error instanceof CommerceError && error.code === 'NOT_FOUND' }); });
    return () => { current = false; };
  }, [orderId, reload, transaction.state.revision]);
  const order = result.id === orderId && result.status === 'ready' ? result.order : undefined, payment = order ? result.payment : undefined;
  useEffect(() => {
    if (!order || order.payment_status !== 'PENDING') return;
    const timer = setTimeout(() => setReload(n => n + 1), Math.max(0, Date.parse(order.payment_expires_at) - Date.now()) + 50);
    return () => clearTimeout(timer);
  }, [order?.payment_status, order?.payment_expires_at]);
  useEffect(() => setNotice(''), [orderId]);
  useEffect(() => { if (order && focusAfterReload.current) { focusAfterReload.current = false; heading.current?.focus({ preventScroll: true }); } }, [order]);
  const locked = transaction.state.busy || !!transaction.state.pending;
  async function cancel() {
    if (!payment || locked) return; setConfirm(false);
    try {
      await transaction.store.cancel(payment.payment_group_id); void cart.store.load().catch(() => undefined);
      setNotice('本次结算已取消，全部关联店铺订单已关闭。'); focusAfterReload.current = true;
    } catch { /* Shared transaction state preserves failure and unknown-result recovery. */ }
  }
  return <BuyerWorkflow title="订单详情" subtitle="收货信息与商品金额以提交时的快照为准。" backTo={backTo} backLabel="返回我的订单">
    {result.id !== orderId || result.status === 'loading' ? <p role="status">正在读取订单详情…</p> : result.status === 'error' ? <div className="empty-state" role="alert"><h2>{result.missing ? '没有找到这笔订单' : '暂时无法读取订单'}</h2><p>{result.error}</p>{!result.missing && commerceAvailable && <button className="button" onClick={() => setReload(n => n + 1)}>重新加载订单详情</button>}</div> : order && payment && <>
      {notice && <p className="cart-notice" role="status">{notice}</p>}
      <section className="workflow-panel order-state-panel"><div><h2 ref={heading} tabIndex={-1}>{orderStatuses[order.status]}</h2><p>店铺订单号 {order.order_no}</p></div><button className="button" disabled={locked} onClick={() => setReload(n => n + 1)}>刷新订单状态</button>
        {order.payment_status === 'PENDING' && <p>付款剩余时间 {remainingTime(order.payment_expires_at, now)}；请进入付款页面完成模拟付款。</p>}
        {order.close_reason && <p>{order.close_reason === 'TIMEOUT' ? '付款超时，结算已关闭。' : '买家已取消本次结算。'}</p>}
      </section>
      <div className="checkout-layout"><div className="checkout-content">
        <section className="workflow-panel" aria-label="订单收货信息"><h2>收货信息</h2><p>{order.address.recipient_name}　{order.address.recipient_phone}</p><p>{order.address.province} {order.address.city} {order.address.district} {order.address.detail_address}</p><p className="workflow-muted">修改或删除地址簿记录，不会改变本订单的收货快照。</p></section>
        <section className="workflow-panel" aria-label="订单商品"><h2>{order.store_name}</h2><TransactionLines items={order.items} /><p className="transaction-group-total">商品 ¥{formatMoney(order.goods_amount)} + 运费 ¥{formatMoney(order.shipping_amount)} = ¥{formatMoney(order.total_amount)}</p></section>
        <section className="workflow-panel" aria-label="订单时间与物流"><h2>订单信息</h2><dl className="order-metadata"><div><dt>创建时间</dt><dd>{formatDate(order.created_at)}</dd></div><div><dt>付款截止</dt><dd>{formatDate(order.payment_expires_at)}</dd></div>{order.paid_at && <div><dt>付款时间</dt><dd>{formatDate(order.paid_at)}</dd></div>}{order.closed_at && <div><dt>关闭时间</dt><dd>{formatDate(order.closed_at)}</dd></div>}<div><dt>物流信息</dt><dd>{order.shipping_carrier && order.tracking_no ? `${order.shipping_carrier} · ${order.tracking_no}` : '暂无物流信息'}</dd></div></dl></section>
      </div><aside className="workflow-panel checkout-summary" aria-label="本次结算"><h2>本次结算</h2><p className="workflow-muted">支付单 {payment.payment_no}</p><p>共 {payment.shop_orders.length} 笔店铺订单</p><strong className="checkout-total">¥{formatMoney(payment.total_amount)}</strong>
        <ul className="payment-order-links">{payment.shop_orders.map(link => <li key={link.order_id}><Link to={`/orders/${encodeURIComponent(link.order_id)}?${new URLSearchParams({ return_to: backTo })}`} aria-current={link.order_id === order.order_id ? 'page' : undefined}>{link.store_name} · ¥{formatMoney(link.total_amount)}<span>{orderStatuses[link.status]}</span></Link></li>)}</ul>
        <Link className="button" to={paymentPath(payment.payment_group_id, `${location.pathname}${location.search}`)}>查看付款页面</Link>
        {transaction.state.error && !transaction.state.pending && <p className="field-error" role="alert">{transaction.state.error}</p>}
        {payment.status === 'PENDING' && payment.allowed_actions.includes('CANCEL') && <button className="button" disabled={locked || Date.parse(payment.expires_at) <= now} onClick={() => { transaction.store.clearError(); setConfirm(true); }}>取消本次结算</button>}
        <p className="workflow-muted">待付款仅支持取消整次结算，会关闭同一支付单下的全部店铺订单。</p>
      </aside></div>
      {confirm && <CancelPaymentConfirm payment={payment} onClose={() => setConfirm(false)} onConfirm={() => void cancel()} />}
    </>}
  </BuyerWorkflow>;
}
