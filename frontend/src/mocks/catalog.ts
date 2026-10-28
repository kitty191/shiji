import type { Category, MockProduct } from '../types/catalog.ts';
export const categories: Category[] = [
  { category_id: 'category_digital', parent_id: null, name: '数码', sort_order: 1 },
  { category_id: 'category_home', parent_id: null, name: '家居', sort_order: 2 },
  { category_id: 'category_outdoor', parent_id: null, name: '户外', sort_order: 3 },
];
const rows = [
  ['keyboard', '无线键盘', 12900, 13900, 'digital', 'digital', '小橙数码'],
  ['lamp', '折叠台灯', 5900, 7900, 'home', 'home', '好物生活馆'],
  ['box', '桌面收纳盒', 2990, 3990, 'home', 'home', '好物生活馆'],
  ['mug', '简约陶瓷杯', 3900, 3900, 'home', 'daily', '日常器物'],
  ['bag', '轻便通勤包', 8900, 8900, 'outdoor', 'outdoor', '轻行户外'],
  ['pencil-case', '帆布笔袋', 1590, 1590, 'home', 'daily', '日常器物'],
  ['mat', '桌面防滑鼠标垫 加宽办公款', 2590, 2590, 'digital', 'digital', '小橙数码'],
  ['notebook', '日常随手记事本', 1200, 1200, 'home', 'daily', '日常器物'],
  ['bottle', '轻量随行水杯', 4900, 4900, 'outdoor', 'outdoor', '轻行户外'],
] as const;
export const products: MockProduct[] = rows.map(
  ([id, name, min, max, category, store, shop], index) => ({
    product_id: id,
    name,
    category_id: `category_${category}`,
    cover_image: `/images/${id}.jpg`,
    store: { store_id: `store_${store}`, name: shop },
    display_price: min,
    display_price_source: 'AUTO',
    min_price: min,
    max_price: max,
    currency: 'CNY',
    stock_status: 'IN_STOCK',
    published_order: index + 1,
  }),
);
