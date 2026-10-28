import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { merchantAvailable, merchantGateway } from '../api/merchant.ts';
import { BuyerWorkflow, TransactionLines } from '../components/BuyerWorkflow.tsx';
import { ShippingDialog } from '../components/ShippingDialog.tsx';
import { useCommerce } from '../components/CommerceContext.ts';
import { CommerceError, formatDate, orderStatuses } from '../lib/commerce.ts';
import { formatMoney } from '../lib/catalog.ts';
import { merchantOrdersReturnPath } from '../lib/merchant.ts';
import type { MerchantOrderDetail } from '../types/merchant.ts';

export function MerchantOrderDetailPage() {
  const { orderId = '' } = useParams(),
    [params] = useSearchParams(),
    backTo = merchantOrdersReturnPath(params.get('return_to')),
    transaction = useCommerce(),
    { state } = transaction;
  const [shipping, setShipping] = useState<MerchantOrderDetail | null>(null),
    [notice, setNotice] = useState<{ id: string; text: string } | null>(null);
  const locked = state.busy || !!state.pending;
  const [reload, setReload] = useState(0),
    heading = useRef<HTMLHeadingElement>(null),
    retry = useRef<HTMLButtonElement>(null),
    focusAfterRead = useRef(false);
  const [result, setResult] = useState<{
    id: string;
    status: 'loading' | 'ready' | 'error';
    order?: MerchantOrderDetail;
    error?: string;
    missing?: boolean;
    forbidden?: boolean;
  }>({ id: orderId, status: 'loading' });
  useEffect(() => {
    let current = true;
    setResult({ id: orderId, status: 'loading' });
    void merchantGateway
      .order(orderId)
      .then((order) => {
        if (current) setResult({ id: orderId, status: 'ready', order });
      })
      .catch((error) => {
        if (current)
          setResult({
            id: orderId,
            status: 'error',
            error: error instanceof Error ? error.message : '本店订单详情读取失败。',
            missing: error instanceof CommerceError && error.code === 'NOT_FOUND',
            forbidden: error instanceof CommerceError && error.code === 'FORBIDDEN',
          });
      });
    return () => {
      current = false;
    };
  }, [orderId, reload, state.revision]);
  useEffect(() => {
    if (result.id === orderId && result.status !== 'loading' && focusAfterRead.current) {
      focusAfterRead.current = false;
      (result.status === 'error' ? (retry.current ?? heading.current) : heading.current)?.focus({
        preventScroll: true,
      });
    }
  }, [result, orderId]);
  function refresh() {
    focusAfterRead.current = true;
    setReload((n) => n + 1);
  }
  const order = result.id === orderId && result.status === 'ready' ? result.order : undefined;
  const paymentLabel =
    order?.payment_status === 'PAID'
      ? '已付款'
      : order?.payment_status === 'CLOSED'
        ? '已关闭'
        : '待付款';
  return (
    <BuyerWorkflow
      title="本店订单详情"
      subtitle="仅展示本店订单，商品、金额与收货信息以成交快照为准。"
      backTo={backTo}
      backLabel="返回店铺订单"
    >
      {notice?.id === orderId && (
        <p className="cart-notice" role="status">
          {notice.text}
        </p>
      )}
      {result.id !== orderId || result.status === 'loading' ? (
        <p role="status">正在读取本店订单详情…</p>
      ) : result.status === 'error' ? (
        <section className="empty-state" role="alert">
          <h2 ref={heading} tabIndex={-1}>
            {!merchantAvailable
              ? '商家订单接口暂不可用'
              : result.forbidden
                ? '没有店铺订单查看权限'
                : result.missing
                  ? '没有找到本店订单'
                  : '暂时无法读取本店订单详情'}
          </h2>
          <p>{result.error}</p>
          {!result.missing && merchantAvailable && (
            <button ref={retry} className="button" onClick={refresh}>
              重新读取本店订单详情
            </button>
          )}
          <Link className="button" to={backTo}>
            返回店铺订单
          </Link>
        </section>
      ) : (
        order && (
          <>
            <section className="workflow-panel order-state-panel" aria-label="本店订单状态">
              <div>
                <h2 ref={heading} tabIndex={-1}>
                  {orderStatuses[order.status]}
                </h2>
                <p>店铺订单号 {order.order_no}</p>
              </div>
              <button className="button" disabled={locked} onClick={refresh}>
                刷新本店订单详情
              </button>
              <p>
                {order.status === 'PENDING_PAYMENT'
                  ? '等待买家完成统一付款。'
                  : order.status === 'PENDING_SHIPMENT'
                    ? '买家已付款，可以为本店整笔订单填写演示物流。'
                    : order.status === 'PENDING_RECEIPT'
                      ? '本店订单已发货，等待买家确认收货。'
                      : order.status === 'COMPLETED'
                        ? '本店订单已完成。'
                        : order.close_reason === 'TIMEOUT'
                          ? '付款超时，本店订单已关闭。'
                          : '买家取消了本次结算，本店订单已关闭。'}
              </p>
            </section>
            <div className="checkout-layout">
              <div className="checkout-content">
                <section className="workflow-panel" aria-label="本店订单收货信息">
                  <h2>收货信息</h2>
                  <p>
                    {order.address.recipient_name}　{order.address.recipient_phone}
                  </p>
                  <p>
                    {order.address.province} {order.address.city} {order.address.district}{' '}
                    {order.address.detail_address}
                  </p>
                  <p className="workflow-muted">收货信息保留成交时的快照。</p>
                </section>
                <section className="workflow-panel" aria-label="本店成交商品">
                  <h2>{order.store_name}</h2>
                  <TransactionLines items={order.items} />
                  <p className="transaction-group-total">
                    商品 ¥{formatMoney(order.goods_amount)} + 运费 ¥
                    {formatMoney(order.shipping_amount)} = ¥{formatMoney(order.total_amount)}
                  </p>
                </section>
                <section className="workflow-panel" aria-label="本店订单时间与物流">
                  <h2>订单信息</h2>
                  <dl className="order-metadata">
                    <div>
                      <dt>创建时间</dt>
                      <dd>{formatDate(order.created_at)}</dd>
                    </div>
                    {order.paid_at && (
                      <div>
                        <dt>付款时间</dt>
                        <dd>{formatDate(order.paid_at)}</dd>
                      </div>
                    )}
                    {order.shipped_at && (
                      <div>
                        <dt>发货时间</dt>
                        <dd>{formatDate(order.shipped_at)}</dd>
                      </div>
                    )}
                    {order.received_at && (
                      <div>
                        <dt>收货时间</dt>
                        <dd>{formatDate(order.received_at)}</dd>
                      </div>
                    )}
                    {order.closed_at && (
                      <div>
                        <dt>关闭时间</dt>
                        <dd>{formatDate(order.closed_at)}</dd>
                      </div>
                    )}
                    <div>
                      <dt>物流信息</dt>
                      <dd>
                        {order.shipping_carrier && order.tracking_no
                          ? `${order.shipping_carrier} · ${order.tracking_no}`
                          : '暂无物流信息'}
                      </dd>
                    </div>
                  </dl>
                </section>
              </div>
              <aside className="workflow-panel checkout-summary" aria-label="本店订单汇总">
                <h2>本店订单金额</h2>
                <strong className="checkout-total">¥{formatMoney(order.total_amount)}</strong>
                <dl className="order-metadata">
                  <div>
                    <dt>商品金额</dt>
                    <dd>¥{formatMoney(order.goods_amount)}</dd>
                  </div>
                  <div>
                    <dt>运费</dt>
                    <dd>¥{formatMoney(order.shipping_amount)}</dd>
                  </div>
                  <div>
                    <dt>付款状态</dt>
                    <dd>{paymentLabel}</dd>
                  </div>
                </dl>
                {state.error && !state.pending && !shipping && (
                  <p className="field-error" role="alert">
                    {state.error}
                  </p>
                )}
                {order.status === 'PENDING_SHIPMENT' &&
                  order.payment_status === 'PAID' &&
                  order.allowed_actions.includes('SHIP') && (
                    <button
                      className="button button--primary"
                      disabled={locked}
                      onClick={() => {
                        transaction.store.clearError();
                        setNotice(null);
                        setShipping(order);
                      }}
                    >
                      模拟发货
                    </button>
                  )}
                <Link className="button" to={backTo}>
                  返回店铺订单
                </Link>
                <p className="workflow-muted">本店整笔订单一次发货；已发货后不能修改物流信息。</p>
              </aside>
            </div>
          </>
        )
      )}
      {shipping && (
        <ShippingDialog
          key={shipping.order_id}
          order={shipping}
          onClose={() => setShipping(null)}
          onSuccess={(shipped) => {
            setShipping(null);
            setNotice({ id: shipped.order_id, text: '模拟发货成功，本店订单已进入待收货。' });
            focusAfterRead.current = true;
          }}
          onUnknown={() => setShipping(null)}
          onStale={() => {
            transaction.store.clearError();
            setShipping(null);
            refresh();
          }}
        />
      )}
    </BuyerWorkflow>
  );
}
