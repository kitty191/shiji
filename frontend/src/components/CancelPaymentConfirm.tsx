import { useEffect, useRef } from 'react';
import type { PaymentGroup } from '../types/commerce.ts';
import { formatMoney } from '../lib/catalog.ts';

export function CancelPaymentConfirm({ payment, onClose, onConfirm }: { payment: PaymentGroup; onClose: () => void; onConfirm: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current, previous = document.activeElement, overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; element?.showModal();
    return () => { element?.close(); document.body.style.overflow = overflow; if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  return <dialog ref={dialog} className="cart-delete-dialog address-leave-dialog" aria-labelledby="cancel-orders-title" onCancel={event => { event.preventDefault(); onClose(); }}>
    <h2 id="cancel-orders-title">取消本次待付款结算？</h2><p>将一起关闭以下 {payment.shop_orders.length} 笔店铺订单，释放占用的模拟库存；商品不会自动放回购物车。</p>
    <ul className="cancel-order-list">{payment.shop_orders.map(o => <li key={o.order_id}>{o.store_name} · {o.order_no} · ¥{formatMoney(o.total_amount)}</li>)}</ul>
    <p>整次结算金额 ¥{formatMoney(payment.total_amount)}</p><div><button className="button" autoFocus onClick={onClose}>保留订单</button><button className="button button--primary" onClick={onConfirm}>确认取消本次结算</button></div>
  </dialog>;
}
