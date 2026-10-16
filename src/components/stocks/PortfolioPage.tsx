import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, BarChart3, Camera, ChevronDown, Clock3, Upload } from "lucide-react";
import { addStock } from "../../lib/stocks";
import { AppLink, navigate } from "../../lib/router";
import { listPortfolioSnapshots, savePortfolioSnapshot } from "../../lib/db";
import {
  concentrationLabel,
  formatPortfolioMoney,
  formatPortfolioMoneyExact,
  formatPortfolioPct,
  parsePortfolioSnapshotJson,
  portfolioCashPct,
  portfolioStrategyLabel,
  portfolioTickerExposure,
  type PortfolioSnapshotImport
} from "../../lib/portfolio-data";
import type { PortfolioSnapshot, Stock } from "../../types";

type HistoryRange = "7" | "30" | "90" | "all";
type PortfolioTab = "today" | "history" | "changes";

export function PortfolioPage({ stocks, snapshotId, onChanged }: { stocks: Stock[]; snapshotId?: string; onChanged: () => void }) {
  const [snapshots, setSnapshots] = useState<PortfolioSnapshot[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [tab, setTab] = useState<PortfolioTab>("today");
  const [historyRange, setHistoryRange] = useState<HistoryRange>("30");
  const [importOpen, setImportOpen] = useState(false);
  const [jsonText, setJsonText] = useState("");
  const [preview, setPreview] = useState<PortfolioSnapshotImport | null>(null);
  const [importError, setImportError] = useState("");
  const [duplicateChoice, setDuplicateChoice] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingStock, setSavingStock] = useState("");

  const refresh = () => void listPortfolioSnapshots().then(setSnapshots).catch(() => setLoadError("快照加载失败，请重试")).finally(() => setLoaded(true));
  useEffect(() => { let alive = true; listPortfolioSnapshots().then(items => { if (alive) setSnapshots(items); }).catch(() => { if (alive) setLoadError("快照加载失败，请重试"); }).finally(() => { if (alive) setLoaded(true); }); return () => { alive = false; }; }, []);
  const snapshot = snapshots.find(item => item.id === snapshotId);
  const latest = snapshots[0];
  const dayDuplicates = preview ? snapshots.filter(item => item.snapshotDate === preview.snapshotDate) : [];

  const closeImporter = () => { setImportOpen(false); setPreview(null); setImportError(""); setDuplicateChoice(false); };
  const previewImport = () => {
    setImportError(""); setDuplicateChoice(false);
    try { setPreview(parsePortfolioSnapshotJson(jsonText)); }
    catch (error) { setPreview(null); setImportError(error instanceof Error ? error.message : "无法解析 JSON，请检查格式"); }
  };
  const persistImport = async (replaceDate = false) => {
    if (!preview) return;
    setSaving(true); setImportError("");
    try {
      await savePortfolioSnapshot(preview, replaceDate);
      closeImporter();
      refresh();
      window.dispatchEvent(new Event("diary-data-changed"));
      onChanged();
    } catch (error) { setImportError(error instanceof Error ? error.message : "保存失败，请重试"); }
    finally { setSaving(false); }
  };
  const savePreview = () => {
    if (dayDuplicates.length && !duplicateChoice) { setDuplicateChoice(true); return; }
    void persistImport(false);
  };
  const createStockArchive = async (symbol: string) => {
    setSavingStock(symbol);
    try {
      const result = await addStock(symbol, "US", symbol);
      onChanged();
      navigate(`/stocks/${result.stock.id}`);
    } catch (error) { setLoadError(error instanceof Error ? error.message : "创建股票档案失败"); }
    finally { setSavingStock(""); }
  };

  return <section className="portfolio-page" aria-label="我的投资组合">
    <AppLink className="stock-mobile-back" href="/stocks">← 返回股票列表</AppLink>
    {snapshotId ? snapshot ? <SnapshotDetail snapshot={snapshot} stocks={stocks} onCreateStock={createStockArchive} savingStock={savingStock} /> : !loaded ? <section className="panel portfolio-empty"><h2>正在加载快照…</h2></section> : <section className="panel portfolio-empty"><h2>找不到这份快照</h2><p>快照可能已从备份恢复或当前浏览器中不存在。</p><AppLink className="secondary icon-text-button" href="/stocks/portfolio">返回组合档案</AppLink></section>
      : <>
        <header className="portfolio-header">
          <div><p className="eyebrow">账户档案 · 每日留存</p><h1><BarChart3 size={25} aria-hidden="true" />我的投资组合</h1><p className="stock-muted">保存每个时点的持仓结构，回看资金如何迁移。</p></div>
          <button className="primary icon-text-button" type="button" onClick={() => { setImportOpen(true); setImportError(""); setPreview(null); setJsonText(""); }}><Upload size={17} aria-hidden="true" />导入快照</button>
        </header>
        <div className="portfolio-tabs" role="tablist" aria-label="组合视图">
          <button type="button" role="tab" aria-selected={tab === "today"} onClick={() => setTab("today")}>今日总览</button>
          <button type="button" role="tab" aria-selected={tab === "history"} onClick={() => setTab("history")}>历史快照</button>
          <button type="button" role="tab" aria-selected={tab === "changes"} onClick={() => setTab("changes")}>仓位变化</button>
        </div>
        {loadError ? <p className="form-error" role="alert">{loadError}<button type="button" onClick={refresh}>重试</button></p> : null}
        {!latest ? <section className="panel portfolio-empty"><span className="stock-empty-mark" aria-hidden="true"><Camera size={30} strokeWidth={1.4} /></span><h2>暂无账户快照</h2><p>粘贴一份 IBKR JSON，预览后保存。每份快照都会保留当时的持仓、价格和权重。</p><button className="primary icon-text-button" type="button" onClick={() => setImportOpen(true)}><Upload size={16} />导入第一份快照</button></section>
          : tab === "today" ? <SnapshotOverview snapshot={latest} stocks={stocks} onCreateStock={createStockArchive} savingStock={savingStock} />
            : tab === "history" ? <SnapshotHistory snapshots={snapshots} />
              : <PositionChanges snapshots={snapshots} range={historyRange} setRange={setHistoryRange} />}
      </>}
    {importOpen ? <div className="portfolio-overlay" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !saving) closeImporter(); }}>
      <section className="panel portfolio-dialog" role="dialog" aria-modal="true" aria-labelledby="portfolio-import-title">
        <div className="section-heading"><div><p className="eyebrow">IBKR · JSON 手动导入</p><h2 id="portfolio-import-title">{preview ? "确认导入内容" : "导入投资组合快照"}</h2></div><button className="stock-text-button" type="button" disabled={saving} onClick={closeImporter}>关闭</button></div>
        {!preview ? <>
          <p className="stock-muted">粘贴包含 schema_version、snapshot_date、account、stocks 和 option_strategies 的 JSON。解析后先预览，再保存到历史记录。</p>
          <label className="portfolio-json-label">快照 JSON<textarea value={jsonText} onChange={event => setJsonText(event.target.value)} spellCheck={false} placeholder={'{\n  "schema_version": 1,\n  "snapshot_date": "2026-10-16",\n  "snapshot_time": "11:06:00",\n  "broker": "IBKR",\n  "currency": "USD",\n  "account": { "nav": 156597.63, "cash": 43926.30, "leverage": 0.86 },\n  "stocks": [],\n  "option_strategies": []\n}'} /></label>
          {importError ? <p className="form-error" role="alert">{importError}</p> : null}
          <div className="stock-actions portfolio-dialog-actions"><button className="secondary icon-text-button" type="button" onClick={closeImporter}>取消</button><button className="primary icon-text-button" type="button" disabled={!jsonText.trim()} onClick={previewImport}>解析并预览</button></div>
        </> : <>
          <div className="portfolio-preview-summary"><strong>{preview.snapshotDate} {preview.snapshotTime}</strong><span>{preview.broker} · {preview.currency}</span><b>{formatPortfolioMoney(preview.account.nav, preview.currency)} NAV</b><span>现金 {formatPortfolioMoney(preview.account.cash, preview.currency)} · 杠杆 {preview.account.leverage.toFixed(2)}x</span></div>
          <div className="portfolio-preview-grid"><div><h3>正股 · {preview.stocks.length}</h3>{preview.stocks.length ? preview.stocks.map(stock => <p key={stock.symbol}>{stock.symbol}<span>{stock.quantity} 股 · {formatPortfolioPct(stock.portfolioWeightPct)}</span></p>) : <p className="stock-muted">空仓</p>}</div><div><h3>期权策略 · {preview.optionStrategies.length}</h3>{preview.optionStrategies.length ? preview.optionStrategies.map(strategy => <p key={strategy.id}>{strategy.symbol} · {strategy.strategy}<span>{strategy.quantity} 组</span></p>) : <p className="stock-muted">无策略</p>}</div></div>
          {preview.note ? <p className="stock-muted">备注：{preview.note}</p> : null}
          {duplicateChoice ? <div className="portfolio-duplicate-notice" role="group" aria-label="同日快照处理方式"><strong>{preview.snapshotDate} 已有 {dayDuplicates.length} 份快照</strong><span>可以保留历史并再存一份，或覆盖当天已有快照。</span><div className="stock-actions"><button className="secondary icon-text-button" type="button" disabled={saving} onClick={() => void persistImport(true)}>覆盖当天快照</button><button className="primary icon-text-button" type="button" disabled={saving} onClick={() => void persistImport(false)}>另存为新快照</button><button className="stock-text-button" type="button" disabled={saving} onClick={() => setDuplicateChoice(false)}>返回修改</button></div></div> : <div className="stock-actions portfolio-dialog-actions"><button className="secondary icon-text-button" type="button" disabled={saving} onClick={() => setPreview(null)}>返回修改</button><button className="primary icon-text-button" type="button" disabled={saving} onClick={savePreview}>{saving ? "保存中…" : dayDuplicates.length ? "确认保存" : "确认保存快照"}</button></div>}
          {importError ? <p className="form-error" role="alert">{importError}</p> : null}
        </>}
      </section>
    </div> : null}
  </section>;
}

function SnapshotOverview({ snapshot, stocks, onCreateStock, savingStock }: { snapshot: PortfolioSnapshot; stocks: Stock[]; onCreateStock: (symbol: string) => void; savingStock: string }) {
  const exposure = portfolioTickerExposure(snapshot);
  const maxExposure = exposure[0];
  const stockValue = snapshot.stocks.reduce((sum, stock) => sum + stock.marketValue, 0);
  const optionValue = snapshot.optionStrategies.reduce((sum, strategy) => sum + strategy.marketValue, 0);
  const stockArchives = new Map(stocks.map(stock => [(stock.code || stock.name).toUpperCase(), stock]));
  return <>
    <div className="portfolio-asof"><Clock3 size={15} aria-hidden="true" />快照时间 {snapshot.snapshotDate} {snapshot.snapshotTime} · {snapshot.broker}</div>
    <div className="portfolio-metrics">
      <Metric label="总资产 NAV" value={formatPortfolioMoney(snapshot.account.nav, snapshot.currency)} />
      <Metric label="现金" value={formatPortfolioMoney(snapshot.account.cash, snapshot.currency)} detail={`现金占比 ${formatPortfolioPct(portfolioCashPct(snapshot))}`} />
      <Metric label="杠杆" value={`${snapshot.account.leverage.toFixed(2)}x`} />
      <Metric label="正股市值" value={formatPortfolioMoney(snapshot.stocks.reduce((sum, stock) => sum + stock.marketValue, 0), snapshot.currency)} detail={`${snapshot.stocks.length} 只`} />
      <Metric label="期权净值" value={formatPortfolioMoney(optionValue, snapshot.currency)} detail={`${snapshot.optionStrategies.length} 个策略`} />
    </div>
    {(snapshot.account.buyingPower !== undefined || snapshot.account.availableFunds !== undefined) ? <div className="portfolio-secondary-metrics">{snapshot.account.buyingPower !== undefined ? <span>购买力 {formatPortfolioMoneyExact(snapshot.account.buyingPower, snapshot.currency)}</span> : null}{snapshot.account.availableFunds !== undefined ? <span>可用资金 {formatPortfolioMoneyExact(snapshot.account.availableFunds, snapshot.currency)}</span> : null}</div> : null}
    <section className="panel portfolio-section"><div className="section-heading"><div><p className="eyebrow">账户配置</p><h2>正股仓位</h2></div><span className="stock-muted">合计 {formatPortfolioMoney(stockValue, snapshot.currency)}</span></div>
      {snapshot.stocks.length ? <><div className="portfolio-stock-bars" aria-label="正股持仓比例">{snapshot.stocks.slice().sort((a, b) => b.portfolioWeightPct - a.portfolioWeightPct).map(position => <div className="portfolio-stock-bar" key={position.symbol}><strong>{position.symbol}</strong><div className="portfolio-exposure-track"><span style={{ width: `${Math.max(0, Math.min(position.portfolioWeightPct, 100))}%` }} /></div><span>{formatPortfolioPct(position.portfolioWeightPct)}</span></div>)}</div><div className="portfolio-table-wrap"><table className="portfolio-table"><thead><tr><th>股票</th><th>占比</th><th>数量</th><th>平均成本</th><th>当前价</th><th>市值</th><th>浮盈亏</th></tr></thead><tbody>{snapshot.stocks.slice().sort((a, b) => b.portfolioWeightPct - a.portfolioWeightPct).map(position => {
        const linked = stockArchives.get(position.symbol.toUpperCase());
        return <tr key={position.symbol}><th scope="row">{linked ? <AppLink href={`/stocks/${linked.id}`}>{position.symbol}</AppLink> : <button className="portfolio-unlinked-stock" type="button" disabled={savingStock === position.symbol} onClick={() => onCreateStock(position.symbol)}>{savingStock === position.symbol ? "创建中…" : `${position.symbol} · 建档`}</button>}</th><td>{formatPortfolioPct(position.portfolioWeightPct)}</td><td>{position.quantity.toLocaleString("en-US", { maximumFractionDigits: 4 })}</td><td>{formatPortfolioMoneyExact(position.averageCost, snapshot.currency)}</td><td>{formatPortfolioMoneyExact(position.marketPrice, snapshot.currency)}</td><td>{formatPortfolioMoneyExact(position.marketValue, snapshot.currency)}</td><td className={position.unrealizedPnl < 0 ? "portfolio-loss" : "portfolio-gain"}>{formatPortfolioMoneyExact(position.unrealizedPnl, snapshot.currency)}</td></tr>;
      })}</tbody></table></div></> : <p className="stock-muted">这份快照没有正股持仓。</p>}
    </section>
    <section className="panel portfolio-section"><div className="section-heading"><div><p className="eyebrow">按策略归并</p><h2>期权策略</h2></div><span className="stock-muted">净值 {formatPortfolioMoney(optionValue, snapshot.currency)}</span></div>
      {snapshot.optionStrategies.length ? <div className="portfolio-option-list">{snapshot.optionStrategies.map(strategy => <details className="portfolio-option-card" key={strategy.id}><summary><span><strong>{strategy.symbol} · {strategy.expiration} · {portfolioStrategyLabel(strategy.strategy)}</strong><small>{strategy.quantity} 组 · 占账户 {formatPortfolioPct(strategy.portfolioWeightPct)}</small></span><ChevronDown size={17} aria-hidden="true" /></summary><div className="portfolio-option-metrics"><Metric label="平均净成本" value={formatPortfolioMoneyExact(strategy.averageNetDebit, snapshot.currency)} /><Metric label="总成本" value={formatPortfolioMoneyExact(strategy.totalCostBasis, snapshot.currency)} /><Metric label="当前净值" value={formatPortfolioMoneyExact(strategy.marketValue, snapshot.currency)} /><Metric label="浮盈亏" value={formatPortfolioMoneyExact(strategy.unrealizedPnl, snapshot.currency)} detail={`${strategy.totalCostBasis === 0 ? "—" : `${(strategy.unrealizedPnl / Math.abs(strategy.totalCostBasis) * 100).toFixed(1)}%`}`} /></div><div className="portfolio-legs">{strategy.legs.map((leg, index) => <div className="portfolio-leg" key={`${leg.optionType}-${leg.side}-${leg.strike}-${index}`}><strong>{leg.side === "LONG" ? "Long" : "Short"} · {leg.optionType}</strong><span>{leg.quantity} × {strategy.expiration} {leg.strike} {leg.optionType}</span><small>均价 {formatPortfolioMoneyExact(leg.averagePrice, snapshot.currency)} · 当前价 {formatPortfolioMoneyExact(leg.marketPrice, snapshot.currency)} · 市值 {formatPortfolioMoneyExact(leg.marketValue, snapshot.currency)}</small></div>)}</div></details>)}</div> : <p className="stock-muted">这份快照没有期权策略。</p>}
    </section>
    <section className="panel portfolio-section"><div className="section-heading"><div><p className="eyebrow">按标的合并正股与期权</p><h2>标的总暴露</h2></div></div>
      <div className="portfolio-exposure-list">{exposure.map(item => <div className="portfolio-exposure-row" key={item.symbol}><strong>{item.symbol}</strong><div className="portfolio-exposure-track"><span style={{ width: `${Math.min(Math.abs(item.weightPct), 100)}%` }} /></div><span>{formatPortfolioPct(item.weightPct)}</span><small>{concentrationLabel(item.weightPct)}</small><small>正股 {formatPortfolioPct(snapshot.account.nav ? item.stockValue / snapshot.account.nav * 100 : 0)} · 期权 {formatPortfolioPct(snapshot.account.nav ? item.optionValue / snapshot.account.nav * 100 : 0)}</small></div>)}<div className="portfolio-exposure-row portfolio-cash-row"><strong>Cash</strong><div className="portfolio-exposure-track"><span style={{ width: `${Math.min(Math.abs(portfolioCashPct(snapshot)), 100)}%` }} /></div><span>{formatPortfolioPct(portfolioCashPct(snapshot))}</span><small>现金</small><small>{formatPortfolioMoney(snapshot.account.cash, snapshot.currency)}</small></div></div>
      {!maxExposure ? <p className="stock-muted">没有可计算的标的暴露。</p> : null}
    </section>
    {snapshot.note ? <section className="panel portfolio-section"><p className="eyebrow">快照备注</p><p className="portfolio-note">{snapshot.note}</p></section> : null}
  </>;
}

function SnapshotDetail({ snapshot, stocks, onCreateStock, savingStock }: { snapshot: PortfolioSnapshot; stocks: Stock[]; onCreateStock: (symbol: string) => void; savingStock: string }) {
  return <>
    <div className="portfolio-detail-toolbar"><AppLink className="calendar-back-link" href="/stocks/portfolio"><ArrowLeft size={16} aria-hidden="true" />返回组合档案</AppLink><p>这是历史记录，不会随当前行情变化。</p></div>
    <header className="portfolio-header"><div><p className="eyebrow">历史快照 · {snapshot.broker}</p><h1>{snapshot.snapshotDate} {snapshot.snapshotTime}</h1><p className="stock-muted">{snapshot.currency} · 只读保存</p></div></header>
    <SnapshotOverview snapshot={snapshot} stocks={stocks} onCreateStock={onCreateStock} savingStock={savingStock} />
  </>;
}

function SnapshotHistory({ snapshots }: { snapshots: PortfolioSnapshot[] }) {
  if (!snapshots.length) return <div className="panel portfolio-empty"><h2>暂无历史快照</h2><p>导入并保存后，组合状态会按时间保存在这里。</p></div>;
  return <section className="portfolio-history-list" aria-label="历史快照">{snapshots.map(snapshot => {
    const exposure = portfolioTickerExposure(snapshot);
    const stockValue = snapshot.stocks.reduce((sum, stock) => sum + stock.marketValue, 0);
    const optionValue = snapshot.optionStrategies.reduce((sum, strategy) => sum + strategy.marketValue, 0);
    return <AppLink className="panel portfolio-history-card" href={`/stocks/portfolio/snapshots/${snapshot.id}`} key={snapshot.id}><div className="portfolio-history-date"><span>{snapshot.snapshotDate}</span><small>{snapshot.snapshotTime} · {snapshot.broker}</small></div><strong className="portfolio-history-nav">{formatPortfolioMoney(snapshot.account.nav, snapshot.currency)}</strong><div className="portfolio-history-ratios"><span>现金 {formatPortfolioPct(portfolioCashPct(snapshot))}</span><span>正股 {formatPortfolioPct(snapshot.account.nav ? stockValue / snapshot.account.nav * 100 : 0)}</span><span>期权 {formatPortfolioPct(snapshot.account.nav ? optionValue / snapshot.account.nav * 100 : 0)}</span></div><div className="portfolio-history-meta"><span>最大仓位 {exposure[0] ? `${exposure[0].symbol} ${formatPortfolioPct(exposure[0].weightPct)}` : "暂无"}</span><span>{snapshot.stocks.length} 只正股 · {snapshot.optionStrategies.length} 个策略</span></div><span className="portfolio-history-open">查看完整快照 →</span></AppLink>;
  })}</section>;
}

function PositionChanges({ snapshots, range, setRange }: { snapshots: PortfolioSnapshot[]; range: HistoryRange; setRange: (range: HistoryRange) => void }) {
  const visible = useMemo(() => {
    if (range === "all") return snapshots;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const earliest = new Date(today); earliest.setDate(earliest.getDate() - Number(range));
    const date = `${earliest.getFullYear()}-${String(earliest.getMonth() + 1).padStart(2, "0")}-${String(earliest.getDate()).padStart(2, "0")}`;
    return snapshots.filter(snapshot => snapshot.snapshotDate >= date);
  }, [snapshots, range]);
  const perDay = useMemo(() => {
    const seen = new Set<string>();
    return visible.filter(snapshot => { if (seen.has(snapshot.snapshotDate)) return false; seen.add(snapshot.snapshotDate); return true; }).slice().reverse();
  }, [visible]);
  const rows = useMemo(() => {
    const symbols = new Set<string>();
    for (const snapshot of perDay) for (const item of portfolioTickerExposure(snapshot)) symbols.add(item.symbol);
    return ["Cash", ...Array.from(symbols).sort()];
  }, [perDay]);
  return <section className="panel portfolio-section portfolio-changes-section"><div className="section-heading"><div><p className="eyebrow">历史权重</p><h2>仓位变化</h2></div><label className="portfolio-range">时间范围<select value={range} onChange={event => setRange(event.target.value as HistoryRange)}><option value="7">7 天</option><option value="30">30 天</option><option value="90">90 天</option><option value="all">全部</option></select></label></div>
    {!perDay.length ? <p className="stock-muted">这个时间范围内没有快照。</p> : <div className="portfolio-change-table-wrap"><table className="portfolio-change-table"><thead><tr><th>标的</th>{perDay.map(snapshot => <th key={snapshot.id}>{snapshot.snapshotDate.slice(5)}<small>{snapshot.snapshotTime.slice(0, 5)}</small></th>)}</tr></thead><tbody>{rows.map(symbol => <tr key={symbol}><th scope="row">{symbol}</th>{perDay.map(snapshot => {
      const pct = symbol === "Cash" ? portfolioCashPct(snapshot) : portfolioTickerExposure(snapshot).find(item => item.symbol === symbol)?.weightPct ?? 0;
      return <td key={snapshot.id} className={pct < 0 ? "portfolio-loss" : ""}>{formatPortfolioPct(pct)}</td>;
    })}</tr>)}</tbody></table></div>}
  </section>;
}

function Metric({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return <div className="portfolio-metric"><span>{label}</span><strong>{value}</strong>{detail ? <small>{detail}</small> : null}</div>;
}
