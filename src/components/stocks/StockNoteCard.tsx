import { useEffect, useState } from "react";
import { db } from "../../lib/db";
import { cutoffEnd, displayTimestamp, localDay } from "../../lib/stocks";
import type { StockNoteRevision, StockTimelineItem } from "../../types";
import { StockPictures } from "./StockPictures";
import { StockNoteTypeBadge } from "./StockNoteTypeBadge";

export function StockNoteCard({ item, cutoff, strict, related, disabled, onJump, onEdit, onReview, onDelete, onRestore }: {
  item: StockTimelineItem; cutoff: string; strict: boolean; related: StockTimelineItem[];
  disabled: boolean;
  onJump: (id: string) => void; onEdit: () => void; onReview: () => void; onDelete: () => void; onRestore: () => void;
}) {
  const { revision, note } = item;
  const [expanded, setExpanded] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [versions, setVersions] = useState<StockNoteRevision[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!historyOpen) return;
    let alive = true;
    db.stockRevisions.where("noteId").equals(note.id).toArray().then(result => {
      if (alive) setVersions(result.filter(version => !strict || !cutoff || Date.parse(version.publishedAt) <= cutoffEnd(cutoff)).sort((a, b) => b.revisionNumber - a.revisionNumber));
    }).catch(() => { if (alive) setError("历史版本加载失败，请重新展开重试"); });
    return () => { alive = false; };
  }, [historyOpen, note.currentRevisionId, cutoff, strict]);
  const backfilled = note.firstPublishedAt && localDay(note.firstPublishedAt) > localDay(revision.occurredAt);
  const reviews = related.filter(other => other.revision.reviewOfNoteId === note.id);
  return <article id={`stock-note-${note.id}`} className={`stock-note-card${revision.isKeyNode ? " key-node" : ""}`} aria-label={revision.title}>
    <div className="stock-note-meta"><time>{displayTimestamp(revision.occurredAt)}</time><StockNoteTypeBadge type={revision.type} />{revision.isKeyNode ? <strong>● 关键节点</strong> : null}<span>{backfilled ? `后补于 ${displayTimestamp(note.firstPublishedAt!)}` : "当日记录"}</span></div>
    <h3>{revision.title}</h3>
    {revision.revisionNumber > 1 ? <p className="stock-muted">版本 {revision.revisionNumber} · {revision.deleted ? "移入回收站于" : "修改于"} {displayTimestamp(revision.publishedAt)}</p> : null}
    <p className={`stock-note-text${expanded ? " expanded" : ""}`}>{revision.text || "图片记录"}</p>
    <div className="stock-note-meta"><span>当时态度：{revision.stance}</span>{revision.tags.map(tag => <span key={tag}>#{tag}</span>)}</div>
    {expanded && revision.images.length ? <StockPictures refs={revision.images} /> : null}
    {revision.reviewOfNoteId ? <button className="stock-text-button" type="button" onClick={() => onJump(revision.reviewOfNoteId!)}>↳ 查看复盘的原记录</button> : null}
    {reviews.length ? <div className="stock-related">后续复盘：{reviews.map(review => <button className="stock-text-button" type="button" key={review.note.id} onClick={() => onJump(review.note.id)}>{localDay(review.revision.occurredAt)} · {review.revision.title}</button>)}</div> : null}
    <div className="stock-card-footer"><span className="stock-muted">{revision.images.length} 张图片 · {item.versionCount} 个版本</span><div className="stock-actions">
      <button className="stock-text-button" type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? "收起详情" : "展开想法与图片"}</button>
      <button className="stock-text-button" type="button" aria-expanded={historyOpen} onClick={() => { setHistoryOpen(!historyOpen); setError(""); }}>历史版本</button>
    </div></div>
    {historyOpen ? <section className="stock-version-list" aria-label="历史版本">
      {error ? <p role="alert">{error}</p> : null}
      {versions.map(version => <details key={version.id}><summary>版本 {version.revisionNumber} · {displayTimestamp(version.publishedAt)}{version.deleted ? " · 移入回收站" : ""}</summary>
        <div className="stock-note-meta stock-version-meta"><span>记录时间 {displayTimestamp(version.occurredAt)}</span><StockNoteTypeBadge type={version.type} /><span>{version.stance}{version.isKeyNode ? " · 关键节点" : ""}</span></div>
        <h4>{version.title}</h4><p className="stock-note-text expanded">{version.text}</p><p>{version.tags.map(tag => `#${tag}`).join(" ")}</p>
        <VersionPictures version={version} />
      </details>)}
    </section> : null}
    <div className="stock-actions stock-card-actions">{strict && cutoff ? <span className="stock-muted">正在查看历史版本，清除回看日期后可编辑或复盘</span> : revision.deleted ? <button className="secondary icon-text-button" type="button" disabled={disabled} onClick={onRestore}>恢复记录</button> : <>
      <button className="icon-text-button" type="button" disabled={disabled} onClick={onEdit}>编辑记录</button>
      <button className="secondary icon-text-button" type="button" disabled={disabled} onClick={onReview}>追加复盘</button>
      <button className="stock-text-button" type="button" disabled={disabled} onClick={onDelete}>移入回收站</button>
    </>}</div>
  </article>;
}

function VersionPictures({ version }: { version: StockNoteRevision }) {
  const [shown, setShown] = useState(false);
  if (!version.images.length) return null;
  return <><button className="stock-text-button" type="button" onClick={() => setShown(!shown)}>{shown ? "收起版本图片" : `查看此版本的 ${version.images.length} 张图片`}</button>{shown ? <StockPictures refs={version.images} /> : null}</>;
}
