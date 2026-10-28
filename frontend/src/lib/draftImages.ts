import type { ImageEdit, MerchantProductImage, ProductMediaAsset } from '../types/merchantProduct.ts';
export type DraftImageChoice = ImageEdit & { url: string };
export function draftImageChoices(images: MerchantProductImage[]): DraftImageChoice[] { return images.map(({ product_image_id, asset_id, url }) => ({ product_image_id, asset_id, url })); }
export function draftImageEdits(images: DraftImageChoice[]): ImageEdit[] { return images.map(image => image.product_image_id !== undefined ? { product_image_id: image.product_image_id, asset_id: image.asset_id } : { client_key: image.client_key, asset_id: image.asset_id }); }
export function draftImageKey(image: DraftImageChoice): string { return image.product_image_id ?? image.client_key; }
export function addDraftImage(images: DraftImageChoice[], asset: ProductMediaAsset): DraftImageChoice[] {
  return images.some(image => image.asset_id === asset.asset_id) ? images : [...images, { asset_id: asset.asset_id, client_key: crypto.randomUUID(), url: asset.url }];
}
export function moveDraftImage(images: DraftImageChoice[], from: number, to: number): DraftImageChoice[] {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || from >= images.length || to >= images.length || from === to) return images;
  const next = [...images], [image] = next.splice(from, 1); next.splice(to, 0, image); return next;
}
export function validSavedImages(value: unknown): value is MerchantProductImage[] {
  if (!Array.isArray(value)) return false;
  const ids = new Set<string>();
  return value.every((image, index) => {
    if (!image || typeof image !== 'object' || typeof image.product_image_id !== 'string' || !image.product_image_id || ids.has(image.product_image_id) ||
      typeof image.asset_id !== 'string' || !image.asset_id || typeof image.url !== 'string' || !image.url || image.sort_order !== index) return false;
    ids.add(image.product_image_id); return true;
  });
}
