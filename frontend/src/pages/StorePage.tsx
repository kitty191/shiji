import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { getCategories, getStore, getStoreProducts, usesMockData } from '../api/catalog.ts';
import { ApiError } from '../api/client.ts';
import { Header } from '../components/Header.tsx';
import { CatalogFilters } from '../components/CatalogFilters.tsx';
import { FloatingTools, useRailState } from '../components/FloatingTools.tsx';
import { ProductCard } from '../components/ProductCard.tsx';
import { changeQuery, prototypeUrl, queryParams, readQuery } from '../lib/catalog.ts';
import { buyerReturnPath, storePath } from '../lib/product.ts';
import { useBuyerPosition } from '../lib/browsePosition.ts';
import type { CatalogQuery, Category, ProductPage, PublicStore } from '../types/catalog.ts';

function unavailable(error: unknown): boolean {
  return error instanceof ApiError && ['NOT_FOUND', 'STORE_DISABLED'].includes(error.code);
}

function StoreLogo({ store }: { store: PublicStore }) {
  const [failed, setFailed] = useState(false);
  return <span className="store-symbol" aria-hidden="true">{store.logo_url && !failed
    ? <img src={store.logo_url} alt="" width="64" height="64" onError={() => setFailed(true)} />
    : Array.from(store.name)[0] || '店'}</span>;
}

export function StorePage() {
  const { storeId = '' } = useParams(), [params, setParams] = useSearchParams(), navigate = useNavigate(), location = useLocation();
  const key = params.toString(), query = readQuery(params), requestKey = JSON.stringify([storeId, key]);
  const returnPath = buyerReturnPath(params.get('return_to')), [collapsed, setCollapsed] = useRailState();
  const [storeReload, setStoreReload] = useState(0), [reload, setReload] = useState(0), [categories, setCategories] = useState<Category[]>([]);
  const heading = useRef<HTMLHeadingElement>(null), retry = useRef<HTMLButtonElement>(null), focusAfterStoreRead = useRef<string | null>(null);
  const listHeading = useRef<HTMLHeadingElement>(null), listRetry = useRef<HTMLButtonElement>(null), focusAfterListRead = useRef<string | null>(null);
  const attachedFeed = useRef<{ key: string; reload: number } | null>(null);
  const [profile, setProfile] = useState<{ id: string; status: 'loading' | 'ready' | 'error'; store?: PublicStore; error?: string; missing?: boolean }>({ id: storeId, status: 'loading' });
  const [result, setResult] = useState<{ key: string; status: 'loading' | 'ready' | 'error'; page?: ProductPage; error?: string; feedExpired?: boolean }>({ key: '', status: 'loading' });
  const storeReady = profile.id === storeId && profile.status === 'ready';
  const ready = storeReady && result.key === requestKey && result.status === 'ready';
  useBuyerPosition(ready);
  useEffect(() => { focusAfterStoreRead.current = null; focusAfterListRead.current = null; }, [storeId]);
  useEffect(() => { if (focusAfterListRead.current !== requestKey) focusAfterListRead.current = null; }, [requestKey]);
  useEffect(() => {
    const controller = new AbortController(); setProfile({ id: storeId, status: 'loading' });
    void getStore(storeId, controller.signal).then(store => { if (!controller.signal.aborted) setProfile({ id: storeId, status: 'ready', store }); })
      .catch(error => { if (!controller.signal.aborted) setProfile({ id: storeId, status: 'error', error: error instanceof Error ? error.message : '店铺加载失败，请稍后重试。', missing: unavailable(error) }); });
    return () => controller.abort();
  }, [storeId, storeReload]);
  useEffect(() => {
    if (!storeReady) return;
    const attached = attachedFeed.current; attachedFeed.current = null;
    if (attached?.key === requestKey && attached.reload === reload) return;
    const controller = new AbortController(), requestQuery = readQuery(new URLSearchParams(key));
    setResult({ key: requestKey, status: 'loading' });
    Promise.all([getCategories(controller.signal), getStoreProducts(storeId, requestQuery, controller.signal)])
      .then(([nextCategories, page]) => {
        if (controller.signal.aborted) return;
        const nextPath = storePath(storeId, returnPath, { ...requestQuery, feed_token: page.feed_token || undefined });
        const nextParams = new URLSearchParams(nextPath.split('?')[1]);
        const nextKey = nextParams.toString(), nextRequestKey = JSON.stringify([storeId, nextKey]);
        if (focusAfterListRead.current === requestKey) focusAfterListRead.current = nextRequestKey;
        setCategories(nextCategories); setResult({ key: nextRequestKey, status: 'ready', page });
        if (nextKey !== key) {
          attachedFeed.current = { key: nextRequestKey, reload };
          setParams(nextParams, { replace: true, preventScrollReset: true, flushSync: true });
        }
      }).catch(async error => {
        if (controller.signal.aborted) return;
        if (unavailable(error)) {
          try {
            const latest = await getStore(storeId, controller.signal);
            if (controller.signal.aborted) return;
            setProfile({ id: storeId, status: 'ready', store: latest });
          } catch (profileError) {
            if (controller.signal.aborted) return;
            if (focusAfterListRead.current === requestKey) focusAfterStoreRead.current = storeId;
            focusAfterListRead.current = null;
            setProfile({ id: storeId, status: 'error', error: profileError instanceof Error ? profileError.message : '店铺加载失败，请稍后重试。', missing: unavailable(profileError) });
            return;
          }
        }
        setResult({ key: requestKey, status: 'error', error: error instanceof Error ? error.message : '本店商品加载失败，请稍后重试。', feedExpired: error instanceof ApiError && error.code === 'FEED_EXPIRED' });
      });
    return () => controller.abort();
  }, [storeId, key, reload, storeReady]);
  useEffect(() => {
    if (profile.id === storeId && profile.status !== 'loading' && focusAfterStoreRead.current === storeId) {
      focusAfterStoreRead.current = null; (profile.status === 'error' ? retry.current ?? heading.current : heading.current)?.focus({ preventScroll: true });
    }
  }, [profile, storeId]);
  useEffect(() => {
    if (result.key === requestKey && result.status !== 'loading' && focusAfterListRead.current === requestKey) {
      focusAfterListRead.current = null; (result.status === 'error' ? listRetry.current ?? listHeading.current : listHeading.current)?.focus({ preventScroll: true });
    }
  }, [result, requestKey]);
  function update(patch: Partial<Omit<CatalogQuery, 'feed_token'>>) { focusAfterListRead.current = null; navigate(storePath(storeId, returnPath, changeQuery(query, patch)), { flushSync: true }); }
  function clear() { focusAfterListRead.current = null; navigate(storePath(storeId, returnPath), { flushSync: true }); }
  function retryProducts() {
    focusAfterListRead.current = requestKey;
    if (result.feedExpired) {
      const target = storePath(storeId, returnPath, { ...query, page: 1, feed_token: undefined });
      if (target !== `${location.pathname}${location.search}`) {
        focusAfterListRead.current = JSON.stringify([storeId, new URLSearchParams(target.split('?')[1]).toString()]);
        navigate(target, { flushSync: true }); return;
      }
    }
    setReload(value => value + 1);
  }
  const status = profile.id === storeId ? profile.status : 'loading', store = storeReady ? profile.store : undefined, page = ready ? result.page : undefined;
  const listLoading = result.key !== requestKey || result.status === 'loading';
  const active = !!query.keyword || !!query.category_id || query.min_price !== undefined || query.max_price !== undefined;
  const outOfRange = !!page && query.page > 1 && page.total > 0 && !page.items.length;
  return <div className="site-shell">
    <div className="preview-note"><span>店铺预览 · {usesMockData ? '模拟数据' : 'API 数据'}</span><a href={prototypeUrl('buyer')} target="_blank" rel="noopener noreferrer">查看完整交互原型 ↗</a></div>
    <Header keyword={query.keyword} onSearch={keyword => update({ keyword })} storeSearch={{ name: store?.name, onSearchAll: keyword => navigate(`/buyer?${queryParams({ ...readQuery(new URLSearchParams()), keyword })}`) }} />
    <main id="main-content" className={`catalog-page store-page ${collapsed ? 'rail-collapsed' : ''}`}>
      <nav className="detail-breadcrumb" aria-label="店铺导航"><Link to={returnPath} state={{ restoreCatalog: true }}>‹ 返回商城</Link><span>店铺主页</span></nav>
      {status === 'loading' && <div className="detail-loading" role="status">正在加载店铺…</div>}
      {status === 'error' && <section className="empty-state" role="alert"><h1 ref={heading} tabIndex={-1}>{profile.missing ? '店铺不存在或暂不可见' : '暂时无法加载店铺'}</h1><p>{profile.error}</p>{!profile.missing && <button ref={retry} className="button" onClick={() => { focusAfterStoreRead.current = storeId; setStoreReload(value => value + 1); }}>重新加载店铺</button>}<Link className="button" to={returnPath}>返回商城</Link></section>}
      {store && <>
        <section className="store-banner" aria-label="店铺信息"><StoreLogo key={`${store.store_id}|${store.logo_url}`} store={store} /><div className="store-copy"><h1 ref={heading} tabIndex={-1}>{store.name}</h1><p>{store.description || '发现实用的日常好物。'}</p></div></section>
        <CatalogFilters query={query} categories={categories} onChange={update} onClear={clear} />
        <section aria-label="本店商品列表" aria-busy={listLoading}>
          <div className="store-products-heading"><h2 ref={listHeading} tabIndex={-1}>本店商品</h2>{page && <p>共 {page.total} 件商品</p>}</div>
          {listLoading && <div className="product-grid skeleton-grid" role="status" aria-label="正在加载本店商品">{Array.from({ length: 8 }, (_, index) => <div className="skeleton-card" key={index}><div /><span /><span /></div>)}</div>}
          {result.key === requestKey && result.status === 'error' && <div className="empty-state" role="alert"><h2>{result.feedExpired ? '本店商品列表已更新' : '暂时无法加载本店商品'}</h2><p>{result.error}</p><button ref={listRetry} className="button" onClick={retryProducts}>{result.feedExpired ? '刷新本店商品列表' : '重新加载本店商品'}</button></div>}
          {page && <>{page.items.length ? <div className="product-grid">{page.items.map(product => <ProductCard key={product.product_id} product={product} />)}</div> : <div className="empty-state" role="status"><h2>{outOfRange ? '当前页没有本店商品' : active ? '本店没有符合条件的商品' : '本店暂时没有在售商品'}</h2><p>{outOfRange ? '已有商品，请返回第一页继续浏览。' : active ? '试试其他关键词，或放宽筛选条件。' : '可以返回商城看看其他好物。'}</p>{outOfRange ? <button className="button" onClick={() => update({ page: 1 })}>返回第一页</button> : active && <button className="button" onClick={clear}>清空本店筛选</button>}</div>}
            {(query.page > 1 || page.has_more) && <nav className="pagination" aria-label="本店商品分页"><button className="button" disabled={query.page === 1} onClick={() => update({ page: query.page - 1 })}>上一页</button><span>第 {query.page} 页</span><button className="button" disabled={!page.has_more} onClick={() => update({ page: query.page + 1 })}>下一页</button></nav>}
          </>}
        </section>
      </>}
      <p className="catalog-note">店铺与商品资料均为虚构演示数据。</p>
    </main><FloatingTools collapsed={collapsed} onCollapse={setCollapsed} />
  </div>;
}
