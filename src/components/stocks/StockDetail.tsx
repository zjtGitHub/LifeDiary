import { useEffect, useState } from "react";
import { db } from "../../lib/db";
import { AppLink } from "../../lib/router";
import { createStockDraft, displayTimestamp, listStockTimeline, localDay, setStockNoteDeleted, startStockEdit, updateStock, type StockFilters } from "../../lib/stocks";
import type { Stock, StockNote, StockTimelineItem } from "../../types";
import { StockEditor } from "./StockEditor";
import { StockNoteCard } from "./StockNoteCard";

export function StockDetail({ stock, version, onChanged }: { stock: Stock; version: number; onChanged: () => void }) {
  const [filters, setFilters] = useState<StockFilters>({});
  const [items, setItems] = useState<StockTimelineItem[]>([]);
  const [available, setAvailable] = useState<StockTimelineItem[]>([]);
  const [drafts, setDrafts] = useState<StockNote[]>([]);
  const [editor, setEditor] = useState<StockNote | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [limit, setLimit] = useState(30);
  const [focusId, setFocusId] = useState("");
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(stock.name);
  useEffect(() => {
    let alive = true; setLoading(true);
    Promise.all([
      listStockTimeline(stock.id, filters),
      listStockTimeline(stock.id, { cutoff: filters.cutoff, strict: filters.strict, trash: filters.trash }),
      db.stockNotes.where("stockId").equals(stock.id).filter(note => note.draft !== null && !note.deletedAt).toArray()
    ]).then(([next, all, nextDrafts]) => { if (alive) { setItems(next); setAvailable(all); setDrafts(nextDrafts.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))); } })
      .catch(() => { if (alive) setError("记录加载失败，请重试"); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [stock.id, version, filters]);
  useEffect(() => { setLimit(30); }, [filters]);
  useEffect(() => {
    if (focusId && !loading) {
      const index = items.findIndex(item => item.note.id === focusId);
      if (index >= limit) { setLimit(index + 1); return; }
      document.getElementById(`stock-note-${focusId}`)?.scrollIntoView?.({ block: "center" });
    }
  }, [focusId, items, loading, limit]);
  const act = async (operation: () => Promise<unknown>) => {
    setBusy(true); setError("");
    try { await operation(); onChanged(); } catch (cause) { setError(cause instanceof Error ? cause.message : "操作失败，请重试"); }
    finally { setBusy(false); }
  };
  const openNew = (reviewId: string | null = null) => void act(async () => { setEditor(await createStockDraft(stock.id, reviewId)); });
  const openEdit = (id: string) => void act(async () => { setEditor(await startStockEdit(id)); });
  const changeFilter = (patch: StockFilters) => { setFocusId(""); setFilters(previous => ({ ...previous, ...patch })); };
  const jump = (id: string) => void act(async () => {
    const target = await db.stockNotes.get(id);
    if (!target || target.stockId !== stock.id) throw new Error("关联记录不存在");
    setFilters({ trash: Boolean(target.deletedAt) }); setFocusId(id);
  });
  const dates = available.map(item => localDay(item.revision.occurredAt));
  const years = Array.from(new Set(dates.map(date => date.slice(0, 4)))).sort().reverse();
  const months = Array.from(new Set(dates.filter(date => !filters.year || date.startsWith(filters.year)).map(date => date.slice(5, 7)))).sort();
  const filteredView = Boolean(filters.cutoff || filters.query?.trim() || filters.year || filters.month || filters.keyOnly);
  return <section className="stock-detail" aria-label="股票详情">
    <AppLink className="stock-mobile-back" href="/stocks">← 返回股票列表</AppLink>
    <header className="stock-detail-header"><div><p className="eyebrow">{stock.archivedAt ? "已归档 · 仍可记录与回顾" : "我的股票档案"}</p><h1>{stock.name}</h1><p className="stock-muted">{stock.market} · {stock.code}</p></div>
      <button className="primary icon-text-button" type="button" disabled={busy || Boolean(editor)} onClick={() => openNew()}>＋ 新增记录</button>
    </header>
    <div className="stock-actions stock-management">
      <button className="stock-text-button" type="button" disabled={busy} onClick={() => { setName(stock.name); setRenaming(!renaming); }}>修改名称</button>
      <button className="stock-text-button" type="button" disabled={busy} onClick={() => void act(() => updateStock(stock.id, { pinned: !stock.pinned }))}>{stock.pinned ? "取消置顶" : "置顶股票"}</button>
      <button className="stock-text-button" type="button" disabled={busy} onClick={() => void act(() => updateStock(stock.id, { archivedAt: stock.archivedAt ? null : new Date().toISOString() }))}>{stock.archivedAt ? "恢复关注" : "归档股票"}</button>
    </div>
    {renaming ? <form className="stock-rename" onSubmit={event => { event.preventDefault(); void act(async () => { await updateStock(stock.id, { name }); setRenaming(false); }); }}><label>股票新名称<input value={name} onChange={event => setName(event.target.value)} required /></label><button className="secondary icon-text-button" disabled={busy}>保存名称</button></form> : null}
    {error ? <p className="form-error" role="alert">{error} <button type="button" onClick={() => { setError(""); onChanged(); }}>重试</button></p> : null}
    {editor ? <StockEditor key={editor.id} note={editor} onClose={() => { setEditor(null); onChanged(); }} onPublished={() => { setEditor(null); setFilters({}); onChanged(); }} /> : drafts.length ? <details className="stock-drafts"><summary>继续草稿 · {drafts.length} 条</summary>{drafts.map(draft => <button type="button" className="stock-draft-item" key={draft.id} onClick={() => setEditor(draft)}>{draft.draft?.title || draft.draft?.text.slice(0, 40) || "未命名草稿"}<small>{displayTimestamp(draft.updatedAt)}{draft.firstPublishedAt ? " · 编辑中的记录" : " · 未发布"}</small></button>)}</details> : null}
    <details className="stock-filters" open><summary>筛选与时间回看</summary><div className="stock-filter-grid">
      <label>搜索记录<input value={filters.query ?? ""} placeholder="标题、正文或标签" onChange={event => changeFilter({ query: event.target.value })} /></label>
      <label>年份<select value={filters.year ?? ""} onChange={event => changeFilter({ year: event.target.value, month: "" })}><option value="">全部年份</option>{years.map(year => <option key={year} value={year}>{year} 年</option>)}</select></label>
      <label>月份<select value={filters.month ?? ""} onChange={event => changeFilter({ month: event.target.value })}><option value="">全部月份</option>{months.map(month => <option key={month} value={month}>{Number(month)} 月</option>)}</select></label>
      <label>回看截至<input type="date" value={filters.cutoff ?? ""} onChange={event => changeFilter({ cutoff: event.target.value })} /></label>
    </div><div className="stock-actions stock-filter-checks">
      <label className="stock-check"><input type="checkbox" checked={Boolean(filters.keyOnly)} onChange={event => changeFilter({ keyOnly: event.target.checked })} />只看关键节点</label>
      <label className="stock-check"><input type="checkbox" checked={Boolean(filters.strict)} onChange={event => changeFilter({ strict: event.target.checked })} />只看当时已保存</label>
      <button className="stock-text-button" type="button" onClick={() => changeFilter({ trash: !filters.trash, cutoff: "", strict: false, year: "", month: "" })}>{filters.trash ? "返回全部记录" : "回收站"}</button>
      <button className="stock-text-button" type="button" onClick={() => setFilters({})}>清除筛选</button>
    </div></details>
    <p className="stock-timeline-status" role="status">{filters.trash ? "回收站" : filters.cutoff ? `截至 ${filters.cutoff}` : "全部时间"} · {loading ? "加载中…" : `${items.length} 条记录`}{filters.strict && filters.cutoff ? " · 还原当时已保存的版本" : ""}</p>
    {!loading && filters.cutoff && items.length && !items.some(item => localDay(item.revision.occurredAt) === filters.cutoff) ? <p className="stock-muted">当天没有匹配记录，最近一次记录于 {displayTimestamp(items[0].revision.occurredAt)}</p> : null}
    {!loading && !items.length ? <div className="panel stock-empty"><h2>{filters.trash ? "回收站为空" : filteredView ? "没有符合条件的记录" : "从一次想法开始"}</h2><p>{filters.trash ? "移入回收站的记录可随时恢复。" : filteredView ? "这个时点或筛选条件下没有记录，可以调整日期或清除筛选。" : "写下判断、保存依据，未来再回来看看自己的认识如何变化。"}</p>{filteredView ? <button className="secondary icon-text-button" type="button" onClick={() => setFilters({})}>查看全部记录</button> : !editor && !filters.trash ? <button className="secondary icon-text-button" type="button" disabled={busy} onClick={() => openNew()}>写下第一次认识</button> : null}</div> : null}
    <div className="stock-timeline" aria-label="股票记录时间轴">{items.slice(0, limit).map((item, index) => {
      const month = localDay(item.revision.occurredAt).slice(0, 7);
      return <div key={item.note.id}>{index === 0 || localDay(items[index - 1].revision.occurredAt).slice(0, 7) !== month ? <h2 className="stock-month-heading">{month.replace("-", " 年 ")} 月</h2> : null}
        <StockNoteCard item={item} cutoff={filters.cutoff ?? ""} strict={Boolean(filters.strict)} related={available} disabled={busy || loading || Boolean(editor)}
          onJump={jump} onEdit={() => openEdit(item.note.id)} onReview={() => openNew(item.note.id)}
          onDelete={() => void act(() => setStockNoteDeleted(item.note.id, true))} onRestore={() => void act(() => setStockNoteDeleted(item.note.id, false))} />
      </div>;
    })}</div>
    {items.length > limit ? <button className="secondary icon-text-button" type="button" onClick={() => setLimit(limit + 30)}>加载更多记录</button> : null}
  </section>;
}
