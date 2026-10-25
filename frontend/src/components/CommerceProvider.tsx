import { useState } from 'react';
import type { ReactNode } from 'react';
import { useBeforeUnload, useLocation, useNavigate } from 'react-router-dom';
import { merchantGateway } from '../api/merchant.ts';
import { merchantOrderPath, merchantOrdersReturnPath } from '../lib/merchant.ts';
import { commerceGateway } from '../api/commerce.ts';
import { paymentPath, paymentResultPath, paymentReturnPath } from '../lib/commerce.ts';
import { CommerceStore } from '../stores/commerce.ts';
import { useCart } from './CartContext.ts';
import { CommerceContext, useCommerce } from './CommerceContext.ts';

export function CommerceProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() => new CommerceStore(commerceGateway, undefined, merchantGateway));
  return <CommerceContext value={store}>{children}<TransactionRecovery /></CommerceContext>;
}
function TransactionRecovery() {
  const { store, state } = useCommerce(), cart = useCart(), navigate = useNavigate(), location = useLocation();
  const backTo = paymentReturnPath(location.pathname.startsWith('/orders') ? `${location.pathname}${location.search}` : new URLSearchParams(location.search).get('return_to'));
  useBeforeUnload(event => { if (state.pending) { event.preventDefault(); event.returnValue = ''; } });
  if (!state.pending) return null;
  return <aside className="cart-undo-notice" aria-label="交易操作提示">
    <p role={state.busy ? 'status' : 'alert'}>{state.busy ? '正在处理交易操作…' : state.error}</p>
    {!state.busy && <><p>请先确认原操作结果，再进行其他交易操作。</p><button className="button" onClick={() => {
      void store.retry().then(result => { void cart.store.load().catch(() => undefined); if ('order_id' in result) {
        const back = merchantOrdersReturnPath(location.pathname === '/merchant/orders' ? `${location.pathname}${location.search}` : new URLSearchParams(location.search).get('return_to'));
        navigate(merchantOrderPath(result.order_id, back));
      } else navigate(state.pending?.kind === 'pay' ? paymentResultPath(result.payment_group_id, backTo) : paymentPath(result.payment_group_id)); }).catch(() => undefined);
    }}>{state.pending.kind === 'submit' ? '确认上次提交结果' : state.pending.kind === 'pay' ? '确认上次付款结果' : state.pending.kind === 'ship' ? '确认上次发货结果' : '确认上次取消结果'}</button></>}
  </aside>;
}
