import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getCategories, getProducts, usesMockData } from '../api/catalog.ts';
import { ApiError } from '../api/client.ts';
import type { CatalogQuery, Category, ProductPage } from '../types/catalog.ts';
import { changeQuery, prototypeUrl, queryParams, readQuery } from '../lib/catalog.ts';
import { Header } from '../components/Header.tsx';
import { CatalogFilters } from '../components/CatalogFilters.tsx';
import { ProductCard } from '../components/ProductCard.tsx';
import { FloatingTools, useRailState } from '../components/FloatingTools.tsx';
import { useBuyerPosition } from '../lib/browsePosition.ts';

export function BuyerHome() {
  const [params, setParams] = useSearchParams();
  const key = params.toString(), query = readQuery(params);
  const attachedFeed = useRef<{ key: string; reload: number } | null>(null);
  const [categories, setCategories] = useState<Category[]>([]), [page, setPage] = useState<ProductPage | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading'), [error, setError] = useState('');
  const [feedExpired, setFeedExpired] = useState(false);
  const [reload, setReload] = useState(0);
  const [collapsed, setCollapsed] = useRailState();
  useBuyerPosition(status === 'ready' && loadedKey === key);
  useEffect(() => {
    // Attaching the returned token to this history entry reuses the response just loaded.
    const attached = attachedFeed.current;
    attachedFeed.current = null;
    if (attached?.key === key && attached.reload === reload) return;
    const controller = new AbortController(); setStatus('loading'); setLoadedKey(null); setError(''); setFeedExpired(false);
    Promise.all([getCategories(controller.signal), getProducts(readQuery(new URLSearchParams(key)), controller.signal)])
      .then(([nextCategories, nextPage]) => {
        if (controller.signal.aborted) return;
        const nextParams = new URLSearchParams(key);
        if (nextPage.feed_token) nextParams.set('feed_token', nextPage.feed_token);
        else nextParams.delete('feed_token');
        const nextKey = nextParams.toString();
        setCategories(nextCategories); setPage(nextPage); setLoadedKey(nextKey); setStatus('ready');
        if (nextKey !== key) {
          attachedFeed.current = { key: nextKey, reload };
          setParams(nextParams, { replace: true, preventScrollReset: true });
        }
      })
      .catch(reason => {
        if (controller.signal.aborted) return;
        setError(reason instanceof ApiError ? reason.message : '加载失败，请稍后重试。');
        setFeedExpired(reason instanceof ApiError && reason.code === 'FEED_EXPIRED'); setStatus('error');
      });
    return () => controller.abort();
  }, [key, reload]);
  function update(patch: Partial<Omit<CatalogQuery, 'feed_token'>>) { setParams(queryParams(changeQuery(query, patch))); }
  function retryProducts() {
    if (feedExpired) {
      const nextParams = queryParams({ ...query, page: 1, feed_token: undefined });
      if (nextParams.toString() !== key) { setParams(nextParams); return; }
    }
    setReload(value => value + 1);
  }
  const outOfRange = !!page && query.page > 1 && page.total > 0 && !page.items.length;
  return <div className="site-shell">
    <div className="preview-note"><span>买家商城预览 · {usesMockData ? '模拟数据' : 'API 数据'}</span><a href={prototypeUrl('buyer')} target="_blank" rel="noopener noreferrer">查看完整交互原型 ↗</a></div>
    <Header keyword={query.keyword} onSearch={keyword => update({ keyword })} />
    <main id="main-content" className={`catalog-page ${collapsed ? 'rail-collapsed' : ''}`}>
      <section className="hero"><h1>小预算，也能淘到好东西。</h1><p>数码配件 · 居家日用 · 户外小物</p></section>
      <CatalogFilters query={query} categories={categories} onChange={update} onClear={() => setParams(new URLSearchParams())} />
      <section aria-label="商品列表" aria-busy={status === 'loading'}>
        {status === 'loading' && <div className="product-grid skeleton-grid" role="status" aria-label="正在加载商品">{Array.from({ length: 8 }, (_, index) => <div className="skeleton-card" key={index}><div /><span /><span /></div>)}</div>}
        {status === 'error' && <div className="empty-state" role="alert"><h2>{feedExpired ? '商品列表已更新' : '暂时没有加载成功'}</h2><p>{error}</p><button className="button" onClick={retryProducts}>{feedExpired ? '刷新商品列表' : '重新加载'}</button></div>}
        {status === 'ready' && page && <>{page.items.length ? <div className="product-grid">{page.items.map(product => <ProductCard key={product.product_id} product={product} />)}</div> : <div className="empty-state" role="status"><h2>{outOfRange ? '当前页没有商品' : '暂时没有符合条件的商品'}</h2><p>{outOfRange ? '已有商品，请返回第一页继续浏览。' : '试试其他关键词，或放宽筛选条件。'}</p>{outOfRange ? <button className="button" onClick={() => update({ page: 1 })}>返回第一页</button> : <button className="button" onClick={() => setParams(new URLSearchParams())}>清空筛选</button>}</div>}
          {(query.page > 1 || page.has_more) && <nav className="pagination" aria-label="商品分页"><button className="button" disabled={query.page === 1} onClick={() => update({ page: query.page - 1 })}>上一页</button><span>第 {query.page} 页</span><button className="button" disabled={!page.has_more} onClick={() => update({ page: query.page + 1 })}>下一页</button></nav>}
        </>}
      </section>
      <p className="catalog-note">原创 AI 演示商品图 · 商品、店铺与交易资料均为虚构。</p>
    </main>
    <FloatingTools collapsed={collapsed} onCollapse={setCollapsed} />
  </div>;
}
