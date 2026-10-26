import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { commerceAvailable, commerceGateway } from '../api/commerce.ts';
import { BuyerWorkflow, TransactionLines } from '../components/BuyerWorkflow.tsx';
import { useCommerce } from '../components/CommerceContext.ts';
import { formatDate, orderStatuses, readOrderQuery } from '../lib/commerce.ts';
import { formatMoney } from '../lib/catalog.ts';
import type { OrderPage, OrderStatus } from '../types/commerce.ts';

export function OrdersPage() {
  const [params, setParams] = useSearchParams(), location = useLocation(), { state } = useCommerce();
  const query = readOrderQuery(params), key = JSON.stringify(query), [draft, setDraft] = useState(query.order_no), [reload, setReload] = useState(0);
  const [result, setResult] = useState<{ key: string; status: 'loading' | 'ready' | 'error'; page?: OrderPage; error?: string }>({ key, status: 'loading' });
  useEffect(() => setDraft(query.order_no), [query.order_no]);
  useEffect(() => {
    let current = true; setResult({ key, status: 'loading' });
    void commerceGateway.orders(JSON.parse(key)).then(page => { if (current) setResult({ key, status: 'ready', page }); })
      .catch(error => { if (current) setResult({ key, status: 'error', error: error instanceof Error ? error.message : '订单加载失败。' }); });
    return () => { current = false; };
  }, [key, reload, state.revision]);
  function update(patch: { status?: OrderStatus | ''; order_no?: string; page?: number }) {
    const next = { ...query, ...patch, page: patch.page ?? 1 }, p = new URLSearchParams();
    if (next.status) p.set('status', next.status); if (next.order_no) p.set('order_no', next.order_no); if (next.page > 1) p.set('page', String(next.page)); setParams(p);
  }
  function search(event: FormEvent) { event.preventDefault(); update({ order_no: draft.trim() }); }
  const page = result.key === key ? result.page : undefined, loading = result.key !== key || result.status === 'loading';
  const outOfRange = !!page && query.page > 1 && page.total > 0 && !page.items.length;
  return <BuyerWorkflow title="我的订单" subtitle="按店铺查看订单与当前进度。">
    {commerceAvailable && <section className="order-tools" aria-label="订单筛选"><nav className="sort-row" aria-label="订单状态">
      {([['', '全部'], ...Object.entries(orderStatuses)] as [OrderStatus | '', string][]).map(([status, label]) => <button key={status} aria-pressed={query.status === status} onClick={() => update({ status })}>{label}</button>)}
    </nav><form onSubmit={search} className="order-search"><label htmlFor="order-number">店铺订单号</label><input id="order-number" value={draft} maxLength={100} onChange={e => setDraft(e.target.value)} placeholder="输入订单号" /><button className="button" type="submit">查询订单</button><button className="text-button" type="button" onClick={() => { setDraft(''); setParams(new URLSearchParams()); }}>清空筛选</button></form>
      <button className="button" disabled={loading} onClick={() => setReload(n => n + 1)}>刷新订单</button></section>}
    <section aria-label="订单列表" aria-busy={loading}>
      {loading && <p role="status">正在读取订单…</p>}
      {result.key === key && result.status === 'error' && <div className="cart-error" role="alert"><p>{result.error}</p>{commerceAvailable && <button className="button" onClick={() => setReload(n => n + 1)}>重新加载订单</button>}</div>}
      {!loading && result.status === 'ready' && page && (page.items.length ? <>
        <p className="workflow-muted">共 {page.total} 笔店铺订单</p>
        {page.items.map(order => <article className="workflow-panel order-card" key={order.order_id}>
          <div className="order-card-heading"><div><h2>{order.store_name}</h2><p>订单号 {order.order_no}</p><p>{formatDate(order.created_at)}</p></div><span className={`order-status status-${order.status.toLowerCase()}`}>{orderStatuses[order.status]}</span></div>
          <TransactionLines items={order.items} />
          <footer><span>订单合计 <strong>¥{formatMoney(order.total_amount)}</strong></span><Link className="button" to={`/orders/${encodeURIComponent(order.order_id)}?${new URLSearchParams({ return_to: `${location.pathname}${location.search}` })}`}>查看订单详情<span className="sr-only">：{order.order_no}</span></Link></footer>
        </article>)}
      </> : <div className="empty-state"><h2>{outOfRange ? '当前页没有订单' : query.status || query.order_no ? '没有符合条件的订单' : '还没有订单'}</h2><p>{outOfRange ? '已有订单，请返回第一页继续查看。' : query.status || query.order_no ? '试试其他状态或订单号。' : '挑选喜欢的商品后，前往结算提交订单。'}</p>{outOfRange ? <button className="button" onClick={() => update({ page: 1 })}>返回第一页</button> : <Link className="button" to="/buyer">去逛逛</Link>}</div>)}
      {page && (query.page > 1 || page.has_more) && <nav className="pagination" aria-label="订单分页"><button className="button" disabled={query.page === 1 || loading} onClick={() => update({ page: query.page - 1 })}>上一页</button><span>第 {query.page} 页</span><button className="button" disabled={!page.has_more || loading} onClick={() => update({ page: query.page + 1 })}>下一页</button></nav>}
    </section>
  </BuyerWorkflow>;
}
