import { ChevronLeft, ChevronRight, Pencil, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { getYearMonthSummaries, saveMonthlyReflection } from "../lib/db";
import type { MonthSummary } from "../types";

function MonthCard({ summary, onSelectDate }: { summary: MonthSummary; onSelectDate: (date: string) => void }) {
  const [text, setText] = useState(summary.reflection);
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState("");
  const revision = useRef(0);
  const monthNumber = Number(summary.month.slice(5));
  const isCurrent = summary.month === `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;

  const save = async (value: string) => {
    const currentRevision = ++revision.current;
    setText(value);
    setStatus("保存中…");
    try {
      // Save each change immediately so closing the timeline or switching years cannot discard a pending debounce.
      await saveMonthlyReflection(summary.month, value);
      if (currentRevision === revision.current) setStatus("已自动保存");
    } catch {
      if (currentRevision === revision.current) setStatus("保存失败，请重试");
    }
  };

  return (
    <li className={`month-timeline-item${isCurrent ? " current-month" : ""}`} id={`month-${summary.month}`}>
      <span className="month-timeline-dot" aria-hidden="true" />
      <article className="month-card" aria-label={`${summary.month} 月总结`}>
        <div className="month-card-heading">
          <h3>{monthNumber} 月 {isCurrent ? <small>本月</small> : null}</h3>
          <button className="icon-text-button subtle" type="button" onClick={() => setEditing(!editing)}
            aria-expanded={editing} aria-controls={`reflection-${summary.month}`}>
            <Pencil size={14} />{editing ? "收起编辑" : text.trim() ? "编辑总结" : "写总结"}
          </button>
        </div>
        <div className="month-metrics">
          <span><strong>{summary.diaryDays}</strong> 天日记</span>
          <span><strong>{summary.imageCount}</strong> 张照片</span>
          <span>计划完成 <strong>{summary.completedTodoCount}/{summary.todoCount}</strong></span>
        </div>
        {editing ? (
          <textarea id={`reflection-${summary.month}`} aria-label={`${summary.month} 总结正文`} rows={5}
            value={text} onChange={(event) => void save(event.target.value)}
            placeholder="这个月有哪些值得记住的事？有什么收获，接下来想做什么？" />
        ) : (
          <p id={`reflection-${summary.month}`} className={`month-reflection${text.trim() ? "" : " empty-copy"}`}>
            {text.trim() ? text : "还没有月总结，记下这个月的收获与感受吧。"}
          </p>
        )}
        {status ? <div className="month-save-status" role="status">
          {status}
          {status === "保存失败，请重试" ? <button type="button" onClick={() => void save(text)}>重新保存</button> : null}
        </div> : null}
        {summary.tags.length > 0 ? <div className="tag-list month-tags" aria-label="本月标签">
          {summary.tags.map((tag) => <span key={tag}>#{tag}</span>)}
        </div> : null}
        {summary.recordedDates.length > 0 ? (
          <details className="month-records">
            <summary>回看本月记录 · {summary.recordedDates.length} 天</summary>
            <div>{summary.recordedDates.map((date) => (
              <button type="button" key={date} onClick={() => onSelectDate(date)}>{date.slice(5).replace("-", "/")}</button>
            ))}</div>
          </details>
        ) : <p className="month-no-records">这个月还没有日记、照片或计划</p>}
      </article>
    </li>
  );
}

function YearTimeline({ year, overviewVersion, onSelectDate }: {
  year: number; overviewVersion: number; onSelectDate: (date: string) => void;
}) {
  const [summaries, setSummaries] = useState<MonthSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let alive = true;
    setFailed(false);
    getYearMonthSummaries(year).then((result) => {
      if (alive) setSummaries(result);
    }).catch(() => {
      if (alive) setFailed(true);
    });
    return () => { alive = false; };
  }, [year, overviewVersion, retry]);

  if (failed) return <p className="timeline-message" role="alert">月总结加载失败。
    <button type="button" className="secondary icon-text-button" onClick={() => setRetry(retry + 1)}>重试</button>
  </p>;
  if (!summaries) return <p className="timeline-message" role="status">正在加载这一年的记录…</p>;

  return <>
    <nav className="month-jump-nav" aria-label="跳转月份">
      {summaries.map((summary, index) => <button type="button" key={summary.month}
        onClick={() => document.getElementById(`month-${summary.month}`)?.scrollIntoView({ block: "start" })}>
        {index + 1} 月
      </button>)}
    </nav>
    <ol className="month-timeline" aria-label={`${year} 年月总结时间轴`}>
      {summaries.map((summary) => <MonthCard key={summary.month} summary={summary} onSelectDate={onSelectDate} />)}
    </ol>
  </>;
}

export function MonthTimeline({ initialYear, overviewVersion, onClose, onSelectDate }: {
  initialYear: number; overviewVersion: number; onClose: () => void; onSelectDate: (date: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [year, setYear] = useState(initialYear);

  useEffect(() => {
    const element = dialog.current!;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    element.showModal();
    return () => {
      element.close();
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  return <dialog ref={dialog} className="month-timeline-drawer" aria-labelledby="month-timeline-title"
    onCancel={(event) => { event.preventDefault(); onClose(); }}
    onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="month-timeline-content">
      <header className="timeline-header">
        <div className="timeline-title-row">
          <div><p className="eyebrow">把日子连成故事</p><h2 id="month-timeline-title">月总结时间轴</h2></div>
          <button type="button" className="icon-button" aria-label="关闭月总结" onClick={onClose}><X size={20} /></button>
        </div>
        <div className="timeline-year-picker">
          <button type="button" className="icon-button" aria-label="上一年" disabled={year <= 1000} onClick={() => setYear(year - 1)}><ChevronLeft size={18} /></button>
          <strong aria-live="polite">{year} 年</strong>
          <button type="button" className="icon-button" aria-label="下一年" disabled={year >= 9999} onClick={() => setYear(year + 1)}><ChevronRight size={18} /></button>
          <button type="button" className="secondary icon-text-button" onClick={() => setYear(new Date().getFullYear())}>回到今年</button>
        </div>
        <p className="timeline-description">一月一页，回顾记录，也写下自己的总结。编辑内容会自动保存。</p>
      </header>
      <div className="timeline-scroll-area" key={year}>
        <YearTimeline key={year} year={year} overviewVersion={overviewVersion} onSelectDate={(date) => { onSelectDate(date); onClose(); }} />
      </div>
    </div>
  </dialog>;
}
