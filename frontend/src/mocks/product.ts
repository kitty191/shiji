import type { ProductDetail, ProductView, PublicSku, SpecDimension } from '../types/catalog.ts';
import { products } from './catalog.ts';

const lampDimensions: SpecDimension[] = [
  { dimension_id: 'color', name: '颜色', values: [{ value_id: 'white', value: '白色' }, { value_id: 'black', value: '黑色' }] },
  { dimension_id: 'power', name: '供电', values: [{ value_id: 'usb', value: 'USB 版' }, { value_id: 'battery', value: '充电版' }] },
];
const oneDimension = (name: string, values: [string, string][]): SpecDimension[] => [
  { dimension_id: 'variant', name, values: values.map(([value_id, value]) => ({ value_id, value })) },
];
function sku(id: string, price: number, stock: number, values: [string, string][]): PublicSku {
  return { sku_id: id, price, available_stock: stock, currency: 'CNY', status: stock ? 'IN_STOCK' : 'SOLD_OUT',
    spec_values: values.map(([dimension_id, value_id]) => ({ dimension_id, value_id })), image_id: null, image_url: null };
}

const variants: Record<string, { dimensions: SpecDimension[]; skus: PublicSku[] }> = {
  lamp: { dimensions: lampDimensions, skus: [
    sku('white-usb', 5900, 8, [['color', 'white'], ['power', 'usb']]),
    sku('white-battery', 7900, 6, [['color', 'white'], ['power', 'battery']]),
    sku('black-usb', 5900, 0, [['color', 'black'], ['power', 'usb']]),
  ] },
  keyboard: { dimensions: oneDimension('颜色', [['ivory', '米白色'], ['gray', '深灰色']]),
    skus: [sku('ivory', 12900, 12, [['variant', 'ivory']]), sku('gray', 13900, 8, [['variant', 'gray']])] },
  box: { dimensions: oneDimension('尺寸', [['small', '小号 · 米色'], ['large', '大号 · 米色']]),
    skus: [sku('small', 2990, 38, [['variant', 'small']]), sku('large', 3990, 2, [['variant', 'large']])] },
};
const descriptions: Record<string, string> = {
  keyboard: '蓝牙连接，轻巧布局，为日常桌面留出更多空间。',
  lamp: '三档亮度，可折叠灯臂。阅读、工作或写字时，都有一束柔和的光。',
  box: '分区收纳，两种尺寸。让文具和日常小物各有位置。',
  mug: '350 ml 米色陶瓷杯，为日常留一段喝水的时间。',
  bag: '轻量通勤款，收纳日常出门需要的小物。',
  'pencil-case': '原色帆布，拉链开合，适合文具随身收纳。',
  mat: '深灰色加宽桌垫，适合日常办公与学习。',
  notebook: '方格内页，单本装，随时记下新的想法。',
  bottle: '500 ml 蓝色随行杯，轻装出门，随手补水。',
};
const stocks: Record<string, number> = { mug: 15, bag: 10, 'pencil-case': 20, mat: 18, notebook: 26, bottle: 16 };

export const productDetails: ProductDetail[] = products.map(({ published_order, ...card }) => {
  const options = variants[card.product_id] || { dimensions: [], skus: [sku('default', card.display_price, stocks[card.product_id] ?? 0, [])] };
  const skus = options.skus.map(item => ({ ...item, sku_id: `${card.product_id}_${item.sku_id}` }));
  return { ...card, view_status: 'ON_SALE', description: descriptions[card.product_id],
    attributes: [{ name: '商品名称', value: card.name }, { name: '品牌 / 店铺', value: card.store.name }, { name: '计价货币', value: '人民币' }],
    images: card.cover_image ? [{ image_id: `${card.product_id}-main`, url: card.cover_image, sort_order: 0 }] : [],
    dimensions: options.dimensions, skus, default_sku_id: skus.find(item => item.available_stock > 0)?.sku_id ?? null,
    published_at: `2026-10-${String(published_order).padStart(2, '0')}T08:00:00+08:00` };
});

export function mockProductView(id: string): ProductView | undefined {
  if (id === 'stand') return { product_id: id, view_status: 'OFF_SALE', store: { store_id: 'store_digital', name: '小橙数码' } };
  return productDetails.find(product => product.product_id === id);
}
