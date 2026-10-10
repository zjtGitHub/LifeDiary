import { useId, useRef, useState } from "react";
import { localDateTime, publishStockNote, saveStockDraft, stockNoteTypes, stockStances } from "../../lib/stocks";
import { MAX_STOCK_IMAGES, stockImageTypes, storeStockImages } from "../../lib/stock-images";
import type { StockNote, StockNoteContent } from "../../types";
import { StockPictures } from "./StockPictures";
import { StockNoteTypeBadge } from "./StockNoteTypeBadge";

export function StockEditor({ note, onClose, onPublished }: { note: StockNote; onClose: () => void; onPublished: () => void }) {
  const typeGroupId = useId();
  const [content, setContent] = useState(note.draft!);
  const latest = useRef(content);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const sequence = useRef(0);
  const [status, setStatus] = useState("草稿已保存");
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [publishing, setPublishing] = useState(false);

  const persist = (next: StockNoteContent) => {
    latest.current = next; setContent(next); setStatus("保存草稿中…");
    const request = ++sequence.current;
    // Enqueue the IndexedDB transaction immediately, before a route change can read this draft.
    queue.current = saveStockDraft(note.id, next);
    void queue.current.then(() => { if (request === sequence.current) { setStatus("草稿已保存"); setError(""); } }).catch(() => { if (request === sequence.current) setStatus("草稿保存失败，请重试"); });
  };
  const change = (patch: Partial<StockNoteContent>) => persist({ ...latest.current, ...patch });
  const close = async () => {
    try { await queue.current.catch(() => {}); await saveStockDraft(note.id, latest.current); onClose(); }
    catch { setStatus("草稿保存失败，请重试"); }
  };
  const publish = async () => {
    setPublishing(true); setError("");
    try { await queue.current.catch(() => {}); await saveStockDraft(note.id, latest.current); await publishStockNote(note.id); onPublished(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "发布失败，请重试"); }
    finally { setPublishing(false); }
  };
  return <section className="panel stock-editor" aria-label="股票记录编辑器">
    <div className="section-heading"><div><p className="eyebrow">{content.reviewOfNoteId ? "追加复盘" : note.firstPublishedAt ? "编辑记录 · 保留旧版本" : "记录此刻的想法"}</p><h2>{note.firstPublishedAt ? "编辑记录" : "新记录"}</h2></div><span className="save-status" role="status">{status}</span></div>
    {status.includes("失败") ? <button className="secondary icon-text-button" type="button" onClick={() => persist(latest.current)}>重新保存草稿</button> : null}
    <fieldset disabled={publishing}>
      <div className="stock-form-grid">
        <label>记录时间<input type="datetime-local" aria-label="记录时间" value={content.occurredAt ? localDateTime(content.occurredAt) : ""} onChange={event => change({ occurredAt: event.target.value ? new Date(event.target.value).toISOString() : "" })} /></label>
        <div className="stock-type-field"><span id={typeGroupId}>记录类型</span><div className="stock-type-options" role="radiogroup" aria-labelledby={typeGroupId}>
          {stockNoteTypes.map(type => <label className="stock-type-option" key={type}><input type="radio" name={typeGroupId} value={type} aria-label={type} checked={content.type === type} onChange={() => change({ type })} /><StockNoteTypeBadge type={type} /></label>)}
        </div></div>
        <label className="stock-form-wide">标题<input value={content.title} placeholder="选填，例如：一次让我改变看法的产品体验" onChange={event => change({ title: event.target.value })} /></label>
        <label className="stock-form-wide">当下的理解<textarea rows={7} value={content.text} placeholder="当下的结论是什么？依据有哪些？哪些还是假设，什么会让我改变看法？" onChange={event => change({ text: event.target.value })} /></label>
        <label>当时态度<select value={content.stance} onChange={event => change({ stance: event.target.value as StockNoteContent["stance"] })}>{stockStances.map(stance => <option key={stance}>{stance}</option>)}</select></label>
        <label>标签<input value={content.tags.join("，")} placeholder="用逗号分隔，例如：产品，风险" onChange={event => change({ tags: event.target.value.split(/[,，]/) })} /></label>
      </div>
      <label className="stock-check"><input type="checkbox" checked={content.isKeyNode} onChange={event => change({ isKeyNode: event.target.checked })} />标记为关键节点</label>
      <div className="stock-editor-images"><label className="secondary icon-text-button upload-button">{uploading ? "正在处理图片…" : "添加图片"}
        <input type="file" accept={stockImageTypes.join(",")} multiple disabled={uploading} onChange={async event => {
          const files = Array.from(event.target.files ?? []); event.target.value = ""; if (!files.length) return;
          if (latest.current.images.length + files.length > MAX_STOCK_IMAGES) { setError("每条记录最多 20 张图片"); return; }
          setUploading(true); setError("");
          try { const images = await storeStockImages(files); change({ images: [...latest.current.images, ...images.map(image => ({ id: image.id, caption: "" }))] }); }
          catch (cause) { setError(cause instanceof Error ? cause.message : "图片上传失败，请重试"); }
          finally { setUploading(false); }
        }} />
      </label><span className="stock-muted">每张最多 15 MB，最多 20 张</span></div>
      {content.images.length ? <StockPictures refs={content.images} onChange={images => change({ images })} /> : null}
    </fieldset>
    {error ? <p role="alert" className="form-error">{error}</p> : null}
    <div className="stock-actions"><button type="button" className="primary icon-text-button" disabled={uploading || publishing} onClick={() => void publish()}>{publishing ? "正在发布…" : "加入时间轴"}</button><button type="button" className="icon-text-button" disabled={uploading || publishing} onClick={() => void close()}>关闭并保留草稿</button></div>
  </section>;
}
