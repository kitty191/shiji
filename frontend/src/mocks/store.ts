import type { PublicStore } from '../types/catalog.ts';

export const publicStores: PublicStore[] = [
  { store_id: 'store_digital', name: '小橙数码', logo_url: null, description: '为桌面与日常工作挑选实用数码配件。', main_category_id: 'category_digital' },
  { store_id: 'store_home', name: '好物生活馆', logo_url: null, description: '从灯光到收纳，整理舒适的生活角落。', main_category_id: 'category_home' },
  { store_id: 'store_daily', name: '日常器物', logo_url: null, description: '文具、杯子与陪伴每一天的小器物。', main_category_id: 'category_home' },
  { store_id: 'store_outdoor', name: '轻行户外', logo_url: null, description: '轻装通勤，也给周末出行留一点空间。', main_category_id: 'category_outdoor' },
];
