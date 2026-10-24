import type { ProductCard as Product } from '../types/catalog.ts';
import { formatMoney, prototypeUrl } from '../lib/catalog.ts';
export function ProductCard({ product }: { product: Product }) {
  const target = prototypeUrl('detail', { detailId: product.product_id });
  const soldOut = product.stock_status === 'SOLD_OUT';
  return <article className="product-card">
    <a className="product-image" href={target} target="_blank" rel="noopener noreferrer" aria-label={`${product.name}，在新标签页查看详情原型`}>
      {product.cover_image ? <img src={product.cover_image} alt={product.name} loading="lazy" width="480" height="480" /> : <span>暂无商品图片</span>}
    </a>
    <a className="store-link" href={prototypeUrl('store', { storeName: product.store.name })} target="_blank" rel="noopener noreferrer" title="在新标签页查看店铺原型">{product.store.name}</a>
    <h3><a href={target} target="_blank" rel="noopener noreferrer">{product.name}</a></h3>
    {soldOut && <p className="product-stock-status">已售罄 · 价格仅供参考</p>}
    <div className="product-bottom"><span className="product-price"><span className="currency">¥</span>{formatMoney(product.display_price)}{!soldOut && product.display_price_source === 'AUTO' && product.min_price !== product.max_price && <small>起</small>}</span>
      <a className="button product-action" href={target} target="_blank" rel="noopener noreferrer" title="在新标签页查看商品详情原型">查看详情</a>
    </div>
  </article>;
}
