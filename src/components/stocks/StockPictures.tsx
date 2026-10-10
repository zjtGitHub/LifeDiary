import { useEffect, useRef, useState } from "react";
import { db } from "../../lib/db";
import type { StockImageRef, StockNoteImage } from "../../types";

export function BlobPicture({ blob, alt, className }: { blob: Blob; alt: string; className?: string }) {
  const [url, setUrl] = useState("");
  useEffect(() => { const next = URL.createObjectURL(blob); setUrl(next); return () => URL.revokeObjectURL(next); }, [blob]);
  return url ? <img className={className} src={url} alt={alt} /> : null;
}

function PictureViewer({ images, refs, initial, onClose }: { images: StockNoteImage[]; refs: StockImageRef[]; initial: number; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [index, setIndex] = useState(initial);
  const touch = useRef<number | null>(null);
  const image = images[index];
  const caption = refs.find(ref => ref.id === image.id)?.caption;
  const move = (amount: number) => setIndex(current => (current + amount + images.length) % images.length);
  useEffect(() => {
    const node = dialog.current!; const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden"; node.showModal();
    return () => { node.close(); document.body.style.overflow = previous; };
  }, []);
  return <dialog className="stock-picture-viewer" ref={dialog} aria-label="图片大图预览"
    onCancel={event => { event.preventDefault(); onClose(); }}
    onKeyDown={event => { if (event.key === "ArrowLeft") move(-1); if (event.key === "ArrowRight") move(1); }}>
    <div className="stock-picture-toolbar"><span>{index + 1} / {images.length} · {image.name}</span><button type="button" className="icon-text-button" onClick={onClose}>关闭图片</button></div>
    <div onTouchStart={event => { touch.current = event.touches[0].clientX; }} onTouchEnd={event => {
      if (touch.current !== null && Math.abs(event.changedTouches[0].clientX - touch.current) > 50) move(event.changedTouches[0].clientX < touch.current ? 1 : -1);
      touch.current = null;
    }}><BlobPicture blob={image.blob} alt={caption || image.name} /></div>
    {caption ? <p>{caption}</p> : null}
    <div className="stock-picture-controls"><button type="button" className="secondary icon-text-button" disabled={images.length < 2} onClick={() => move(-1)}>上一张</button><button type="button" className="secondary icon-text-button" disabled={images.length < 2} onClick={() => move(1)}>下一张</button></div>
  </dialog>;
}

export function StockPictures({ refs, onChange }: { refs: StockImageRef[]; onChange?: (refs: StockImageRef[]) => void }) {
  const [images, setImages] = useState<StockNoteImage[]>([]);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [view, setView] = useState<number | null>(null);
  const ids = refs.map(ref => ref.id).join(",");
  useEffect(() => {
    let alive = true; setFailed(false);
    db.stockImages.bulkGet(refs.map(ref => ref.id)).then(result => {
      if (alive) { setImages(result.filter((item): item is StockNoteImage => Boolean(item))); setFailed(result.some(item => !item)); }
    }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [ids, retry]);
  return <>
    {failed ? <p role="alert">部分图片加载失败。<button type="button" onClick={() => setRetry(retry + 1)}>重试</button></p> : null}
    <div className="stock-images">{images.map((image, index) => {
      const ref = refs.find(item => item.id === image.id)!;
      return <figure key={image.id}>
        <button className="stock-image-preview" type="button" onClick={() => setView(index)} aria-label={`查看图片：${image.name}`}><BlobPicture blob={image.thumbnail} alt={ref.caption || image.name} /></button>
        <figcaption>{onChange ? <>
          <input aria-label={`图片说明：${image.name}`} value={ref.caption} placeholder="图片说明" onChange={event => onChange(refs.map(item => item.id === image.id ? { ...item, caption: event.target.value } : item))} />
          <button type="button" onClick={() => onChange(refs.filter(item => item.id !== image.id))}>移除图片</button>
        </> : ref.caption || image.name}</figcaption>
      </figure>;
    })}</div>
    {view !== null && images[view] ? <PictureViewer images={images} refs={refs} initial={view} onClose={() => setView(null)} /> : null}
  </>;
}
