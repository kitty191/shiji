import { hasQuantityWork } from '../stores/cart.ts';
import { useCart } from './CartContext.ts';

export function CartFeedback() {
  const { state, store } = useCart();
  return (
    <>
      {state.notice && (
        <p className="cart-notice" role="status">
          {state.notice}
        </p>
      )}
      {(state.error || state.retryPending) && (
        <div className="cart-error" role="alert">
          <p>{state.error || '上次购物车操作结果仍待确认。'}</p>
          <button
            className="button"
            disabled={state.mutating || hasQuantityWork(state) || state.status === 'loading'}
            onClick={() => void store.retry().catch(() => undefined)}
          >
            {state.retryPending ? '确认上次操作' : '重新加载购物车'}
          </button>
        </div>
      )}
      {hasQuantityWork(state) && (
        <p className="cart-loading-copy" role="status">
          数量修改尚未全部确认，金额按已确认数量计算；未确认的操作可在商品项处重试。
        </p>
      )}
      {state.mutating && !state.adding && (
        <p className="cart-loading-copy" role="status">
          正在处理购物车操作…
        </p>
      )}
      {state.status === 'loading' && (
        <p className="cart-loading-copy" role="status">
          正在更新购物车…
        </p>
      )}
    </>
  );
}
