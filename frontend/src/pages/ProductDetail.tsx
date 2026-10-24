import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { getProductView, getRecommendations, usesMockData } from '../api/catalog.ts';
import { ApiError } from '../api/client.ts';
import { Header } from '../components/Header.tsx';
import { FloatingTools, useRailState } from '../components/FloatingTools.tsx';
import { ProductGallery } from '../components/ProductGallery.tsx';
import { ProductCard } from '../components/ProductCard.tsx';
import { useCart } from '../components/CartContext.ts';
import { cartAvailable } from '../api/cart.ts';
import { formatMoney, prototypeUrl, queryParams, readQuery } from '../lib/catalog.ts';
import { buyerContextPath, productReturnPath, completeSku, galleryFrames, inStock, normalizeProductParams, productQuantity, quantityLimit, selectedSku, skuFrame, skuLabel } from '../lib/product.ts';
import type { OffSaleView, ProductCard as Card, ProductDetail as Product, ProductView } from '../types/catalog.ts';

function OffSale({ product }: { product: OffSaleView }) {
  const [items, setItems] = useState<Card[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setStatus('loading');
    getRecommendations(product.product_id, controller.signal).then(result => {
      if (!controller.signal.aborted) { setItems(result.items); setStatus('ready'); }
    }).catch(() => { if (!controller.signal.aborted) setStatus('error'); });
    return () => controller.abort();
  }, [product.product_id, reload]);
  return <>
    <section className="empty-state off-sale-state" aria-label="下架商品">
      <h1>商品已下架</h1><p>这件商品暂时无法购买，可以看看店里的其他好物。</p>
      <a className="button" href={prototypeUrl('store', { storeName: product.store.name })} target="_blank" rel="noopener noreferrer">进入{product.store.name} ↗</a>
    </section>
    <section className="recommendations" aria-label="其他商品推荐"><h2>看看其他好物</h2>
      {status === 'loading' && <p role="status">正在加载推荐商品…</p>}
      {status === 'error' && <div role="alert"><p>推荐商品暂时未加载成功。</p><button className="button" onClick={() => setReload(value => value + 1)}>重新加载推荐</button></div>}
      {status === 'ready' && (items.length ? <div className="product-grid">{items.map(item => <ProductCard key={item.product_id} product={item} />)}</div> : <p>暂时没有其他合适的商品。</p>)}
    </section>
  </>;
}

function ProductContent({ product }: { product: Product }) {
  const cart = useCart();
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const key = params.toString();
  const normalized = normalizeProductParams(product, params), normalizedKey = normalized.toString();
  const sku = selectedSku(product, normalized.get('sku_id'));
  const frames = galleryFrames(product);
  const activeFrame = params.get('image_id') || skuFrame(product, sku) || frames[0]?.image_id;
  const quantity = productQuantity(normalized.get('quantity'), sku);
  const limit = quantityLimit(sku);
  const available = !!sku && inStock(sku);
  const allSoldOut = !product.skus.some(item => completeSku(product, item) && inStock(item));
  useEffect(() => {
    if (key !== normalizedKey) setParams(new URLSearchParams(normalizedKey), { replace: true, preventScrollReset: true, state: location.state });
  }, [key, normalizedKey, setParams, location.state]);
  function update(patch: Record<string, string | null>) {
    const next = new URLSearchParams(normalizedKey);
    Object.entries(patch).forEach(([key, value]) => value === null ? next.delete(key) : next.set(key, value));
    setParams(next, { replace: true, preventScrollReset: true, state: location.state });
  }
  const label = sku ? skuLabel(product, sku) : params.has('sku_id') ? '所选规格已不可用，请重新选择。' : '请选择要查看的规格。';
  return <>
    <div className="detail-layout">
      <ProductGallery frames={frames} active={activeFrame} cover={product.cover_image} name={product.name}
        onChange={image_id => update({ image_id })} />
      <section className="detail-info" aria-label="商品资料">
        <a className="detail-store" href={prototypeUrl('store', { storeName: product.store.name })} target="_blank" rel="noopener noreferrer">{product.store.name} · 进入店铺 ↗</a>
        <h1>{product.name}</h1><p className="detail-description">{product.description}</p>
        <div className="detail-price-box"><span>{sku ? '当前规格价格' : '参考展示价'}</span>
          <p className="detail-price"><span>¥</span>{formatMoney(sku?.price ?? product.display_price)}</p>
          <p>{allSoldOut || sku && !available ? '已售罄 · 价格仅供参考' : '人民币计价'}</p>
        </div>
        <fieldset className="sku-options"><legend>选择规格</legend>
          <div>{product.skus.filter(item => completeSku(product, item)).map(item => <button key={item.sku_id}
            aria-pressed={item.sku_id === sku?.sku_id} className={!inStock(item) ? 'sku-sold-out' : undefined}
            onClick={() => { if (item.sku_id !== sku?.sku_id) update({ sku_id: item.sku_id, quantity: '1', image_id: null }); }}>
            {skuLabel(product, item)}{!inStock(item) && <small>已售罄</small>}
          </button>)}</div>
        </fieldset>
        <p className="selected-spec" role="status">{label}</p>
        <div className="detail-quantity"><span>数量</span><div className="quantity-stepper" role="group" aria-label="购买数量">
          <button aria-label="减少数量" disabled={!available || quantity <= 1} onClick={() => update({ quantity: String(quantity - 1) })}>−</button>
          <output aria-label="已选数量">{quantity}</output>
          <button aria-label="增加数量" disabled={!available || quantity >= limit} onClick={() => update({ quantity: String(quantity + 1) })}>+</button>
        </div><span className="stock-copy">{sku ? available ? `库存 ${sku.available_stock} 件` : '当前规格已售罄' : allSoldOut ? '全部规格已售罄' : '请选择规格'}{available && sku.available_stock > 99 ? ' · 单次最多 99 件' : ''}</span></div>
        <div className="detail-actions"><button className="button" disabled={!available || !cartAvailable || cart.state.adding || cart.state.retryPending} aria-describedby="purchase-note" onClick={() => {
          if (sku) void cart.store.add({ sku_id: sku.sku_id, quantity }).then(cart.show).catch(cart.show);
        }}>{cart.state.adding ? '正在加入…' : '加入购物车'}</button><button className="button button--primary" disabled aria-describedby="purchase-note">立即购买</button></div>
        <p className="detail-preview-note" id="purchase-note">{cartAvailable ? '可加入模拟购物车；购买结算暂未开放。' : '当前仅接入商品查询，购物车与购买暂不可用。'}</p>
      </section>
    </div>
    <section className="detail-attributes" aria-label="商品参数"><h2>商品资料</h2><dl>{product.attributes.map((attribute, index) => <div key={`${attribute.name}-${index}`}><dt>{attribute.name}</dt><dd>{attribute.value}</dd></div>)}</dl></section>
  </>;
}

export function ProductDetail() {
  const { productId = '' } = useParams();
  const location = useLocation(), navigate = useNavigate();
  const [params] = useSearchParams();
  const returnPath = productReturnPath(params.get('return_to'));
  const returnToCart = returnPath === '/cart' || returnPath.startsWith('/cart?');
  const keyword = readQuery(new URLSearchParams(buyerContextPath(returnPath).split('?')[1])).keyword;
  const [state, setState] = useState<{ id: string; status: 'loading' | 'ready' | 'error'; product?: ProductView; message?: string; notFound?: boolean }>({ id: productId, status: 'loading' });
  const [reload, setReload] = useState(0);
  const [collapsed, setCollapsed] = useRailState();
  useEffect(() => {
    const controller = new AbortController();
    setState({ id: productId, status: 'loading' });
    getProductView(productId, controller.signal).then(product => {
      if (!controller.signal.aborted) setState({ id: productId, status: 'ready', product });
    }).catch(error => {
      if (!controller.signal.aborted) setState({ id: productId, status: 'error', message: error instanceof Error ? error.message : '加载失败，请稍后重试。', notFound: error instanceof ApiError && error.code === 'NOT_FOUND' });
    });
    return () => controller.abort();
  }, [productId, reload]);
  const status = state.id === productId ? state.status : 'loading';
  return <div className="site-shell">
    <div className="preview-note"><span>商品详情预览 · {usesMockData ? '模拟数据' : 'API 数据'}</span><a href={prototypeUrl('buyer')} target="_blank" rel="noopener noreferrer">查看完整交互原型 ↗</a></div>
    <Header keyword={keyword} onSearch={value => navigate(`/buyer?${queryParams({ ...readQuery(new URLSearchParams()), keyword: value })}`)} />
    <main className={`catalog-page detail-page ${collapsed ? 'rail-collapsed' : ''}`} id="main-content">
      <nav className="detail-breadcrumb" aria-label="商品导航"><button className="text-button" onClick={() => (location.state?.fromBuyer || location.state?.fromCart) ? navigate(-1) : navigate(returnPath, { state: { restoreCatalog: true } })}>‹ {returnToCart ? '返回购物车' : '返回浏览位置'}</button><span>商品详情</span></nav>
      {status === 'loading' && <div className="detail-loading" role="status">正在加载商品详情…</div>}
      {status === 'error' && <section className="empty-state" role="alert"><h1>{state.notFound ? '商品不存在或暂不可见' : '暂时无法加载商品'}</h1><p>{state.message}</p>{!state.notFound && <button className="button" onClick={() => setReload(value => value + 1)}>重新加载</button>}<Link className="button" to={returnPath}>{returnToCart ? '返回购物车' : '返回商城'}</Link></section>}
      {status === 'ready' && state.product && (state.product.view_status === 'OFF_SALE' ? <OffSale key={productId} product={state.product} /> : <ProductContent key={productId} product={state.product} />)}
      <p className="catalog-note">商品、店铺与交易资料均为虚构演示数据。</p>
    </main>
    <FloatingTools collapsed={collapsed} onCollapse={setCollapsed} />
  </div>;
}
