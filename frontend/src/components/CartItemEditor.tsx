import { useCart } from './CartContext.ts';
import type { CartItem } from '../types/cart.ts';

export function CartItemEditor({ item }: { item: CartItem }) {
  const { state, store } = useCart();
  const edit = state.quantityEdits[item.item_id];
  const value = edit?.target ?? item.quantity;
  const label = `${item.name} ${item.spec_values.map((value) => value.value).join(' · ') || '默认规格'}`;
  const blocked =
    state.mutating || state.retryPending || state.status !== 'ready' || !!edit?.retryPending;
  const editable = item.purchase_status === 'AVAILABLE';
  const insufficient = item.purchase_status === 'INSUFFICIENT_STOCK';
  const remove = () => {
    void store.remove([item.item_id]).catch(() => undefined);
  };
  return (
    <div className="cart-item-editor">
      <div className="cart-edit-controls">
        {editable ? (
          <div className="quantity-stepper" role="group" aria-label={`${label}数量`}>
            <button
              aria-label={`减少${label}数量`}
              title={value === 1 ? '再减一件将删除，可在 8 秒内撤销' : undefined}
              disabled={blocked}
              onClick={() =>
                value === 1
                  ? remove()
                  : void store.changeQuantity(item.item_id, value - 1).catch(() => undefined)
              }
            >
              −
            </button>
            <output aria-label={`${label}目标数量`}>{value}</output>
            <button
              aria-label={`增加${label}数量`}
              disabled={blocked || value >= (item.available_stock ?? 0)}
              onClick={() =>
                void store.changeQuantity(item.item_id, value + 1).catch(() => undefined)
              }
            >
              +
            </button>
          </div>
        ) : (
          <span aria-label={`${label}数量 ${item.quantity}`}>× {item.quantity}</span>
        )}
        <button
          className="text-button cart-remove"
          aria-label={`删除${label}`}
          disabled={
            state.mutating || state.retryPending || state.status !== 'ready' || !!edit?.retryPending
          }
          onClick={remove}
        >
          删除
        </button>
      </div>
      {insufficient && item.available_stock !== null && item.available_stock > 0 && (
        <button
          className="text-button cart-fix-quantity"
          disabled={blocked}
          onClick={() =>
            void store.changeQuantity(item.item_id, item.available_stock!).catch(() => undefined)
          }
        >
          改为 {item.available_stock} 件
        </button>
      )}
      {edit?.pending && (
        <p className="cart-edit-status" role="status">
          正在保存数量…
        </p>
      )}
      {edit?.error && (
        <p className="cart-edit-error" role="alert">
          {edit.error}
        </p>
      )}
      {edit?.retryPending && (
        <button
          className="button cart-edit-retry"
          disabled={edit.pending || state.mutating || state.retryPending}
          onClick={() => void store.retryQuantity(item.item_id).catch(() => undefined)}
        >
          确认数量结果
        </button>
      )}
    </div>
  );
}
