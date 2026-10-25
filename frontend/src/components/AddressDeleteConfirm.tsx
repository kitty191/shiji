import { useEffect, useRef } from 'react';
import type { Address } from '../types/address.ts';

export function AddressDeleteConfirm({ address, nextDefault, onClose, onConfirm }: { address: Address; nextDefault?: Address; onClose: () => void; onConfirm: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current, previous = document.activeElement;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    element?.showModal();
    return () => {
      element?.close(); document.body.style.overflow = oldOverflow;
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  return <dialog ref={dialog} className="cart-delete-dialog address-leave-dialog address-delete-dialog"
    aria-labelledby="address-delete-title" aria-describedby="address-delete-effect address-delete-availability"
    onKeyDown={event => {
      if (event.key !== 'Tab') return;
      const buttons = dialog.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
      const first = buttons?.[0], last = buttons?.[buttons.length - 1];
      if (first && last && document.activeElement === (event.shiftKey ? first : last)) {
        event.preventDefault(); (event.shiftKey ? last : first).focus();
      }
    }}
    onCancel={event => { event.preventDefault(); onClose(); }}>
    <h2 id="address-delete-title">删除收货地址？</h2>
    <section className="address-delete-summary" aria-label="待删除的收货地址">
      <strong>{address.recipient_name}</strong>
      <p>{address.recipient_phone}</p>
      <p>{address.province} {address.city} {address.district} {address.detail_address}</p>
    </section>
    <p id="address-delete-effect">{!address.is_default ? '删除后，当前默认地址保持不变。' : nextDefault
      ? `这是默认地址。删除后，将自动把剩余列表第一条（${nextDefault.recipient_name}）设为默认。`
      : '这是唯一一条收货地址。删除后，地址簿将为空，可重新新增地址。'}</p>
    <p id="address-delete-availability" className="address-delete-availability">删除后无法恢复，已创建订单的收货信息不受影响。</p>
    <div><button className="button" autoFocus onClick={onClose}>取消</button><button className="button button--primary" onClick={onConfirm}>确认删除</button></div>
  </dialog>;
}
