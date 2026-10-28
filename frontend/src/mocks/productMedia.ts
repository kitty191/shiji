import type { StoreBrief } from '../types/catalog.ts';
import type { OwnedProductMediaAsset, ProductMediaAsset } from '../types/merchantProduct.ts';
import { CommerceError } from '../lib/commerce.ts';
// Fictitious private library; reusing a file is not a grant to another store's media records.
export const productMediaAssets: OwnedProductMediaAsset[] = [
  { asset_id: 'demo_asset_keyboard', url: '/images/keyboard.jpg', size_bytes: 30373 },
  { asset_id: 'demo_asset_lamp', url: '/images/lamp.jpg', size_bytes: 11860 },
  { asset_id: 'demo_asset_box', url: '/images/box.jpg', size_bytes: 19814 },
  { asset_id: 'demo_asset_mug', url: '/images/mug.jpg', size_bytes: 14573 },
  { asset_id: 'demo_asset_bag', url: '/images/bag.jpg', size_bytes: 26519 },
  { asset_id: 'demo_asset_pencil-case', url: '/images/pencil-case.jpg', size_bytes: 27225 },
  { asset_id: 'demo_asset_mat', url: '/images/mat.jpg', size_bytes: 15988 },
  { asset_id: 'demo_asset_notebook', url: '/images/notebook.jpg', size_bytes: 22968 },
  { asset_id: 'demo_asset_bottle', url: '/images/bottle.jpg', size_bytes: 12825 },
].map((asset) => ({
  ...asset,
  owner_store_id: 'store_home',
  purpose: 'PRODUCT_IMAGE',
  content_type: 'image/jpeg',
  status: 'READY',
  created_at: '2026-10-28T08:00:00+08:00',
}));
export function readProductMedia(
  store: StoreBrief | null,
  source: OwnedProductMediaAsset[] = productMediaAssets,
): ProductMediaAsset[] {
  if (!store?.store_id || !store.name)
    throw new CommerceError('FORBIDDEN', '当前账号没有商品图片管理权限。');
  return source
    .filter(
      (asset) =>
        asset.owner_store_id === store.store_id &&
        asset.purpose === 'PRODUCT_IMAGE' &&
        asset.status === 'READY',
    )
    .map(({ asset_id, url, content_type, size_bytes, status, created_at }) => ({
      asset_id,
      url,
      content_type,
      size_bytes,
      status,
      created_at,
    }));
}
