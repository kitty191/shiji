import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { merchantAvailable, merchantGateway, merchantStoreName } from '../api/merchant.ts';
import { BuyerWorkflow, TransactionLines } from '../components/BuyerWorkflow.tsx';
import { useCommerce } from '../components/CommerceContext.ts';
import { CommerceError, formatDate, orderStatuses } from '../lib/commerce.ts';
import { formatMoney } from '../lib/catalog.ts';
import { merchantOrderParams, merchantOrderPath, readMerchantOrderQuery } from '../lib/merchant.ts';
import type { MerchantOrderPage, MerchantOrderQuery } from '../types/merchant.ts';

export function MerchantOrdersPage() {
  const [params, setParams] = useSearchParams(),
    location = useLocation(),
    { state } = useCommerce();
  const query = readMerchantOrderQuery(params),
    key = JSON.stringify(query);
  const [orderNo, setOrderNo] = useState(query.order_no),
    [keyword, setKeyword] = useState(query.keyword),
    [reload, setReload] = useState(0);
  const retry = useRef<HTMLButtonElement>(null),
    heading = useRef<HTMLHeadingElement>(null),
    focusAfterRead = useRef<string | null>(null);
  const [result, setResult] = useState<{
    key: string;
    status: 'loading' | 'ready' | 'error';
    page?: MerchantOrderPage;
    error?: string;
    forbidden?: boolean;
  }>({ key, status: 'loading' });
  useEffect(() => {
    setOrderNo(query.order_no);
    setKeyword(query.keyword);
  }, [query.order_no, query.keyword]);
  useEffect(() => {
    if (focusAfterRead.current !== key) focusAfterRead.current = null;
  }, [key]);
  useEffect(() => {
    let current = true;
    setResult({ key, status: 'loading' });
    void merchantGateway
      .orders(JSON.parse(key))
      .then((page) => {
        if (current) setResult({ key, status: 'ready', page });
      })
      .catch((error) => {
        if (current)
          setResult({
            key,
            status: 'error',
            error: error instanceof Error ? error.message : '本店订单读取失败。',
            forbidden: error instanceof CommerceError && error.code === 'FORBIDDEN',
          });
      });
    return () => {
      current = false;
    };
  }, [key, reload, state.revision]);
  useEffect(() => {
    if (result.key === key && result.status !== 'loading' && focusAfterRead.current === key) {
      focusAfterRead.current = null;
      (result.status === 'error' ? (retry.current ?? heading.current) : heading.current)?.focus({
        preventScroll: true,
      });
    }
  }, [result, key]);
  function update(patch: Partial<MerchantOrderQuery>) {
    const next = { ...query, ...patch, page: patch.page ?? 1 };
    focusAfterRead.current = JSON.stringify(next);
    setParams(merchantOrderParams(next));
  }
  function search(event: FormEvent) {
    event.preventDefault();
    update({ order_no: orderNo.trim(), keyword: keyword.trim() });
  }
  function refresh() {
    focusAfterRead.current = key;
    setReload((n) => n + 1);
  }
  const loading = result.key !== key || result.status === 'loading';
  const page = result.key === key && result.status === 'ready' ? result.page : undefined;
  return (
    <BuyerWorkflow
      title="店铺订单"
      subtitle={
        merchantAvailable ? `${merchantStoreName} · 查看本店成交记录。` : '查看本店成交记录。'
      }
    >
      {merchantAvailable && (
        <>
          <p className="workflow-muted">
            当前为固定演示店铺，可进入已付款、待发货订单的详情填写演示物流。
          </p>
          <section className="order-tools" aria-label="店铺订单筛选">
            <nav className="sort-row" aria-label="店铺订单状态">
              {(
                [['', '全部'], ...Object.entries(orderStatuses)] as [
                  MerchantOrderQuery['status'],
                  string,
                ][]
              ).map(([status, label]) => (
                <button
                  key={status}
                  aria-pressed={query.status === status}
                  onClick={() => update({ status })}
                >
                  {label}
                </button>
              ))}
            </nav>
            <form className="order-search" onSubmit={search}>
              <label htmlFor="merchant-order-number">店铺订单号</label>
              <input
                id="merchant-order-number"
                value={orderNo}
                maxLength={100}
                onChange={(e) => setOrderNo(e.target.value)}
                placeholder="输入本店订单号"
              />
              <label htmlFor="merchant-order-keyword">成交商品</label>
              <input
                id="merchant-order-keyword"
                value={keyword}
                maxLength={120}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="搜索成交时的商品标题"
              />
              <button className="button" type="submit">
                查询本店订单
              </button>
              <button
                className="text-button"
                type="button"
                onClick={() => {
                  setOrderNo('');
                  setKeyword('');
                  update({ status: '', order_no: '', keyword: '' });
                }}
              >
                清空筛选
              </button>
            </form>
            <button className="button" disabled={loading} onClick={refresh}>
              刷新本店订单
            </button>
          </section>
        </>
      )}
      <section aria-label="本店订单列表" aria-busy={loading}>
        {loading && <p role="status">正在读取本店订单…</p>}
        {result.key === key && result.status === 'error' && (
          <div className="cart-error" role="alert">
            <h2 ref={heading} tabIndex={-1}>
              {!merchantAvailable
                ? '商家订单接口暂不可用'
                : result.forbidden
                  ? '没有店铺订单查看权限'
                  : '暂时无法读取本店订单'}
            </h2>
            <p>{result.error}</p>
            {merchantAvailable && (
              <button ref={retry} className="button" onClick={refresh}>
                重新读取本店订单
              </button>
            )}
          </div>
        )}
        {page && (
          <>
            <h2 ref={heading} tabIndex={-1} className="workflow-muted">
              共 {page.total} 笔本店订单
            </h2>
            {page.items.length ? (
              page.items.map((order) => (
                <article className="workflow-panel order-card" key={order.order_id}>
                  <div className="order-card-heading">
                    <div>
                      <h2>{order.store_name}</h2>
                      <p>订单号 {order.order_no}</p>
                      <p>{formatDate(order.created_at)}</p>
                    </div>
                    <span className={`order-status status-${order.status.toLowerCase()}`}>
                      {orderStatuses[order.status]}
                    </span>
                  </div>
                  <TransactionLines items={order.items} />
                  <footer>
                    <span>
                      本店订单合计 <strong>¥{formatMoney(order.total_amount)}</strong>
                    </span>
                    <Link
                      className="button"
                      to={merchantOrderPath(
                        order.order_id,
                        `${location.pathname}${location.search}`,
                      )}
                    >
                      查看本店订单详情<span className="sr-only">：{order.order_no}</span>
                    </Link>
                  </footer>
                </article>
              ))
            ) : (
              <div className="empty-state">
                <h2>
                  {page.total > 0
                    ? '当前页没有本店订单'
                    : query.status || query.order_no || query.keyword
                      ? '没有符合条件的本店订单'
                      : '本店还没有订单'}
                </h2>
                <p>
                  {page.total > 0
                    ? '已有本店订单，请返回第一页继续查看。'
                    : query.status || query.order_no || query.keyword
                      ? '试试其他状态、订单号或成交商品标题。'
                      : '本店商品产生模拟订单后，会在这里显示。'}
                </p>
                {page.total > 0 && (
                  <button className="button" onClick={() => update({ page: 1 })}>
                    返回第一页
                  </button>
                )}
              </div>
            )}
            {(query.page > 1 || page.has_more) && (
              <nav className="pagination" aria-label="店铺订单分页">
                <button
                  className="button"
                  disabled={query.page === 1}
                  onClick={() => update({ page: query.page - 1 })}
                >
                  上一页
                </button>
                <span>第 {query.page} 页</span>
                <button
                  className="button"
                  disabled={!page.has_more}
                  onClick={() => update({ page: query.page + 1 })}
                >
                  下一页
                </button>
              </nav>
            )}
          </>
        )}
      </section>
    </BuyerWorkflow>
  );
}
