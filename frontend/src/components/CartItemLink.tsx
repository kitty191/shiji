import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { cartItemTarget } from '../lib/cart.ts';
import { buyerContextPath, storePath } from '../lib/product.ts';
import type { CartItem } from '../types/cart.ts';

function CartImage({ item }: { item: CartItem }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [item.image_url]);
  return (
    <span className={`cart-image ${item.image_disabled ? 'is-disabled' : ''}`}>
      {item.image_url && !failed ? (
        <img src={item.image_url} alt="" onError={() => setFailed(true)} />
      ) : (
        <span>暂无图片</span>
      )}
    </span>
  );
}
export function CartItemLink({
  item,
  storeName,
  returnTo,
  fromCart = false,
  onNavigate,
}: {
  item: CartItem;
  storeName: string;
  returnTo: string;
  fromCart?: boolean;
  onNavigate?: () => void;
}) {
  const target = cartItemTarget(item, returnTo);
  const content = (
    <>
      <CartImage item={item} />
      <span className="cart-item-copy">
        <strong>{item.name}</strong>
        <small>{item.spec_values.map((value) => value.value).join(' · ') || '默认规格'}</small>
      </span>
    </>
  );
  if (target?.type === 'product')
    return (
      <Link
        className="cart-item-link"
        onClick={onNavigate}
        to={target.to}
        state={fromCart ? { fromCart: true } : undefined}
      >
        {content}
      </Link>
    );
  if (target?.type === 'store')
    return (
      <Link
        className="cart-item-link"
        to={storePath(item.navigation.target_id!, buyerContextPath(returnTo))}
        onClick={onNavigate}
        title={`进入${storeName}原店铺`}
      >
        {content}
      </Link>
    );
  return <div className="cart-item-link">{content}</div>;
}
