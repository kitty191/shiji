import { useEffect, useRef } from 'react';
import { useCart } from './CartContext.ts';

export function CartDeleteConfirm({
  ids,
  onClose,
}: {
  ids: readonly string[];
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const { store } = useCart();
  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    element?.showModal();
    const place = () => {
      if (!element || !(previous instanceof HTMLElement)) return;
      const anchor = previous.getBoundingClientRect(),
        box = element.getBoundingClientRect();
      element.style.left = `${Math.max(12, Math.min(anchor.left, window.innerWidth - box.width - 12))}px`;
      element.style.top = `${Math.max(12, Math.min(anchor.bottom + box.height + 12 <= window.innerHeight ? anchor.bottom + 12 : anchor.top - box.height - 12, window.innerHeight - box.height - 12))}px`;
    };
    place();
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('resize', place);
      element?.close();
      document.body.style.overflow = oldOverflow;
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="cart-delete-dialog"
      aria-labelledby="cart-delete-heading"
      onCancel={onClose}
    >
      <h2 id="cart-delete-heading">删除已选商品？</h2>
      <p>将删除 {ids.length} 项商品，成功后 8 秒内可撤销本次删除。</p>
      <div>
        <button className="button" autoFocus onClick={onClose}>
          取消
        </button>
        <button
          className="button button--primary"
          onClick={() => {
            onClose();
            void store.remove(ids).catch(() => undefined);
          }}
        >
          确认删除
        </button>
      </div>
    </dialog>
  );
}
