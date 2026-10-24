import { useCart } from './CartContext.ts';

export function CartFeedback() {
  const { state, store } = useCart();
  return <>
    {state.notice && <p className="cart-notice" role="status">{state.notice}</p>}
    {(state.error || state.retryPending) && <div className="cart-error" role="alert"><p>{state.error || '上次加购结果仍待确认。'}</p><button className="button" disabled={state.adding || state.status === 'loading'} onClick={() => void store.retry().catch(() => undefined)}>{state.retryPending ? '确认上次加购' : '重新加载购物车'}</button></div>}
    {state.status === 'loading' && <p className="cart-loading-copy" role="status">正在更新购物车…</p>}
  </>;
}
