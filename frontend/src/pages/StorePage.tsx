import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { getStore, getStoreProducts, usesMockData } from '../api/catalog.ts';
import { ApiError } from '../api/client.ts';
import { Header } from '../components/Header.tsx';
import { FloatingTools, useRailState } from '../components/FloatingTools.tsx';
import { ProductCard } from '../components/ProductCard.tsx';
import { prototypeUrl, queryParams, readQuery } from '../lib/catalog.ts';
import { buyerReturnPath } from '../lib/product.ts';
import { useBuyerPosition } from '../lib/browsePosition.ts';
import type { ProductPage, PublicStore } from '../types/catalog.ts';

function StoreLogo({ store }: { store: PublicStore }) {
  const [failed, setFailed] = useState(false);
  return <span className="store-symbol" aria-hidden="true">{store.logo_url && !failed
    ? <img src={store.logo_url} alt="" width="64" height="64" onError={() => setFailed(true)} />
    : Array.from(store.name)[0] || '店'}</span>;
}

export function StorePage() {
  const { storeId = '' } = useParams(), [params] = useSearchParams(), navigate = useNavigate();
  const returnPath = buyerReturnPath(params.get('return_to')), [collapsed, setCollapsed] = useRailState();
  const [reload, setReload] = useState(0), heading = useRef<HTMLHeadingElement>(null), retry = useRef<HTMLButtonElement>(null), focusAfterReload = useRef(false);
  const [result, setResult] = useState<{ id: string; status: 'loading' | 'ready' | 'error'; store?: PublicStore; page?: ProductPage; error?: string; missing?: boolean }>({ id: storeId, status: 'loading' });
  const ready = result.id === storeId && result.status === 'ready';
  useBuyerPosition(ready);
  useEffect(() => {
    const controller = new AbortController();
    setResult({ id: storeId, status: 'loading' });
    void getStore(storeId, controller.signal).then(async store => ({ store, page: await getStoreProducts(storeId, controller.signal) }))
      .then(data => { if (!controller.signal.aborted) setResult({ id: storeId, status: 'ready', ...data }); })
      .catch(error => {
        if (!controller.signal.aborted) setResult({ id: storeId, status: 'error', error: error instanceof Error ? error.message : '店铺加载失败，请稍后重试。', missing: error instanceof ApiError && ['NOT_FOUND', 'STORE_DISABLED'].includes(error.code) });
      });
    return () => controller.abort();
  }, [storeId, reload]);
  useEffect(() => {
    if (result.id === storeId && result.status !== 'loading' && focusAfterReload.current) {
      focusAfterReload.current = false; (result.status === 'error' ? retry.current ?? heading.current : heading.current)?.focus({ preventScroll: true });
    }
  }, [result, storeId]);
  const status = result.id === storeId ? result.status : 'loading', store = ready ? result.store : undefined, page = ready ? result.page : undefined;
  return <div className="site-shell">
    <div className="preview-note"><span>店铺预览 · {usesMockData ? '模拟数据' : 'API 数据'}</span><a href={prototypeUrl('buyer')} target="_blank" rel="noopener noreferrer">查看完整交互原型 ↗</a></div>
    <Header keyword={readQuery(new URLSearchParams(returnPath.split('?')[1])).keyword} onSearch={keyword => navigate(`/buyer?${queryParams({ ...readQuery(new URLSearchParams()), keyword })}`)} />
    <main id="main-content" className={`catalog-page store-page ${collapsed ? 'rail-collapsed' : ''}`}>
      <nav className="detail-breadcrumb" aria-label="店铺导航"><Link to={returnPath} state={{ restoreCatalog: true }}>‹ 返回商城</Link><span>店铺主页</span></nav>
      {status === 'loading' && <div className="detail-loading" role="status">正在加载店铺…</div>}
      {status === 'error' && <section className="empty-state" role="alert"><h1 ref={heading} tabIndex={-1}>{result.missing ? '店铺不存在或暂不可见' : '暂时无法加载店铺'}</h1><p>{result.error}</p>{!result.missing && <button ref={retry} className="button" onClick={() => { focusAfterReload.current = true; setReload(value => value + 1); }}>重新加载店铺</button>}<Link className="button" to={returnPath}>返回商城</Link></section>}
      {store && page && <>
        <section className="store-banner" aria-label="店铺信息"><StoreLogo key={`${store.store_id}|${store.logo_url}`} store={store} /><div className="store-copy"><h1 ref={heading} tabIndex={-1}>{store.name}</h1><p>{store.description || '发现实用的日常好物。'}</p></div></section>
        <section aria-label="本店商品列表"><div className="store-products-heading"><h2>本店商品</h2><p>共 {page.total} 件商品{page.has_more ? ` · 当前展示前 ${page.items.length} 件` : ''}</p></div>
          {page.items.length ? <div className="product-grid">{page.items.map(product => <ProductCard key={product.product_id} product={product} />)}</div> : <div className="empty-state" role="status"><h2>本店暂时没有在售商品</h2><p>可以返回商城看看其他好物。</p></div>}
        </section>
      </>}
      <p className="catalog-note">店铺与商品资料均为虚构演示数据。</p>
    </main><FloatingTools collapsed={collapsed} onCollapse={setCollapsed} />
  </div>;
}
