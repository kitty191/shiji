import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { commerceAvailable, commerceGateway } from '../api/commerce.ts';
import { BuyerWorkflow } from '../components/BuyerWorkflow.tsx';
import { useCommerce } from '../components/CommerceContext.ts';
import {
  CommerceError,
  formatDate,
  orderStatuses,
  ordersReturnPath,
  paymentPath,
  paymentReturnPath,
} from '../lib/commerce.ts';
import { formatMoney } from '../lib/catalog.ts';
import type { PaymentGroup } from '../types/commerce.ts';

// Result routes only query T03. Neither visiting nor refreshing this page performs a payment.
export function PaymentResultPage() {
  const { paymentId = '' } = useParams(),
    [params] = useSearchParams(),
    transaction = useCommerce();
  const backTo = paymentReturnPath(params.get('return_to'));
  const orderList = backTo.startsWith('/orders/')
    ? ordersReturnPath(new URLSearchParams(backTo.split('?')[1]).get('return_to'))
    : backTo;
  const heading = useRef<HTMLHeadingElement>(null),
    retryButton = useRef<HTMLButtonElement>(null),
    focusAfterRead = useRef(false),
    expiryRead = useRef('');
  const [reload, setReload] = useState(0);
  const [result, setResult] = useState<{
    id: string;
    status: 'loading' | 'ready' | 'error';
    payment?: PaymentGroup;
    error?: string;
    missing?: boolean;
  }>({ id: paymentId, status: 'loading' });
  useEffect(() => {
    let current = true;
    setResult({ id: paymentId, status: 'loading' });
    void commerceGateway
      .payment(paymentId)
      .then((payment) => {
        if (current) setResult({ id: paymentId, status: 'ready', payment });
      })
      .catch((error) => {
        if (current)
          setResult({
            id: paymentId,
            status: 'error',
            error: error instanceof Error ? error.message : '付款结果读取失败，请重试。',
            missing: error instanceof CommerceError && error.code === 'NOT_FOUND',
          });
      });
    return () => {
      current = false;
    };
  }, [paymentId, reload, transaction.state.revision]);
  const payment = result.id === paymentId && result.status === 'ready' ? result.payment : undefined;
  useEffect(() => {
    if (!payment || payment.status !== 'PENDING') return;
    const key = `${payment.payment_group_id}|${payment.expires_at}`;
    if (expiryRead.current === key) return;
    const timer = setTimeout(
      () => {
        expiryRead.current = key;
        setReload((value) => value + 1);
      },
      Math.max(0, Date.parse(payment.expires_at) - Date.now()) + 50,
    );
    return () => clearTimeout(timer);
  }, [payment?.payment_group_id, payment?.status, payment?.expires_at]);
  useEffect(() => {
    if (result.id === paymentId && result.status !== 'loading' && focusAfterRead.current) {
      focusAfterRead.current = false;
      (result.status === 'error'
        ? (retryButton.current ?? heading.current)
        : heading.current
      )?.focus({ preventScroll: true });
    }
  }, [result, paymentId]);
  function refresh() {
    focusAfterRead.current = true;
    setReload((value) => value + 1);
  }
  const locked = transaction.state.busy || !!transaction.state.pending;
  const paid = payment?.status === 'PAID';
  const description = paid
    ? '本次模拟付款已完成，各店铺将分别处理订单。'
    : payment?.status === 'CLOSED'
      ? payment.close_reason === 'TIMEOUT'
        ? '付款超时，全部关联店铺订单已关闭，模拟库存占用已释放。'
        : '本次结算已取消，全部关联店铺订单已关闭，模拟库存占用已释放。'
      : '支付单当前仍为待付款。请返回付款页面核对，结果待确认的操作请先确认原操作。';
  return (
    <BuyerWorkflow
      title="付款结果"
      subtitle="以当前支付单状态核对付款结果。"
      backTo={backTo}
      backLabel={backTo.startsWith('/orders/') ? '返回订单详情' : '返回我的订单'}
    >
      {result.id !== paymentId || result.status === 'loading' ? (
        <p role="status">正在核对付款结果…</p>
      ) : result.status === 'error' ? (
        <section className="empty-state" role="alert">
          <h2 ref={heading} tabIndex={-1}>
            {result.missing
              ? '没有找到这次结算'
              : commerceAvailable
                ? '暂时无法确认付款结果'
                : '付款结果接口暂不可用'}
          </h2>
          <p>{result.error}</p>
          {!result.missing && commerceAvailable && (
            <>
              <p>请重新读取结果，避免重复付款。</p>
              <button ref={retryButton} className="button" onClick={refresh}>
                重新读取付款结果
              </button>
            </>
          )}
          <Link className="button" to={orderList}>
            查看我的订单
          </Link>
        </section>
      ) : (
        payment && (
          <>
            <section className="workflow-panel order-state-panel" aria-label="付款结果状态">
              <div>
                <h2 ref={heading} tabIndex={-1}>
                  {paid
                    ? '模拟付款成功'
                    : payment.status === 'CLOSED'
                      ? '本次结算已关闭'
                      : '尚未完成付款'}
                </h2>
                <p>支付单号 {payment.payment_no}</p>
              </div>
              <button className="button" disabled={locked} onClick={refresh}>
                刷新付款结果
              </button>
              <p>{description}</p>
            </section>
            <div className="checkout-layout">
              <section className="checkout-content" aria-label="付款关联订单">
                <p className="workflow-muted">
                  同一支付单共 {payment.shop_orders.length} 笔店铺订单。
                </p>
                {payment.shop_orders.map((order) => (
                  <article className="workflow-panel payment-shop-order" key={order.order_id}>
                    <div className="order-card-heading">
                      <div>
                        <h2>{order.store_name}</h2>
                        <p>店铺订单号 {order.order_no}</p>
                      </div>
                      <span className={`order-status status-${order.status.toLowerCase()}`}>
                        {orderStatuses[order.status]}
                      </span>
                    </div>
                    <p>店铺合计 ¥{formatMoney(order.total_amount)}</p>
                    <Link
                      className="button"
                      to={`/orders/${encodeURIComponent(order.order_id)}?${new URLSearchParams({ return_to: orderList })}`}
                    >
                      查看订单详情<span className="sr-only">：{order.order_no}</span>
                    </Link>
                  </article>
                ))}
              </section>
              <aside className="workflow-panel checkout-summary" aria-label="付款结果汇总">
                <h2>{paid ? '已付金额' : '本次结算金额'}</h2>
                <strong className="checkout-total">¥{formatMoney(payment.total_amount)}</strong>
                <dl className="order-metadata">
                  <div>
                    <dt>创建时间</dt>
                    <dd>{formatDate(payment.created_at)}</dd>
                  </div>
                  {paid && payment.paid_at && (
                    <div>
                      <dt>付款时间</dt>
                      <dd>{formatDate(payment.paid_at)}</dd>
                    </div>
                  )}
                  {payment.status === 'PENDING' && (
                    <div>
                      <dt>付款截止</dt>
                      <dd>{formatDate(payment.expires_at)}</dd>
                    </div>
                  )}
                  {payment.closed_at && (
                    <div>
                      <dt>关闭时间</dt>
                      <dd>{formatDate(payment.closed_at)}</dd>
                    </div>
                  )}
                </dl>
                <Link className="button button--primary" to={orderList}>
                  查看我的订单
                </Link>
                {payment.status === 'PENDING' && (
                  <Link className="button" to={paymentPath(payment.payment_group_id, backTo)}>
                    返回付款页面
                  </Link>
                )}
                {paid && (
                  <Link className="button" to={paymentPath(payment.payment_group_id, backTo)}>
                    查看支付单
                  </Link>
                )}
                <Link className="button" to="/buyer">
                  继续逛商城
                </Link>
              </aside>
            </div>
          </>
        )
      )}
    </BuyerWorkflow>
  );
}
