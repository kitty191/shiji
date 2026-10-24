import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getCategories, getProducts, usesMockData } from '../api/catalog.ts';
import { ApiError } from '../api/client.ts';
import type { CatalogQuery, Category, ProductPage, Sort } from '../types/catalog.ts';
import { changeQuery, formatMoney, priceToCents, prototypeUrl, queryParams, readQuery } from '../lib/catalog.ts';
import { Header } from '../components/Header.tsx';
import { Icon } from '../components/Icon.tsx';
import { ProductCard } from '../components/ProductCard.tsx';
import { FloatingTools, useRailState } from '../components/FloatingTools.tsx';
import { useBuyerPosition } from '../lib/browsePosition.ts';

export function BuyerHome() {
  const [params, setParams] = useSearchParams();
  const key = params.toString(), query = readQuery(params);
  const priceKey = queryParams({ ...query, feed_token: undefined }).toString();
  const attachedFeed = useRef<{ key: string; reload: number } | null>(null);
  const [categories, setCategories] = useState<Category[]>([]), [page, setPage] = useState<ProductPage | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading'), [error, setError] = useState('');
  const [feedExpired, setFeedExpired] = useState(false);
  const [reload, setReload] = useState(0), [minimum, setMinimum] = useState(''), [maximum, setMaximum] = useState(''), [priceError, setPriceError] = useState('');
  const [collapsed, setCollapsed] = useRailState();
  useBuyerPosition(status === 'ready');
  useEffect(() => { setMinimum(query.min_price === undefined ? '' : String(query.min_price / 100)); setMaximum(query.max_price === undefined ? '' : String(query.max_price / 100)); setPriceError(''); }, [priceKey]);
  useEffect(() => {
    // Attaching the returned token to this history entry reuses the response just loaded.
    const attached = attachedFeed.current;
    attachedFeed.current = null;
    if (attached?.key === key && attached.reload === reload) return;
    const controller = new AbortController(); setStatus('loading'); setError(''); setFeedExpired(false);
    Promise.all([getCategories(controller.signal), getProducts(readQuery(new URLSearchParams(key)), controller.signal)])
      .then(([nextCategories, nextPage]) => {
        if (controller.signal.aborted) return;
        setCategories(nextCategories); setPage(nextPage); setStatus('ready');
        const nextParams = new URLSearchParams(key);
        if (nextPage.feed_token) nextParams.set('feed_token', nextPage.feed_token);
        else nextParams.delete('feed_token');
        const nextKey = nextParams.toString();
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
  function applyPrice(event: FormEvent) {
    event.preventDefault();
    try {
      const min_price = priceToCents(minimum), max_price = priceToCents(maximum);
      if (min_price !== undefined && max_price !== undefined && min_price > max_price) throw new Error('最低价不能高于最高价。');
      setPriceError(''); update({ min_price, max_price });
    } catch (reason) { setPriceError(reason instanceof Error ? reason.message : '请检查价格。'); }
  }
  const active = !!query.keyword || !!query.category_id || query.min_price !== undefined || query.max_price !== undefined;
  const sorts: [Sort, string][] = [['default', '综合'], ['price_asc', '价格 ↑'], ['price_desc', '价格 ↓'], ['newest', '最新上架']];
  return <div className="site-shell">
    <div className="preview-note"><span>前端第 1 批 · 买家首页 · {usesMockData ? '模拟数据' : 'API 数据'}</span><a href={prototypeUrl('buyer')} target="_blank" rel="noopener noreferrer">查看完整交互原型 ↗</a></div>
    <Header keyword={query.keyword} onSearch={keyword => update({ keyword })} />
    <main id="main-content" className={`catalog-page ${collapsed ? 'rail-collapsed' : ''}`}>
      <section className="hero"><h1>小预算，也能淘到好东西。</h1><p>数码配件 · 居家日用 · 户外小物</p></section>
      <section className="catalog-tools" aria-label="筛选与排序">
        <div className="filter-row">
          <label className="category-picker"><span className="sr-only">商品分类</span><select aria-label="商品分类" value={query.category_id} onChange={event => update({ category_id: event.target.value })}><option value="">全部分类</option>{query.category_id && !categories.some(category => category.category_id === query.category_id) && <option value={query.category_id}>已选分类</option>}{categories.map(category => <option key={category.category_id} value={category.category_id}>{category.name}</option>)}</select><Icon name="chevron" /></label>
          <form className="price-filter" onSubmit={applyPrice} aria-label="价格区间">
            <label><span aria-hidden="true">¥</span><input aria-label="最低价，单位元" inputMode="decimal" value={minimum} maxLength={12} placeholder="最低价" onChange={event => setMinimum(event.target.value)} aria-describedby={priceError ? 'price-error' : undefined} /></label><span className="price-dash" aria-hidden="true">–</span>
            <label><span aria-hidden="true">¥</span><input aria-label="最高价，单位元" inputMode="decimal" value={maximum} maxLength={12} placeholder="最高价" onChange={event => setMaximum(event.target.value)} aria-describedby={priceError ? 'price-error' : undefined} /></label>
            <button className="button" type="submit">应用</button><button className="text-button" type="button" onClick={() => { setMinimum(''); setMaximum(''); setPriceError(''); update({ min_price: undefined, max_price: undefined }); }}>重置</button>
          </form>
        </div>
        {priceError && <p id="price-error" className="field-error" role="alert">{priceError}</p>}
        {active && <div className="filter-summary" aria-label="已应用的筛选条件">
          {query.keyword && <button onClick={() => update({ keyword: '' })}>关键词：{query.keyword} <Icon name="close" /></button>}
          {query.category_id && <button onClick={() => update({ category_id: '' })}>分类：{categories.find(category => category.category_id === query.category_id)?.name || '所选分类'} <Icon name="close" /></button>}
          {(query.min_price !== undefined || query.max_price !== undefined) && <button onClick={() => update({ min_price: undefined, max_price: undefined })}>价格：{query.min_price === undefined ? '不限' : `¥${formatMoney(query.min_price)}`} – {query.max_price === undefined ? '不限' : `¥${formatMoney(query.max_price)}`} <Icon name="close" /></button>}
          <button className="text-button" onClick={() => setParams(new URLSearchParams())}>清空条件</button>
        </div>}
        <nav className="sort-row" aria-label="商品排序">{sorts.map(([value, label]) => <button key={value} aria-pressed={query.sort === value} onClick={() => update({ sort: value })}>{label}</button>)}</nav>
      </section>
      <section aria-label="商品列表" aria-busy={status === 'loading'}>
        {status === 'loading' && <div className="product-grid skeleton-grid" role="status" aria-label="正在加载商品">{Array.from({ length: 8 }, (_, index) => <div className="skeleton-card" key={index}><div /><span /><span /></div>)}</div>}
        {status === 'error' && <div className="empty-state" role="alert"><h2>{feedExpired ? '商品列表已更新' : '暂时没有加载成功'}</h2><p>{error}</p><button className="button" onClick={retryProducts}>{feedExpired ? '刷新商品列表' : '重新加载'}</button></div>}
        {status === 'ready' && page && <>{page.items.length ? <div className="product-grid">{page.items.map(product => <ProductCard key={product.product_id} product={product} />)}</div> : <div className="empty-state" role="status"><h2>暂时没有符合条件的商品</h2><p>试试其他关键词，或放宽筛选条件。</p><button className="button" onClick={() => setParams(new URLSearchParams())}>清空筛选</button></div>}
          {(query.page > 1 || page.has_more) && <nav className="pagination" aria-label="商品分页"><button className="button" disabled={query.page === 1} onClick={() => update({ page: query.page - 1 })}>上一页</button><span>第 {query.page} 页</span><button className="button" disabled={!page.has_more} onClick={() => update({ page: query.page + 1 })}>下一页</button></nav>}
        </>}
      </section>
      <p className="catalog-note">原创 AI 演示商品图 · 商品、店铺与交易资料均为虚构。</p>
    </main>
    <FloatingTools collapsed={collapsed} onCollapse={setCollapsed} />
  </div>;
}
