import { ChevronLeft, ChevronRight, TrendingUp, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { listMonthHealth } from "../lib/db";
import type { DayHealth } from "../types";

type Record = DayHealth & { date: string };
const number = (value: number) => new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value);

function TrendChart({ records, field, title, unit, month }: {
  records: Record[]; field: "weightKg" | "waistCm"; title: string; unit: string; month: string;
}) {
  const points = records.filter(record => record[field] !== undefined).map(record => ({
    date: record.date, value: record[field]! * (field === "weightKg" ? 2 : 1)
  }));
  if (!points.length) return <section className="health-trend"><h3>{title}</h3><p className="health-chart-empty">本月还没有{title.slice(0, 2)}记录，保存后即可查看趋势。</p></section>;
  const values = points.map(point => point.value);
  const min = Math.min(...values), max = Math.max(...values);
  const padding = Math.max((max - min) * .2, .5);
  const bottom = Math.max(0, min - padding), top = max + padding;
  const days = new Date(Number(month.slice(0, 4)), Number(month.slice(5)), 0).getDate();
  const x = (date: string) => 52 + (Number(date.slice(8)) - 1) / (days - 1) * 568;
  const y = (value: number) => 150 - (value - bottom) / (top - bottom) * 120;
  const change = points[points.length - 1].value - points[0].value;
  return <section className="health-trend">
    <div className="health-trend-heading"><h3>{title}<small>（{unit}）</small></h3><span>{points.length} 次记录 · {points.length > 1 ? `首末变化 ${change > 0 ? "+" : ""}${number(change)} ${unit}` : "再记一次即可对比变化"}</span></div>
    <svg className="health-chart" viewBox="0 0 650 185" role="img" aria-label={`${month} ${title}，${points.length}次记录`}>
      {[bottom, (bottom + top) / 2, top].map((tick, index) => <g key={index}><line x1="52" x2="620" y1={y(tick)} y2={y(tick)} className="health-chart-grid" /><text x="44" y={y(tick) + 4} textAnchor="end">{number(tick)}</text></g>)}
      <polyline points={points.map(point => `${x(point.date)},${y(point.value)}`).join(" ")} fill="none" className="health-chart-line" />
      {points.map(point => <circle key={point.date} cx={x(point.date)} cy={y(point.value)} r="4" className="health-chart-point" tabIndex={0} aria-label={`${point.date}：${number(point.value)} ${unit}`}><title>{point.date}：{number(point.value)} {unit}</title></circle>)}
      {[1, Math.ceil(days / 2), days].map(day => <text key={day} x={52 + (day - 1) / (days - 1) * 568} y="176" textAnchor="middle">{Number(month.slice(5))}/{day}</text>)}
    </svg>
    <details className="health-chart-data"><summary>查看记录明细</summary><table><thead><tr><th>日期</th><th>{title.slice(0, 2)}（{unit}）</th></tr></thead><tbody>{points.map(point => <tr key={point.date}><td>{point.date}</td><td>{number(point.value)}</td></tr>)}</tbody></table></details>
  </section>;
}

function MonthlyCalories({ records, loading, error }: { records: Record[]; loading: boolean; error: string }) {
  const logged = records.filter(record => record.calorieDeficitKcal !== undefined);
  const total = logged.reduce((sum, record) => sum + record.calorieDeficitKcal!, 0);
  return <div className="health-month-total" aria-label="每月累计卡路里缺口" aria-live="polite">
    <span>月累计卡路里缺口</span>
    <strong>{loading ? "加载中…" : error ? "加载失败" : logged.length ? `${number(total)} 大卡` : "暂无记录"}</strong>
    <small>{loading ? "正在读取健康记录" : error || `已记录 ${logged.length} 天 · 负数表示热量盈余`}</small>
  </div>;
}

export function HealthOverview({ date, revision }: { date: string; revision: number }) {
  const [month, setMonth] = useState(date.slice(0, 7));
  const [records, setRecords] = useState<Record[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    let alive = true;
    setLoading(true); setError("");
    listMonthHealth(month).then(next => { if (alive) setRecords(next); }).catch(() => {
      if (alive) { setRecords([]); setError("健康统计加载失败，请切换月份重试。"); }
    }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [month, revision]);
  useEffect(() => {
    if (open) dialog.current?.showModal();
  }, [open]);
  const stepMonth = (offset: number) => {
    const next = new Date(Number(month.slice(0, 4)), Number(month.slice(5)) - 1 + offset, 1);
    setMonth(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`);
  };
  return <div className="health-overview">
    <div className="health-month-picker">
      <button type="button" className="icon-button" aria-label="上个月健康统计" onClick={() => stepMonth(-1)}><ChevronLeft size={16} /></button>
      <input type="month" aria-label="健康统计月份" value={month} onChange={event => { if (/^\d{4}-(0[1-9]|1[0-2])$/.test(event.target.value)) setMonth(event.target.value); }} />
      <button type="button" className="icon-button" aria-label="下个月健康统计" onClick={() => stepMonth(1)}><ChevronRight size={16} /></button>
    </div>
    <MonthlyCalories records={records} loading={loading} error={error} />
    <button type="button" className="secondary health-trends-button" onClick={() => setOpen(true)}><TrendingUp size={16} />查看体重与腰围趋势</button>
    {open ? <dialog ref={dialog} className="health-trends-dialog" aria-labelledby="health-trends-title" onCancel={() => setOpen(false)} onClose={() => setOpen(false)} onClick={event => { if (event.target === event.currentTarget) { const bounds = event.currentTarget.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) setOpen(false); } }}>
      <div className="section-heading"><div><h2 id="health-trends-title">健康趋势</h2><p>{month} · 按实际记录日期展示，未记录的日期不计为 0</p></div><button type="button" className="icon-button" aria-label="关闭健康趋势" onClick={() => setOpen(false)}><X size={20} /></button></div>
      <div className="health-dialog-month"><button type="button" className="secondary" aria-label="查看上个月趋势" onClick={() => stepMonth(-1)}><ChevronLeft size={16} />上个月</button><span>{month}</span><button type="button" className="secondary" aria-label="查看下个月趋势" onClick={() => stepMonth(1)}>下个月<ChevronRight size={16} /></button></div>
      <MonthlyCalories records={records} loading={loading} error={error} />
      {loading ? <p role="status">正在加载趋势…</p> : error ? <p role="alert">{error}</p> : <><TrendChart records={records} field="weightKg" title="体重趋势" unit="斤" month={month} /><TrendChart records={records} field="waistCm" title="腰围趋势" unit="厘米" month={month} /></>}
    </dialog> : null}
  </div>;
}
