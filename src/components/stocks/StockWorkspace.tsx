import { useEffect, useState } from "react";
import { BookOpenText } from "lucide-react";
import { db } from "../../lib/db";
import { AppLink, navigate } from "../../lib/router";
import { addStock, displayTimestamp } from "../../lib/stocks";
import type { Stock, StockNote } from "../../types";
import { DataBackup } from "../DataBackup";
import { StockDetail } from "./StockDetail";

export function StockWorkspace({ stockId }: { stockId?: string }) {
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [notes, setNotes] = useState<StockNote[]>([]);
  const [version, setVersion] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [archived, setArchived] = useState(false);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [market, setMarket] = useState("SH");
  const [customMarket, setCustomMarket] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let alive = true;
    Promise.all([db.stocks.toArray(), db.stockNotes.toArray()]).then(([nextStocks, nextNotes]) => {
      if (alive) { setStocks(nextStocks); setNotes(nextNotes); setLoaded(true); setError(""); }
    }).catch(() => { if (alive) { setError("股票列表加载失败，请重试"); setLoaded(true); } });
    return () => { alive = false; };
  }, [version]);
  const refresh = () => setVersion(previous => previous + 1);
  const selected = stocks.find(stock => stock.id === stockId);
  const latest = (stock: Stock) => notes.filter(note => note.stockId === stock.id).reduce((time, note) => note.updatedAt > time ? note.updatedAt : time, stock.updatedAt);
  const filtered = stocks.filter(stock => Boolean(stock.archivedAt) === archived && `${stock.name} ${stock.code ?? ""} ${stock.market}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || latest(b).localeCompare(latest(a)));
  return <main className={`app-shell stock-workspace${stockId ? " has-selected-stock" : ""}`}>
    <header className="app-header"><div><p className="eyebrow">观察 · 判断 · 回顾</p><h1>股票备忘录</h1><p className="page-description">记录判断，也记录自己如何改变。</p></div><p className="page-header-note">每一次记录，都是认识的一部分。</p></header>
    {notice ? <p className="stock-notice" role="status">{notice}<button type="button" className="stock-text-button" onClick={() => setNotice("")}>知道了</button></p> : null}
    <div className="stock-workspace-grid">
      <aside className="stock-library" aria-label="股票列表">
        <section className="panel stock-library-panel">
          <div className="section-heading"><h2>我的股票</h2><button className="secondary icon-text-button" type="button" onClick={() => setAdding(!adding)}>{adding ? "收起" : "添加股票"}</button></div>
          {adding ? <form className="stock-add-form" onSubmit={async event => {
            event.preventDefault(); setSaving(true); setError("");
            try {
              const result = await addStock(name, market === "custom" ? customMarket : market, code);
              setNotice(result.existing ? "这只股票已存在，已打开已有档案。" : "股票已添加，可以开始记录。" );
              setArchived(Boolean(result.stock.archivedAt)); setQuery(""); setAdding(false); setName(""); setCode(""); refresh(); navigate(`/stocks/${result.stock.id}`);
            } catch (cause) { setError(cause instanceof Error ? cause.message : "添加失败，请重试"); }
            finally { setSaving(false); }
          }}>
            <label>股票名称<input value={name} onChange={event => setName(event.target.value)} required placeholder="例如：某某科技" /></label>
            <label>市场<select value={market} onChange={event => setMarket(event.target.value)}><option value="SH">沪市 · SH</option><option value="SZ">深市 · SZ</option><option value="HK">港股 · HK</option><option value="US">美股 · US</option><option value="custom">自定义市场</option></select></label>
            {market === "custom" ? <label>市场标识<input value={customMarket} onChange={event => setCustomMarket(event.target.value)} required placeholder="填写市场标识" /></label> : null}
            <label>股票代码（选填）<input value={code} onChange={event => setCode(event.target.value)} placeholder="可留空" /></label>
            <button className="primary icon-text-button" disabled={saving}>{saving ? "添加中…" : "保存股票"}</button>
          </form> : null}
          <label className="stock-search-label">查找股票<input value={query} onChange={event => setQuery(event.target.value)} placeholder="名称、代码或市场" /></label>
          <div className="stock-library-tabs"><button type="button" aria-pressed={!archived} onClick={() => setArchived(false)}>关注中</button><button type="button" aria-pressed={archived} onClick={() => setArchived(true)}>已归档</button></div>
          {error ? <p role="alert" className="form-error">{error}<button type="button" onClick={refresh}>重试</button></p> : null}
          {!loaded ? <p role="status">正在加载股票…</p> : filtered.length ? <div className="stock-list">{filtered.map(stock => {
            const stockNotes = notes.filter(note => note.stockId === stock.id);
            const count = stockNotes.filter(note => note.firstPublishedAt && !note.deletedAt).length;
            const drafts = stockNotes.filter(note => note.draft && !note.deletedAt).length;
            return <AppLink href={`/stocks/${stock.id}`} className={`stock-list-item${stockId === stock.id ? " selected" : ""}`} aria-current={stockId === stock.id ? "page" : undefined} key={stock.id}>
              <strong>{stock.pinned ? "置顶 · " : ""}{stock.name}</strong><span>{stock.market}{stock.code ? ` · ${stock.code}` : ""}</span><small>{count} 条记录{drafts ? ` · ${drafts} 条草稿` : ""}</small><small>最近更新 {displayTimestamp(latest(stock))}</small>
            </AppLink>;
          })}</div> : <div className="stock-list-empty"><p>{query ? "没有找到股票" : archived ? "还没有归档的股票" : "还没有关注的股票"}</p>{!archived && !query ? <button className="stock-text-button" type="button" onClick={() => setAdding(true)}>添加第一只股票</button> : null}</div>}
        </section>
        <DataBackup />
      </aside>
      {selected ? <StockDetail key={stockId} stock={selected} version={version} onChanged={refresh} /> : <section className="panel stock-empty stock-select-empty"><span className="stock-empty-mark" aria-hidden="true"><BookOpenText size={32} strokeWidth={1.3} /></span><h2>{stockId && loaded ? "这只股票不存在" : "每只股票，一段认识的历程"}</h2><p>{stockId && loaded ? "股票可能尚未恢复到当前浏览器，请检查备份或返回列表。" : "从左侧选择一只股票，按时间查看想法、图片和关键节点。"}</p>{stockId ? <AppLink href="/stocks">返回股票列表</AppLink> : null}</section>}
    </div>
  </main>;
}
