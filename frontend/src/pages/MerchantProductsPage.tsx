import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { merchantAvailable, merchantStoreName } from '../api/merchant.ts';
import { merchantProductsGateway } from '../api/merchantProduct.ts';
import { BuyerWorkflow } from '../components/BuyerWorkflow.tsx';
import { useCommerce } from '../components/CommerceContext.ts';
import { CommerceError, formatDate } from '../lib/commerce.ts';
import { formatMoney } from '../lib/catalog.ts';
import { merchantProductParams, merchantProductStatuses, readMerchantProductQuery } from '../lib/merchantProduct.ts';
import type { MerchantProductPage, MerchantProductQuery } from '../types/merchantProduct.ts';

function Cover({ src }: { src: string | null }) {
  const [failed, setFailed] = useState(false);
  return <span className="merchant-product-cover">{src && !failed ? <img src={src} alt="" width="56" height="56" onError={() => setFailed(true)} /> : <span>暂无图片</span>}</span>;
}
export function MerchantProductsPage() {
  const [params, setParams] = useSearchParams(), { state } = useCommerce();
  const query = readMerchantProductQuery(params), key = JSON.stringify(query);
  const [keyword, setKeyword] = useState(query.keyword), [reload, setReload] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null), retry = useRef<HTMLButtonElement>(null), focusAfterRead = useRef<string | null>(null);
  const [result, setResult] = useState<{ key: string; status: 'loading' | 'ready' | 'error'; page?: MerchantProductPage; error?: string; forbidden?: boolean }>({ key, status: 'loading' });
  useEffect(() => { setKeyword(query.keyword); }, [query.keyword]);
  useEffect(() => { if (focusAfterRead.current !== key) focusAfterRead.current = null; }, [key]);
  useEffect(() => {
    let current = true; setResult({ key, status: 'loading' });
    void merchantProductsGateway.products(JSON.parse(key)).then(page => { if (current) setResult({ key, status: 'ready', page }); })
      .catch(error => { if (current) setResult({ key, status: 'error', error: error instanceof Error ? error.message : '本店商品读取失败。', forbidden: error instanceof CommerceError && error.code === 'FORBIDDEN' }); });
    return () => { current = false; };
  }, [key, reload, state.revision]);
  useEffect(() => {
    if (result.key === key && result.status !== 'loading' && focusAfterRead.current === key) {
      focusAfterRead.current = null; (result.status === 'error' ? retry.current ?? heading.current : heading.current)?.focus({ preventScroll: true });
    }
  }, [result, key]);
  function update(patch: Partial<MerchantProductQuery>, focus = false) {
    const next = { ...query, ...patch, page: patch.page ?? 1 };
    focusAfterRead.current = focus ? JSON.stringify(next) : null;
    setParams(merchantProductParams(next));
  }
  function search(event: FormEvent) { event.preventDefault(); update({ keyword: keyword.trim() }); }
  function refresh() { focusAfterRead.current = key; setReload(n => n + 1); }
  function clear() { setKeyword(''); update({ keyword: '', sale_status: '' }); }
  const loading = result.key !== key || result.status === 'loading', page = result.key === key && result.status === 'ready' ? result.page : undefined;
  const filtered = !!query.keyword || !!query.sale_status, outOfRange = !!page && page.total > 0 && !page.items.length;
  return <BuyerWorkflow title="商品管理" subtitle={merchantAvailable ? `${merchantStoreName} · 查看本店商品与可售库存。` : '查看本店商品与可售库存。'}>
    <nav className="merchant-section-nav" aria-label="商家管理导航"><Link to="/merchant/products" aria-current="page">店铺商品</Link><Link to="/merchant/orders">店铺订单</Link></nav>
    {merchantAvailable && <><p className="workflow-muted">当前为固定演示店铺。展示价用于商品展示，交易按具体规格计价；可售库存已扣除模拟订单占用。</p>
      <section className="order-tools" aria-label="店铺商品筛选"><nav className="sort-row" aria-label="店铺商品状态">
        {([['', '全部'], ...Object.entries(merchantProductStatuses)] as [MerchantProductQuery['sale_status'], string][]).map(([sale_status, label]) => <button key={sale_status} aria-pressed={query.sale_status === sale_status} onClick={() => update({ sale_status })}>{label}</button>)}
      </nav><form className="order-search" onSubmit={search}><label htmlFor="merchant-product-keyword">商品名称</label><input id="merchant-product-keyword" value={keyword} maxLength={120} onChange={e => setKeyword(e.target.value)} placeholder="搜索本店商品名称" />
        <button className="button" type="submit">查询本店商品</button><button className="text-button" type="button" onClick={clear}>清空筛选</button>
      </form><button className="button" disabled={loading} onClick={refresh}>刷新本店商品</button></section></>}
    <section aria-label="本店商品管理列表" aria-busy={loading}>
      {loading && <p role="status">正在读取本店商品…</p>}
      {result.key === key && result.status === 'error' && <div className="cart-error" role="alert"><h2 ref={heading} tabIndex={-1}>{!merchantAvailable ? '商家商品接口暂不可用' : result.forbidden ? '没有店铺商品查看权限' : '暂时无法读取本店商品'}</h2><p>{result.error}</p>{merchantAvailable && <button ref={retry} className="button" onClick={refresh}>重新读取本店商品</button>}</div>}
      {page && <><h2 ref={heading} tabIndex={-1} className="merchant-products-count">共 {page.total} 件本店商品</h2>
        {page.items.length ? <div className="merchant-table-scroll" tabIndex={0} role="region" aria-label="本店商品表格，可横向滚动"><table className="merchant-product-table"><caption className="sr-only">本店商品状态、展示价及可售库存</caption><thead><tr><th scope="col">商品</th><th scope="col">状态</th><th scope="col">展示价</th><th scope="col">规格与库存</th><th scope="col">更新时间</th></tr></thead><tbody>{page.items.map(product => <tr key={product.product_id}>
          <th scope="row"><div className="merchant-product-identity"><Cover key={product.cover_image} src={product.cover_image} /><div><strong>{product.title?.trim() || '未命名商品'}</strong><small>编号 {product.product_id}</small></div></div></th>
          <td><span>{merchantProductStatuses[product.sale_status]}</span>{product.platform_status === 'RESTRICTED' && <small className="merchant-restriction">平台限制售卖</small>}</td>
          <td>{product.display_price === null ? <span className="workflow-muted">待完善</span> : <>¥{formatMoney(product.display_price)}</>}</td>
          <td><span>{product.sku_count} 个规格</span><small>可售 {product.available_stock_total} 件</small>{product.sku_count > 0 && product.available_stock_total === 0 && <small className="merchant-restriction">已售罄</small>}</td>
          <td><time dateTime={product.updated_at}>{formatDate(product.updated_at)}</time></td>
        </tr>)}</tbody></table></div> : <div className="empty-state" role="status"><h3>{outOfRange ? '当前页没有本店商品' : filtered ? '没有符合条件的本店商品' : '本店还没有商品'}</h3><p>{outOfRange ? '已有商品，请返回第一页继续查看。' : filtered ? '试试其他商品名称或状态。' : '保存商品资料后，会在这里显示。'}</p>{outOfRange ? <button className="button" onClick={() => update({ page: 1 }, true)}>返回第一页</button> : filtered && <button className="button" onClick={clear}>清空商品筛选</button>}</div>}
        {(query.page > 1 || page.has_more) && <nav className="pagination" aria-label="店铺商品分页"><button className="button" disabled={query.page === 1} onClick={() => update({ page: query.page - 1 }, true)}>上一页</button><span>第 {query.page} 页</span><button className="button" disabled={!page.has_more} onClick={() => update({ page: query.page + 1 }, true)}>下一页</button></nav>}
      </>}
    </section>
  </BuyerWorkflow>;
}
