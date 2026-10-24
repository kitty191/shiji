import { useState } from 'react';
import type { GalleryFrame } from '../lib/product.ts';

function GalleryImage({ src, fallback, name, cropped = false }: { src: string; fallback: string | null; name: string; cropped?: boolean }) {
  const [failed, setFailed] = useState<string[]>([]);
  const displayed = !failed.includes(src) ? src : fallback && !failed.includes(fallback) ? fallback : null;
  return displayed ? <img src={displayed} alt={name} className={cropped ? 'is-cropped' : undefined}
    onError={() => setFailed(previous => [...previous, displayed])} width="480" height="480" /> : <span className="image-placeholder">暂无商品图片</span>;
}

export function ProductGallery({ frames, active, onChange, name, cover }: {
  frames: GalleryFrame[]; active?: string; onChange: (id: string) => void; name: string; cover: string | null;
}) {
  const frame = frames.find(item => item.image_id === active) || frames[0];
  return <section className="product-gallery" aria-label="商品图集">
    <div className="gallery-thumbnails" role="group" aria-label="商品图片">
      {frames.map(item => <button key={item.image_id} aria-pressed={item.image_id === frame?.image_id}
        aria-label={`查看${item.label}`} onClick={() => onChange(item.image_id)}>
        <span className="thumbnail-image"><GalleryImage src={item.url} fallback={cover} name="" cropped={item.cropped} /></span><span>{item.label}</span>
      </button>)}
    </div>
    <div className="gallery-main">
      <div className="gallery-art">{frame ? <GalleryImage key={frame.image_id} src={frame.url} fallback={cover} name={`${name}，${frame.label}`} cropped={frame.cropped} /> : <span className="image-placeholder">暂无商品图片</span>}</div>
      <p>{frame?.label || '商品图片'} · 原创 AI 演示图，颜色以所选规格说明为准。</p>
    </div>
  </section>;
}
