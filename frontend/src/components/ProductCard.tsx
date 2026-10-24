import type { ProductCard as Product } from '../types/catalog.ts';
import { Link, useLocation } from 'react-router-dom';
import { formatMoney, prototypeUrl } from '../lib/catalog.ts';
import { rememberBuyerPosition } from '../lib/browsePosition.ts';
export function ProductCard({ product }: { product: Product }) {
  const location = useLocation();
  const returnTo = location.pathname === '/buyer' ? `${location.pathname}${location.search}` : new URLSearchParams(location.search).get('return_to') || '/buyer';
  const target = `/products/${encodeURIComponent(product.product_id)}?${new URLSearchParams({ return_to: returnTo })}`;
  const state = { fromBuyer: location.pathname === '/buyer' };
  const remember = () => { if (location.pathname === '/buyer') rememberBuyerPosition(returnTo); };
  const soldOut = product.stock_status === 'SOLD_OUT';
  return <article className="product-card">
    <Link className="product-image" to={target} state={state} onClick={remember} aria-label={`查看${product.name}详情`}>
      {product.cover_image ? <img src={product.cover_image} alt={product.name} loading="lazy" width="480" height="480" /> : <span>暂无商品图片</span>}
    </Link>
    <a className="store-link" href={prototypeUrl('store', { storeName: product.store.name })} target="_blank" rel="noopener noreferrer" title="在新标签页查看店铺原型">{product.store.name}</a>
    <h3><Link to={target} state={state} onClick={remember}>{product.name}</Link></h3>
    {soldOut && <p className="product-stock-status">已售罄 · 价格仅供参考</p>}
    <div className="product-bottom"><span className="product-price"><span className="currency">¥</span>{formatMoney(product.display_price)}{!soldOut && product.display_price_source === 'AUTO' && product.min_price !== product.max_price && <small>起</small>}</span>
      <Link className="button product-action" to={target} state={state} onClick={remember}>查看详情</Link>
    </div>
  </article>;
}
