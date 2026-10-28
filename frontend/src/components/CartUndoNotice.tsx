import { useEffect, useState } from 'react';
import { useCart } from './CartContext.ts';
import { hasQuantityWork } from '../stores/cart.ts';

export function CartUndoNotice() {
  const { state, store } = useCart();
  const [now, setNow] = useState(Date.now);
  const until = state.undo?.deletion.undo_expires_at;
  useEffect(() => {
    if (!until) return;
    const deadline = Date.parse(until);
    setNow(Date.now());
    if (deadline <= Date.now()) return;
    const timer = window.setInterval(() => {
      const time = Date.now();
      setNow(time);
      if (time >= deadline) window.clearInterval(timer);
    }, 200);
    return () => window.clearInterval(timer);
  }, [until]);
  const seconds = until ? Math.max(0, Math.min(8, Math.ceil((Date.parse(until) - now) / 1000))) : 0;
  const showUndo = !!state.undo && seconds > 0;
  const showError = !!state.error && (state.actionError || showUndo);
  if (!showUndo && !showError) return null;
  const busy = state.mutating || hasQuantityWork(state);
  return (
    <aside className="cart-undo-notice" aria-label="购物车操作提示">
      {showError && <p role="alert">{state.error}</p>}
      {showUndo && (
        <p role="status">
          已删除 {state.undo!.deletion.deleted_item_ids.length} 项，8 秒内可撤销最近一次删除。
        </p>
      )}
      <div>
        {showUndo && (
          <>
            <button
              className="button"
              disabled={busy || !store.canRestore()}
              onClick={() => void store.restore().catch(() => undefined)}
            >
              撤销删除
            </button>
            <span aria-hidden="true">剩余 {seconds} 秒</span>
          </>
        )}
        {state.retryPending && (
          <button
            className="button"
            disabled={busy}
            onClick={() => void store.retry().catch(() => undefined)}
          >
            确认上次操作
          </button>
        )}
        <button
          className="text-button"
          aria-label="关闭购物车提示"
          disabled={state.mutating || state.retryPending}
          onClick={() => {
            store.dismissUndo();
            store.dismissFeedback();
          }}
        >
          关闭
        </button>
      </div>
    </aside>
  );
}
