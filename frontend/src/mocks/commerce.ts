import type { Address } from '../types/address.ts';
import type {
  MerchantOrderDetail,
  MerchantOrderPage,
  MerchantOrderQuery,
  MerchantOrderSummary,
  ShipRequest,
} from '../types/merchant.ts';
import type { StoreBrief } from '../types/catalog.ts';
import type { ProductView } from '../types/catalog.ts';
import type {
  AddressSnapshot,
  BuyerOrder,
  CheckoutGroup,
  CheckoutLine,
  CheckoutPreview,
  CheckoutRequest,
  OrderPage,
  OrderQuery,
  PaymentGroup,
} from '../types/commerce.ts';
import { CommerceError, normalizeSelection, orderStatuses } from '../lib/commerce.ts';
import { normalizeShipping } from '../lib/merchant.ts';
import { addressFields, normalizeAddress } from '../lib/address.ts';
import { completeSku, inStock } from '../lib/product.ts';
import { parseCartSnapshot } from './cart.ts';
import type { PersistedCart } from './cart.ts';

interface Receipt {
  action: 'submit' | 'cancel' | 'pay' | 'ship' | 'receive';
  target: string;
  payment_group_id: string;
  store_id?: string;
  request?: ShipRequest;
}
interface Ledger {
  version: 1;
  orders: BuyerOrder[];
  payments: PaymentGroup[];
  bindings: Record<string, string>;
  receipts: Record<string, Receipt>;
}
interface Options {
  catalog: () => readonly ProductView[];
  addresses: () => Address[];
  load: () => string | null;
  save: (value: string) => void;
  merchantStore?: () => StoreBrief | null;
  id?: () => string;
  now?: () => number;
  previewMs?: number;
  paymentMs?: number;
}
interface PreviewRecord {
  request: CheckoutRequest;
  quote: CheckoutPreview;
}
const amount = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0;
const text = (value: unknown): value is string => typeof value === 'string' && !!value;
const date = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value));
function validAddress(value: AddressSnapshot): boolean {
  try {
    normalizeAddress(value);
    return true;
  } catch {
    return false;
  }
}
function validLine(value: BuyerOrder['items'][number]): boolean {
  return (
    !!value &&
    text(value.order_item_id) &&
    text(value.product_id) &&
    text(value.sku_id) &&
    text(value.name) &&
    Number.isSafeInteger(value.quantity) &&
    value.quantity > 0 &&
    amount(value.unit_price) &&
    amount(value.line_amount) &&
    value.line_amount === value.unit_price * value.quantity &&
    (value.image_url === null || typeof value.image_url === 'string') &&
    Array.isArray(value.spec_values) &&
    value.spec_values.every(
      (v) => v && typeof v.dimension_name === 'string' && typeof v.value === 'string',
    )
  );
}
function readLedger(value: unknown): Ledger {
  if (value === undefined)
    return { version: 1, orders: [], payments: [], bindings: {}, receipts: {} };
  try {
    const ledger = value as Ledger;
    if (
      !ledger ||
      ledger.version !== 1 ||
      !Array.isArray(ledger.orders) ||
      !Array.isArray(ledger.payments) ||
      !ledger.bindings ||
      typeof ledger.bindings !== 'object' ||
      Array.isArray(ledger.bindings) ||
      !ledger.receipts ||
      typeof ledger.receipts !== 'object' ||
      Array.isArray(ledger.receipts)
    )
      throw Error();
    if (
      !ledger.orders.every(
        (o) =>
          o &&
          text(o.order_id) &&
          text(o.order_no) &&
          text(o.payment_group_id) &&
          text(o.store_id) &&
          text(o.store_name) &&
          Object.hasOwn(orderStatuses, o.status) &&
          ['PENDING', 'PAID', 'CLOSED'].includes(o.payment_status) &&
          amount(o.goods_amount) &&
          amount(o.shipping_amount) &&
          o.total_amount === o.goods_amount + o.shipping_amount &&
          Array.isArray(o.items) &&
          o.items.length &&
          o.items.every(validLine) &&
          o.goods_amount === o.items.reduce((n, line) => n + line.line_amount, 0) &&
          o.currency === 'CNY' &&
          date(o.created_at) &&
          date(o.payment_expires_at) &&
          Array.isArray(o.allowed_actions) &&
          validAddress(o.address),
      )
    )
      throw Error();
    if (
      new Set(ledger.orders.map((o) => o.order_id)).size !== ledger.orders.length ||
      new Set(ledger.payments.map((p) => p.payment_group_id)).size !== ledger.payments.length
    )
      throw Error();
    for (const payment of ledger.payments) {
      if (
        !payment ||
        !text(payment.payment_group_id) ||
        !text(payment.payment_no) ||
        !['PENDING', 'PAID', 'CLOSED'].includes(payment.status) ||
        !date(payment.created_at) ||
        !date(payment.expires_at) ||
        payment.currency !== 'CNY' ||
        !amount(payment.total_amount) ||
        !Array.isArray(payment.shop_orders) ||
        !Array.isArray(payment.allowed_actions)
      )
        throw Error();
      const orders = ledger.orders.filter((o) => o.payment_group_id === payment.payment_group_id);
      if (
        !orders.length ||
        orders.length !== payment.shop_orders.length ||
        payment.total_amount !== orders.reduce((n, o) => n + o.total_amount, 0) ||
        orders.some(
          (o) =>
            !payment.shop_orders.some(
              (link) =>
                link.order_id === o.order_id &&
                link.status === o.status &&
                link.total_amount === o.total_amount,
            ) || o.payment_status !== payment.status,
        )
      )
        throw Error();
      if (
        payment.status === 'PENDING' &&
        (payment.paid_at !== null ||
          payment.closed_at !== null ||
          orders.some(
            (o) => o.status !== 'PENDING_PAYMENT' || o.paid_at !== null || o.closed_at !== null,
          ))
      )
        throw Error();
      if (
        payment.status === 'PAID' &&
        (!date(payment.paid_at) ||
          payment.closed_at !== null ||
          orders.some(
            (o) =>
              !['PENDING_SHIPMENT', 'PENDING_RECEIPT', 'COMPLETED'].includes(o.status) ||
              o.paid_at !== payment.paid_at ||
              o.closed_at !== null,
          ))
      )
        throw Error();
      if (
        payment.status === 'CLOSED' &&
        (!date(payment.closed_at) ||
          payment.paid_at !== null ||
          orders.some(
            (o) => o.status !== 'CLOSED' || o.closed_at !== payment.closed_at || o.paid_at !== null,
          ))
      )
        throw Error();
    }
    if (
      ledger.orders.some(
        (o) => !ledger.payments.some((p) => p.payment_group_id === o.payment_group_id),
      )
    )
      throw Error();
    if (
      Object.values(ledger.bindings).some(
        (id) => !ledger.payments.some((p) => p.payment_group_id === id),
      ) ||
      Object.values(ledger.receipts).some(
        (r) =>
          !r ||
          !['submit', 'cancel', 'pay', 'ship', 'receive'].includes(r.action) ||
          !text(r.target) ||
          !ledger.payments.some((p) => p.payment_group_id === r.payment_group_id),
      )
    )
      throw Error();
    for (const receipt of Object.values(ledger.receipts).filter((r) => r.action === 'ship')) {
      if (
        !text(receipt.store_id) ||
        !receipt.request ||
        normalizeShipping(receipt.request).shipping_carrier !== receipt.request.shipping_carrier ||
        normalizeShipping(receipt.request).tracking_no !== receipt.request.tracking_no ||
        !ledger.orders.some(
          (o) =>
            o.order_id === receipt.target &&
            o.store_id === receipt.store_id &&
            o.payment_group_id === receipt.payment_group_id &&
            o.shipping_carrier === receipt.request!.shipping_carrier &&
            o.tracking_no === receipt.request!.tracking_no &&
            ['PENDING_RECEIPT', 'COMPLETED'].includes(o.status),
        )
      )
        throw Error();
    }
    if (
      ledger.orders.some(
        (o) =>
          (o.status === 'PENDING_RECEIPT' || o.status === 'COMPLETED') &&
          (!text(o.shipping_carrier) || !text(o.tracking_no) || !date(o.shipped_at)),
      )
    )
      throw Error();
    if (
      ledger.orders.some((o) =>
        o.status === 'COMPLETED' ? !date(o.received_at) : o.received_at !== null,
      ) ||
      Object.values(ledger.receipts).some(
        (r) =>
          r.action === 'receive' &&
          !ledger.orders.some(
            (o) =>
              o.order_id === r.target &&
              o.payment_group_id === r.payment_group_id &&
              o.status === 'COMPLETED',
          ),
      )
    )
      throw Error();
    return structuredClone(ledger);
  } catch {
    throw new CommerceError('SERVICE_UNAVAILABLE', '暂时无法读取订单，已有订单与购物车未被覆盖。');
  }
}

// One fictional account. Cart consumption, orders and reservation records share one local snapshot write.
export class MockCommerce {
  private options: Options;
  private previews = new Map<string, PreviewRecord>();
  constructor(options: Options) {
    this.options = options;
  }
  private time(): number {
    return (this.options.now ?? Date.now)();
  }
  private id(): string {
    return (this.options.id ?? (() => crypto.randomUUID()))();
  }
  private read(): { cart: PersistedCart; ledger: Ledger } {
    let cart: PersistedCart;
    try {
      cart = parseCartSnapshot(this.options.load());
    } catch {
      throw new CommerceError(
        'SERVICE_UNAVAILABLE',
        '暂时无法读取交易资料，请稍后重试；已有资料未被覆盖。',
      );
    }
    const ledger = readLedger(cart.checkout),
      now = this.time();
    for (const payment of ledger.payments) {
      if (payment.status === 'PENDING' && Date.parse(payment.expires_at) <= now)
        this.close(ledger, payment, 'TIMEOUT', payment.expires_at);
      if (payment.status === 'PENDING') payment.allowed_actions = ['SIMULATE_PAY', 'CANCEL'];
      payment.checked_at = new Date(now).toISOString();
    }
    // Derive buyer actions on read so orders saved before receipt support remain usable.
    for (const order of ledger.orders)
      order.allowed_actions =
        order.status === 'PENDING_PAYMENT'
          ? ['CANCEL']
          : order.status === 'PENDING_RECEIPT'
            ? ['CONFIRM_RECEIPT']
            : [];
    return { cart, ledger };
  }
  private close(ledger: Ledger, payment: PaymentGroup, reason: string, timestamp: string): void {
    payment.status = 'CLOSED';
    payment.closed_at = timestamp;
    payment.close_reason = reason;
    payment.allowed_actions = [];
    for (const order of ledger.orders.filter(
      (o) => o.payment_group_id === payment.payment_group_id,
    )) {
      order.status = 'CLOSED';
      order.payment_status = 'CLOSED';
      order.closed_at = timestamp;
      order.close_reason = reason;
      order.allowed_actions = [];
    }
    payment.shop_orders = payment.shop_orders.map((order) => ({ ...order, status: 'CLOSED' }));
  }
  private write(cart: PersistedCart, ledger: Ledger): void {
    try {
      this.options.save(JSON.stringify({ ...cart, checkout: ledger }));
    } catch {
      throw new CommerceError(
        'SERVICE_UNAVAILABLE',
        '暂时无法保存订单，请稍后重试；本次未修改交易资料。',
      );
    }
  }
  private catalogFor(ledger: Ledger): ProductView[] {
    const reserved = new Map<string, number>();
    for (const order of ledger.orders.filter(
      (o) => o.payment_status === 'PENDING' || o.payment_status === 'PAID',
    ))
      for (const line of order.items)
        reserved.set(line.sku_id, (reserved.get(line.sku_id) ?? 0) + line.quantity);
    return this.options.catalog().map((original) => {
      const product = structuredClone(original);
      if (product.view_status === 'OFF_SALE') return product;
      product.skus = product.skus.map((sku) => {
        const available_stock = Math.max(0, sku.available_stock - (reserved.get(sku.sku_id) ?? 0));
        return {
          ...sku,
          available_stock,
          status: sku.status === 'IN_STOCK' && available_stock > 0 ? 'IN_STOCK' : 'SOLD_OUT',
        };
      });
      const complete = product.skus.filter((sku) => completeSku(product, sku)),
        available = complete.filter(inStock),
        prices = (available.length ? available : complete).map((sku) => sku.price);
      product.stock_status = available.length ? 'IN_STOCK' : 'SOLD_OUT';
      if (prices.length) {
        product.min_price = Math.min(...prices);
        product.max_price = Math.max(...prices);
        if (product.display_price_source === 'AUTO') product.display_price = product.min_price;
      }
      return product;
    });
  }
  catalog(): ProductView[] {
    return this.catalogFor(this.read().ledger);
  }
  private quote(
    request: CheckoutRequest,
    cart: PersistedCart,
    ledger: Ledger,
  ): Omit<CheckoutPreview, 'preview_token' | 'preview_expires_at' | 'checked_at'> {
    const selection = normalizeSelection(request);
    const address = this.options.addresses().find((a) => a.address_id === request.address_id);
    if (!address)
      throw new CommerceError('ADDRESS_CHANGED', '所选地址已不存在，请重新选择收货地址。');
    const addressSnapshot = Object.fromEntries(
      addressFields.map((field) => [field.name, address[field.name]]),
    ) as unknown as AddressSnapshot;
    const requested =
      selection.source === 'CART'
        ? selection.cart_item_ids.map((id) => {
            const row = cart.items.find((item) => item.item_id === id);
            if (!row)
              throw new CommerceError(
                'CART_CHANGED',
                '所选商品已从购物车移除，请返回购物车重新确认。',
              );
            return { sku_id: row.sku_id, quantity: row.quantity, cart_item_id: id };
          })
        : selection.items.map((item) => ({ ...item, cart_item_id: null }));
    const catalog = this.catalogFor(ledger),
      groups: CheckoutGroup[] = [];
    for (const item of requested) {
      const product = catalog.find(
        (p) => p.view_status === 'ON_SALE' && p.skus.some((s) => s.sku_id === item.sku_id),
      );
      if (!product || product.view_status !== 'ON_SALE')
        throw new CommerceError('ITEM_NOT_PURCHASABLE', '所选商品已下架或不可购买，请重新确认。');
      const sku = product.skus.find((s) => s.sku_id === item.sku_id && completeSku(product, s));
      if (!sku || !inStock(sku))
        throw new CommerceError('ITEM_NOT_PURCHASABLE', '所选规格已失效或售罄，请重新确认。');
      if (!amount(sku.price) || !Number.isSafeInteger(sku.available_stock))
        throw new CommerceError('ITEM_NOT_PURCHASABLE', '所选规格资料无效，请重新确认。');
      if (item.quantity > sku.available_stock)
        throw new CommerceError(
          'INSUFFICIENT_STOCK',
          `${product.name}库存不足，当前可购 ${sku.available_stock} 件，请返回调整数量。`,
        );
      const line: CheckoutLine = {
        ...item,
        product_id: product.product_id,
        name: product.name,
        image_url:
          product.images.find((image) => image.image_id === sku.image_id)?.url ||
          product.cover_image,
        unit_price: sku.price,
        line_amount: sku.price * item.quantity,
        spec_values: product.dimensions.map((d) => ({
          dimension_name: d.name,
          value: d.values.find(
            (v) =>
              v.value_id ===
              sku.spec_values.find((s) => s.dimension_id === d.dimension_id)?.value_id,
          )!.value,
        })),
      };
      let group = groups.find((g) => g.store.store_id === product.store.store_id);
      if (!group) {
        group = {
          store: { ...product.store },
          items: [],
          goods_amount: 0,
          shipping_amount: 0,
          total_amount: 0,
        };
        groups.push(group);
      }
      group.items.push(line);
      group.goods_amount += line.line_amount;
      group.total_amount = group.goods_amount;
    }
    const total_amount = groups.reduce((sum, group) => sum + group.total_amount, 0);
    if (!amount(total_amount)) throw new CommerceError('INVALID_ARGUMENT', '结算金额超出范围。');
    return {
      source: selection.source,
      groups,
      address: addressSnapshot,
      total_amount,
      currency: 'CNY',
    };
  }
  preview(input: CheckoutRequest): CheckoutPreview {
    const request = { ...normalizeSelection(input), address_id: input.address_id },
      { cart, ledger } = this.read(),
      now = this.time();
    const quote: CheckoutPreview = {
      ...this.quote(request, cart, ledger),
      checked_at: new Date(now).toISOString(),
      preview_token: `preview_${this.id()}`,
      preview_expires_at: new Date(now + (this.options.previewMs ?? 300000)).toISOString(),
    };
    this.previews.set(quote.preview_token, { request, quote: structuredClone(quote) });
    while (this.previews.size > 100) this.previews.delete(this.previews.keys().next().value!);
    return quote;
  }
  private receipt(
    ledger: Ledger,
    key: string,
    action: 'submit' | 'cancel' | 'pay',
    target: string,
  ): PaymentGroup | undefined {
    if (!key) throw new CommerceError('INVALID_ARGUMENT', '操作标记不能为空。');
    const record = Object.hasOwn(ledger.receipts, key) ? ledger.receipts[key] : undefined;
    if (!record) return undefined;
    if (record.action !== action || record.target !== target)
      throw new CommerceError('IDEMPOTENCY_CONFLICT', '操作标记与原请求不一致。');
    return structuredClone(
      ledger.payments.find((p) => p.payment_group_id === record.payment_group_id)!,
    );
  }
  submit(token: string, key: string): PaymentGroup {
    const { cart, ledger } = this.read(),
      replay = this.receipt(ledger, key, 'submit', token);
    if (replay) return replay;
    const bound = Object.hasOwn(ledger.bindings, token)
      ? ledger.payments.find((p) => p.payment_group_id === ledger.bindings[token])
      : undefined;
    if (bound) {
      ledger.receipts = {
        ...ledger.receipts,
        [key]: { action: 'submit', target: token, payment_group_id: bound.payment_group_id },
      };
      this.write(cart, ledger);
      return structuredClone(bound);
    }
    const record = this.previews.get(token);
    if (!record || Date.parse(record.quote.preview_expires_at) <= this.time())
      throw new CommerceError('PREVIEW_EXPIRED', '结算预览已过期，请重新预览后确认。');
    const current = this.quote(record.request, cart, ledger),
      quoted = record.quote;
    if (JSON.stringify(current.address) !== JSON.stringify(quoted.address))
      throw new CommerceError('ADDRESS_CHANGED', '收货地址已变化，请重新预览并确认。');
    const lines = current.groups.flatMap((g) => g.items),
      old = quoted.groups.flatMap((g) => g.items);
    if (
      lines.some(
        (line, i) =>
          line.sku_id !== old[i]?.sku_id ||
          line.quantity !== old[i]?.quantity ||
          line.cart_item_id !== old[i]?.cart_item_id,
      )
    )
      throw new CommerceError('CART_CHANGED', '购物车内容或数量已变化，请重新预览并确认。');
    if (lines.some((line, i) => line.unit_price !== old[i]?.unit_price))
      throw new CommerceError('PRICE_CHANGED', '商品价格已变化，请重新预览并确认新报价。');
    if (JSON.stringify(current.groups) !== JSON.stringify(quoted.groups))
      throw new CommerceError('CART_CHANGED', '商品资料已变化，请重新预览并确认。');
    const timestamp = new Date(this.time()).toISOString(),
      paymentId = `payment_${this.id()}`,
      expires = new Date(this.time() + (this.options.paymentMs ?? 900000)).toISOString();
    const orders: BuyerOrder[] = current.groups.map((group) => {
      const id = this.id();
      return {
        order_id: `order_${id}`,
        order_no: `SJ${id}`,
        store_id: group.store.store_id,
        store_name: group.store.name,
        goods_amount: group.goods_amount,
        shipping_amount: group.shipping_amount,
        total_amount: group.total_amount,
        status: 'PENDING_PAYMENT',
        payment_group_id: paymentId,
        currency: 'CNY',
        created_at: timestamp,
        allowed_actions: ['CANCEL'],
        address: structuredClone(current.address),
        payment_status: 'PENDING',
        paid_at: null,
        shipping_carrier: null,
        tracking_no: null,
        shipped_at: null,
        received_at: null,
        closed_at: null,
        close_reason: null,
        payment_expires_at: expires,
        items: group.items.map(({ cart_item_id: _id, ...line }) => ({
          ...line,
          order_item_id: `line_${this.id()}`,
        })),
      };
    });
    const payment: PaymentGroup = {
      payment_group_id: paymentId,
      payment_no: `PAY${paymentId.slice(8)}`,
      status: 'PENDING',
      total_amount: current.total_amount,
      currency: 'CNY',
      expires_at: expires,
      paid_at: null,
      closed_at: null,
      close_reason: null,
      created_at: timestamp,
      checked_at: timestamp,
      allowed_actions: ['SIMULATE_PAY', 'CANCEL'],
      shop_orders: orders.map(
        ({
          order_id,
          order_no,
          store_id,
          store_name,
          status,
          goods_amount,
          shipping_amount,
          total_amount,
        }) => ({
          order_id,
          order_no,
          store_id,
          store_name,
          status,
          goods_amount,
          shipping_amount,
          total_amount,
        }),
      ),
    };
    ledger.orders.unshift(...orders);
    ledger.payments.unshift(payment);
    ledger.bindings = { ...ledger.bindings, [token]: paymentId };
    ledger.receipts = {
      ...ledger.receipts,
      [key]: { action: 'submit', target: token, payment_group_id: paymentId },
    };
    if (record.request.source === 'CART') {
      const ids = record.request.cart_item_ids;
      cart.items = cart.items.filter((item) => !ids.includes(item.item_id));
    }
    this.write(cart, ledger);
    return structuredClone(payment);
  }
  pay(paymentId: string, key: string): PaymentGroup {
    const { cart, ledger } = this.read(),
      replay = this.receipt(ledger, key, 'pay', paymentId);
    if (replay) return replay;
    const payment = ledger.payments.find((p) => p.payment_group_id === paymentId);
    if (!payment) throw new CommerceError('NOT_FOUND', '没有找到这次结算。');
    if (payment.status === 'CLOSED')
      throw new CommerceError(
        payment.close_reason === 'TIMEOUT' ? 'PAYMENT_EXPIRED' : 'INVALID_STATE',
        '本次结算已关闭，不能付款，请核对最新状态。',
      );
    // A fresh key after a reload must not charge or consume stock again.
    if (payment.status === 'PAID') {
      ledger.receipts = {
        ...ledger.receipts,
        [key]: { action: 'pay', target: paymentId, payment_group_id: paymentId },
      };
      this.write(cart, ledger);
      return structuredClone(payment);
    }
    const now = this.time();
    if (Date.parse(payment.expires_at) <= now)
      throw new CommerceError('PAYMENT_EXPIRED', '付款已超时，请核对最新支付单状态。');
    const timestamp = new Date(now).toISOString();
    payment.status = 'PAID';
    payment.paid_at = timestamp;
    payment.allowed_actions = [];
    for (const order of ledger.orders.filter((o) => o.payment_group_id === paymentId)) {
      order.status = 'PENDING_SHIPMENT';
      order.payment_status = 'PAID';
      order.paid_at = timestamp;
      order.allowed_actions = [];
    }
    payment.shop_orders = payment.shop_orders.map((order) => ({
      ...order,
      status: 'PENDING_SHIPMENT',
    }));
    ledger.receipts = {
      ...ledger.receipts,
      [key]: { action: 'pay', target: paymentId, payment_group_id: paymentId },
    };
    this.write(cart, ledger);
    return structuredClone(payment);
  }
  cancel(paymentId: string, key: string): PaymentGroup {
    const { cart, ledger } = this.read(),
      replay = this.receipt(ledger, key, 'cancel', paymentId);
    if (replay) return replay;
    const payment = ledger.payments.find((p) => p.payment_group_id === paymentId);
    if (!payment) throw new CommerceError('NOT_FOUND', '没有找到这次结算。');
    if (payment.status === 'PAID') throw new CommerceError('INVALID_STATE', '已付款结算不能取消。');
    if (payment.status === 'PENDING')
      this.close(ledger, payment, 'BUYER_CANCELLED', new Date(this.time()).toISOString());
    ledger.receipts = {
      ...ledger.receipts,
      [key]: { action: 'cancel', target: paymentId, payment_group_id: paymentId },
    };
    this.write(cart, ledger);
    return structuredClone(payment);
  }
  private merchantStore(): StoreBrief {
    const store = this.options.merchantStore?.();
    if (!store?.store_id || !store.name)
      throw new CommerceError('FORBIDDEN', '当前账号没有可查看的店铺订单。');
    return store;
  }
  private merchantSummary(order: BuyerOrder): MerchantOrderSummary {
    const {
      order_id,
      order_no,
      store_id,
      store_name,
      status,
      goods_amount,
      shipping_amount,
      total_amount,
      items,
      currency,
      created_at,
    } = order;
    return structuredClone({
      order_id,
      order_no,
      store_id,
      store_name,
      status,
      goods_amount,
      shipping_amount,
      total_amount,
      items,
      currency,
      created_at,
      allowed_actions:
        order.payment_status === 'PAID' && order.status === 'PENDING_SHIPMENT' ? ['SHIP'] : [],
    });
  }
  merchantOrders(query: MerchantOrderQuery): MerchantOrderPage {
    const store = this.merchantStore();
    if (
      !Number.isSafeInteger(query.page) ||
      query.page < 1 ||
      !Number.isSafeInteger(query.page_size) ||
      query.page_size < 1 ||
      query.page_size > 50 ||
      (query.status && !Object.hasOwn(orderStatuses, query.status)) ||
      typeof query.order_no !== 'string' ||
      typeof query.keyword !== 'string'
    )
      throw new CommerceError('INVALID_ARGUMENT', '订单筛选条件无效，请重新查询。');
    const keyword = query.keyword.trim().toLocaleLowerCase(),
      orderNo = query.order_no.trim();
    const items = this.read()
      .ledger.orders.filter((o) => o.store_id === store.store_id)
      .filter(
        (o) =>
          (!query.status || o.status === query.status) &&
          (!orderNo || o.order_no.includes(orderNo)) &&
          (!keyword || o.items.some((line) => line.name.toLocaleLowerCase().includes(keyword))),
      )
      .sort(
        (a, b) =>
          Date.parse(b.created_at) - Date.parse(a.created_at) ||
          (a.order_id < b.order_id ? 1 : a.order_id > b.order_id ? -1 : 0),
      );
    const start = (query.page - 1) * query.page_size;
    return {
      items: items.slice(start, start + query.page_size).map((o) => this.merchantSummary(o)),
      page: query.page,
      page_size: query.page_size,
      total: items.length,
      has_more: start + query.page_size < items.length,
    };
  }
  merchantOrder(id: string): MerchantOrderDetail {
    const store = this.merchantStore(),
      order = this.read().ledger.orders.find(
        (o) => o.order_id === id && o.store_id === store.store_id,
      );
    if (!order) throw new CommerceError('NOT_FOUND', '没有找到本店订单。');
    return this.merchantDetail(order);
  }
  private merchantDetail(order: BuyerOrder): MerchantOrderDetail {
    const {
      address,
      payment_status,
      paid_at,
      shipping_carrier,
      tracking_no,
      shipped_at,
      received_at,
      closed_at,
      close_reason,
    } = order;
    return {
      ...this.merchantSummary(order),
      ...structuredClone({
        address,
        payment_status,
        paid_at,
        shipping_carrier,
        tracking_no,
        shipped_at,
        received_at,
        closed_at,
        close_reason,
      }),
    };
  }
  ship(id: string, input: ShipRequest, key: string): MerchantOrderDetail {
    const store = this.merchantStore(),
      request = normalizeShipping(input),
      { cart, ledger } = this.read();
    const order = ledger.orders.find((o) => o.order_id === id && o.store_id === store.store_id);
    if (!order) throw new CommerceError('NOT_FOUND', '没有找到本店订单。');
    if (!key) throw new CommerceError('INVALID_ARGUMENT', '操作标记不能为空。');
    const receipt = Object.hasOwn(ledger.receipts, key) ? ledger.receipts[key] : undefined;
    if (receipt) {
      if (
        receipt.action !== 'ship' ||
        receipt.target !== id ||
        receipt.store_id !== store.store_id ||
        receipt.request?.shipping_carrier !== request.shipping_carrier ||
        receipt.request?.tracking_no !== request.tracking_no
      )
        throw new CommerceError('IDEMPOTENCY_CONFLICT', '操作标记与原发货请求不一致。');
      return this.merchantDetail(order);
    }
    if (order.payment_status !== 'PAID' || order.status !== 'PENDING_SHIPMENT') {
      if (
        !['PENDING_RECEIPT', 'COMPLETED'].includes(order.status) ||
        order.shipping_carrier !== request.shipping_carrier ||
        order.tracking_no !== request.tracking_no
      )
        throw new CommerceError(
          'INVALID_STATE',
          '仅已付款、待发货的本店订单可发货；已发货订单不能修改物流。',
        );
    } else {
      order.status = 'PENDING_RECEIPT';
      order.shipping_carrier = request.shipping_carrier;
      order.tracking_no = request.tracking_no;
      order.shipped_at = new Date(this.time()).toISOString();
      order.allowed_actions = ['CONFIRM_RECEIPT'];
      const payment = ledger.payments.find((p) => p.payment_group_id === order.payment_group_id)!;
      payment.shop_orders = payment.shop_orders.map((link) =>
        link.order_id === id ? { ...link, status: 'PENDING_RECEIPT' } : link,
      );
    }
    ledger.receipts = {
      ...ledger.receipts,
      [key]: {
        action: 'ship',
        target: id,
        payment_group_id: order.payment_group_id,
        store_id: store.store_id,
        request,
      },
    };
    this.write(cart, ledger);
    return this.merchantDetail(order);
  }
  confirmReceipt(id: string, key: string): BuyerOrder {
    const { cart, ledger } = this.read(),
      order = ledger.orders.find((o) => o.order_id === id);
    if (!order) throw new CommerceError('NOT_FOUND', '没有找到这笔订单。');
    if (!key) throw new CommerceError('INVALID_ARGUMENT', '操作标记不能为空。');
    const receipt = Object.hasOwn(ledger.receipts, key) ? ledger.receipts[key] : undefined;
    if (receipt) {
      if (receipt.action !== 'receive' || receipt.target !== id)
        throw new CommerceError('IDEMPOTENCY_CONFLICT', '操作标记与原收货请求不一致。');
      return structuredClone(order);
    }
    if (order.payment_status !== 'PAID' || !['PENDING_RECEIPT', 'COMPLETED'].includes(order.status))
      throw new CommerceError(
        'INVALID_STATE',
        '仅已付款、待收货的订单可确认收货，请核对最新状态。',
      );
    if (order.status === 'PENDING_RECEIPT') {
      order.status = 'COMPLETED';
      order.received_at = new Date(this.time()).toISOString();
      order.allowed_actions = [];
      const payment = ledger.payments.find((p) => p.payment_group_id === order.payment_group_id)!;
      payment.shop_orders = payment.shop_orders.map((link) =>
        link.order_id === id ? { ...link, status: 'COMPLETED' } : link,
      );
    }
    ledger.receipts = {
      ...ledger.receipts,
      [key]: { action: 'receive', target: id, payment_group_id: order.payment_group_id },
    };
    this.write(cart, ledger);
    return structuredClone(order);
  }
  orders(query: OrderQuery): OrderPage {
    const items = this.read().ledger.orders.filter(
      (o) =>
        (!query.status || o.status === query.status) &&
        (!query.order_no || o.order_no.includes(query.order_no.trim())),
    );
    const start = (query.page - 1) * query.page_size;
    return {
      items: items.slice(start, start + query.page_size),
      page: query.page,
      page_size: query.page_size,
      total: items.length,
      has_more: start + query.page_size < items.length,
    };
  }
  order(id: string): BuyerOrder {
    const order = this.read().ledger.orders.find((o) => o.order_id === id);
    if (!order) throw new CommerceError('NOT_FOUND', '没有找到这笔订单。');
    return structuredClone(order);
  }
  payment(id: string): PaymentGroup {
    const payment = this.read().ledger.payments.find((p) => p.payment_group_id === id);
    if (!payment) throw new CommerceError('NOT_FOUND', '没有找到这次结算。');
    return structuredClone(payment);
  }
}
