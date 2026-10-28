import { useEffect, useRef, useState } from 'react';
import { merchantMediaGateway } from '../api/merchantProduct.ts';
import { addDraftImage, draftImageKey, moveDraftImage } from '../lib/draftImages.ts';
import type { DraftImageChoice } from '../lib/draftImages.ts';
import type { ProductMediaAsset } from '../types/merchantProduct.ts';
function Preview({ url, alt }: { url: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  return <div className="draft-image-preview">{failed ? <span>图片暂不可用</span> : <img src={url} alt={alt} onError={() => setFailed(true)} />}</div>;
}
export function DraftImagesEditor({ images, disabled, onChange }: { images: DraftImageChoice[]; disabled: boolean; onChange: (images: DraftImageChoice[]) => void }) {
  const [reload, setReload] = useState(0), [library, setLibrary] = useState<{ status: 'loading' | 'ready' | 'error'; assets: ProductMediaAsset[]; error?: string }>({ status: 'loading', assets: [] });
  const items = useRef(new Map<string, HTMLLIElement>()), focusItem = useRef<string | null>(null), libraryHeading = useRef<HTMLHeadingElement>(null), retry = useRef<HTMLButtonElement>(null), focusRead = useRef(false);
  useEffect(() => {
    let current = true; setLibrary({ status: 'loading', assets: [] });
    void merchantMediaGateway.assets().then(assets => { if (current) setLibrary({ status: 'ready', assets }); })
      .catch(error => { if (current) setLibrary({ status: 'error', assets: [], error: error instanceof Error ? error.message : '素材库读取失败，请重试。' }); });
    return () => { current = false; };
  }, [reload]);
  useEffect(() => { if (focusRead.current && library.status !== 'loading') { focusRead.current = false; (library.status === 'error' ? retry.current : libraryHeading.current)?.focus({ preventScroll: true }); } }, [library]);
  useEffect(() => { if (focusItem.current !== null) { const key = focusItem.current; focusItem.current = null; (items.current.get(key) ?? libraryHeading.current)?.focus({ preventScroll: true }); } }, [images]);
  function change(next: DraftImageChoice[], key: string) { if (disabled) return; focusItem.current = key; onChange(next); }
  return <section className="draft-images merchant-draft-wide" aria-label="草稿图片管理"><h3>商品图片</h3><p className="workflow-muted">从演示素材库选图，保存草稿后生效。第一张是主图；移除图片不会删除素材。</p>
    {images.length ? <><ol className="draft-image-list" aria-label="已选图片，按展示顺序排列">{images.map((image, index) => <li key={draftImageKey(image)} ref={node => { if (node) items.current.set(draftImageKey(image), node); else items.current.delete(draftImageKey(image)); }} tabIndex={-1} aria-label={`图片${index + 1}${index === 0 ? '，主图' : ''}`}>
      <Preview key={image.url} url={image.url} alt={`草稿图片${index + 1}`} /><p>图片 {index + 1}{index === 0 && <strong className="draft-main-badge">主图</strong>}</p>
      <div className="draft-image-actions"><button className="button" type="button" disabled={disabled || index === 0} aria-label={`设为主图：图片${index + 1}`} onClick={() => change(moveDraftImage(images, index, 0), draftImageKey(image))}>设为主图</button>
        <button className="button" type="button" disabled={disabled || index === 0} aria-label={`前移：图片${index + 1}`} onClick={() => change(moveDraftImage(images, index, index - 1), draftImageKey(image))}>前移</button>
        <button className="button" type="button" disabled={disabled || index === images.length - 1} aria-label={`后移：图片${index + 1}`} onClick={() => change(moveDraftImage(images, index, index + 1), draftImageKey(image))}>后移</button>
        <button className="text-button" type="button" disabled={disabled} aria-label={`移除：图片${index + 1}`} onClick={() => { const next = images.filter((_, i) => i !== index); change(next, next[Math.min(index, next.length - 1)] ? draftImageKey(next[Math.min(index, next.length - 1)]) : ''); }}>移除</button></div>
    </li>)}</ol><button className="text-button" type="button" disabled={disabled} onClick={() => change([], '')}>移除全部图片</button></> : <p className="draft-images-empty">尚未选择图片，可保存为空图集。</p>}
    <h4 ref={libraryHeading} tabIndex={-1}>选择素材</h4>
    {library.status === 'loading' && <p role="status">正在读取演示素材库…</p>}
    {library.status === 'error' && <div className="cart-error" role="alert"><p>{library.error}</p><button ref={retry} className="button" type="button" disabled={disabled} onClick={() => { focusRead.current = true; setReload(n => n + 1); }}>重新读取素材库</button></div>}
    {library.status === 'ready' && (library.assets.length ? <div className="draft-media-grid" aria-label="可选演示素材">{library.assets.map((asset, index) => {
      const selected = images.some(image => image.asset_id === asset.asset_id);
      return <button className="draft-media-choice" type="button" key={asset.asset_id} disabled={disabled || selected} aria-label={`${selected ? '已选' : '添加'}素材${index + 1}`} onClick={() => { const next = addDraftImage(images, asset); change(next, draftImageKey(next[next.length - 1])); }}><Preview key={asset.url} url={asset.url} alt="" /><span>素材 {index + 1} · {selected ? '已选' : '添加'}</span></button>;
    })}</div> : <p className="workflow-muted">暂无可选图片素材。已保存图片仍保留。</p>)}
  </section>;
}
