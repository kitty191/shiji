import { useEffect, useRef } from 'react';
import type { BuyerOrder } from '../types/commerce.ts';
import { formatMoney } from '../lib/catalog.ts';

export function ReceiptConfirm({ order, onClose, onConfirm }: { order: BuyerOrder; onClose: () => void; onConfirm: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current, previous = document.activeElement, overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; element?.showModal();
    return () => { element?.close(); document.body.style.overflow = overflow; if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  return <dialog ref={dialog} className="cart-delete-dialog address-leave-dialog" aria-labelledby="receipt-title" onCancel={event => { event.preventDefault(); onClose(); }} onKeyDown={event => {
    if (event.key !== 'Tab') return;
    const buttons = dialog.current?.querySelectorAll('button');
    if (!buttons?.length) return;
    const first = buttons[0], last = buttons[buttons.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }}>
    <h2 id="receipt-title">确认已收到本店全部商品？</h2>
    <p>{order.store_name} · {order.order_no}</p>
    <ul className="cancel-order-list">{order.items.map(item => <li key={item.order_item_id}>{item.name} · {item.spec_values.map(spec => spec.value).join(' / ') || '默认规格'} × {item.quantity}</li>)}</ul>
    <p>本店订单金额 ¥{formatMoney(order.total_amount)}</p><p>{order.shipping_carrier} · {order.tracking_no}</p>
    <p>请在收到本店全部商品后确认。确认后本订单将完成，不能撤销；同次结算的其他店铺订单保持原状态。当前为本机模拟收货。</p>
    <div><button className="button" autoFocus onClick={onClose}>暂不确认</button><button className="button button--primary" onClick={onConfirm}>确认收到商品</button></div>
  </dialog>;
}
