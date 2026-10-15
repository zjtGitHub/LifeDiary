import { CalendarDays, ChevronLeft, ChevronRight, Clock3, Repeat2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { addDays } from "date-fns";
import { buildCalendarMonthGrid, displayDate, displayMonth, isoDate, nextMonth, parseISODate, previousMonth } from "../lib/date";
import { ebbinghausOffsets, isISODate, isValidSchedule, repeatOptions, scheduleLabel, usesWeeklyDays } from "../lib/schedules";
import type { ChecklistSchedule } from "../types";

interface SchedulePickerProps {
  schedule?: ChecklistSchedule | null;
  busy: boolean;
  onClose: () => void;
  onSave: (schedule: ChecklistSchedule | null) => Promise<boolean>;
}

const weekdays = ["日", "一", "二", "三", "四", "五", "六"];

export function SchedulePicker({ schedule, busy, onClose, onSave }: SchedulePickerProps) {
  const [draft, setDraft] = useState<ChecklistSchedule>(() => schedule ?? { date: isoDate(new Date()), repeat: "none" });
  const [month, setMonth] = useState(() => parseISODate(draft.date));
  const [showTime, setShowTime] = useState(!!draft.time);
  const [timeRange, setTimeRange] = useState(!!draft.endTime);
  const [hasUntil, setHasUntil] = useState(!!draft.until);
  const [saveError, setSaveError] = useState("");
  const dialog = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButton.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onCloseRef.current(); }
      if (event.key !== "Tab") return;
      const elements = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href]') ?? []);
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", keydown);
      previousFocus?.focus();
    };
  }, []);

  const result: ChecklistSchedule = {
    date: draft.date,
    repeat: draft.repeat,
    ...(draft.repeat === "custom" ? { interval: draft.interval ?? 2, unit: draft.unit ?? "day" } : {}),
    ...(showTime ? { time: draft.time ?? "09:00" } : {}),
    ...(showTime && timeRange ? { endTime: draft.endTime ?? "10:00" } : {}),
    ...(usesWeeklyDays(draft) ? { weekdays: draft.weekdays ?? [parseISODate(draft.date).getDay()] } : {}),
    ...(draft.repeat !== "none" && hasUntil ? { until: draft.until ?? draft.date } : {})
  };
  const valid = isValidSchedule(result);
  const monthlyRule = ["monthly", "quarterly", "semiannual"].includes(draft.repeat) || (draft.repeat === "custom" && draft.unit === "month");
  const yearlyRule = draft.repeat === "yearly" || (draft.repeat === "custom" && draft.unit === "year");
  const reviewDates = draft.repeat === "ebbinghaus" && isISODate(draft.date)
    ? ebbinghausOffsets.map(offset => ({ offset, date: isoDate(addDays(parseISODate(draft.date), offset)) })).filter(review => !result.until || review.date <= result.until)
    : [];
  const chooseDate = (date: string) => {
    setDraft(value => ({ ...value, date }));
    if (isISODate(date)) setMonth(parseISODate(date));
  };
  const save = async (value: ChecklistSchedule | null) => {
    setSaveError("");
    if (await onSave(value)) onClose();
    else setSaveError("保存时间设置失败，请重试。");
  };

  return createPortal(<div className="schedule-backdrop" onClick={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <div className="schedule-dialog" ref={dialog} role="dialog" aria-modal="true" aria-labelledby="schedule-heading">
      <div className="schedule-heading"><h2 id="schedule-heading"><CalendarDays size={19} />安排时间</h2><button className="icon-button subtle" ref={closeButton} type="button" disabled={busy} onClick={onClose} aria-label="关闭时间设置"><X size={18} /></button></div>
      <fieldset disabled={busy} className="schedule-fields">
        <div className="schedule-shortcuts">{[{ label: "今天", offset: 0 }, { label: "明天", offset: 1 }, { label: "一周后", offset: 7 }].map(shortcut => <button type="button" key={shortcut.label} onClick={() => chooseDate(isoDate(addDays(new Date(), shortcut.offset)))}>{shortcut.label}</button>)}</div>
        <div className="schedule-month-heading"><strong>{displayMonth(month)}</strong><div><button className="icon-button subtle" type="button" onClick={() => setMonth(previousMonth(month))} aria-label="日期选择上个月"><ChevronLeft size={18} /></button><button className="icon-button subtle" type="button" onClick={() => setMonth(nextMonth(month))} aria-label="日期选择下个月"><ChevronRight size={18} /></button></div></div>
        <div className="schedule-calendar-weekdays" aria-hidden="true">{weekdays.map(day => <span key={day}>{day}</span>)}</div>
        <div className="schedule-calendar" role="group" aria-label="选择计划日期">{buildCalendarMonthGrid(month).map(day => <button type="button" key={day.iso} className={`${day.isCurrentMonth ? "" : "outside-month "}${day.isToday ? "today" : ""}`} aria-pressed={day.iso === draft.date} aria-label={`安排在${displayDate(day.iso)}`} onClick={() => chooseDate(day.iso)}>{day.date.getDate()}</button>)}</div>
        <label className="schedule-date-input">{draft.repeat === "none" ? "计划日期" : "开始日期"}<input type="date" aria-label="计划日期" value={draft.date} onInput={event => chooseDate(event.currentTarget.value)} /></label>
        <div className="schedule-option-heading"><span><Clock3 size={17} />时间</span><label><input type="checkbox" checked={!showTime} onChange={event => setShowTime(!event.target.checked)} />全天</label></div>
        {showTime ? <div className="schedule-time-fields"><label>开始时间<input type="time" aria-label="开始时间" value={draft.time ?? "09:00"} onInput={event => { const time = event.currentTarget.value; setDraft(value => ({ ...value, time })); }} /></label>{timeRange ? <label>结束时间<input type="time" aria-label="结束时间" value={draft.endTime ?? "10:00"} onInput={event => { const endTime = event.currentTarget.value; setDraft(value => ({ ...value, endTime })); }} /></label> : null}<label className="schedule-inline-checkbox"><input type="checkbox" checked={timeRange} onChange={event => setTimeRange(event.target.checked)} />设置时间段</label></div> : null}
        <label className="schedule-repeat"><span><Repeat2 size={17} />重复</span><select aria-label="重复规则" value={draft.repeat} onChange={event => {
          const repeat = event.target.value as ChecklistSchedule["repeat"];
          setDraft(value => ({ ...value, repeat, interval: value.interval ?? 2, unit: value.unit ?? "day", weekdays: value.weekdays ?? [parseISODate(value.date).getDay()] }));
        }}>{repeatOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        {draft.repeat === "custom" ? <div className="schedule-custom"><span>每隔</span><input type="number" aria-label="重复间隔" min="1" max="999" step="1" value={Number.isNaN(draft.interval) ? "" : draft.interval ?? 2} onChange={event => {
          const interval = event.currentTarget.valueAsNumber;
          setDraft(value => ({ ...value, interval }));
        }} /><select aria-label="重复间隔单位" value={draft.unit ?? "day"} onChange={event => {
          const unit = event.target.value as ChecklistSchedule["unit"];
          setDraft(value => ({ ...value, unit }));
        }}><option value="day">天</option><option value="week">周</option><option value="month">个月</option><option value="year">年</option></select><span>重复</span></div> : null}
        {usesWeeklyDays(result) ? <div className="schedule-weekdays" role="group" aria-label="每周重复日期">{[1, 2, 3, 4, 5, 6, 0].map(day => <button key={day} type="button" aria-label={`每周${weekdays[day]}`} aria-pressed={result.weekdays?.includes(day) ?? false} onClick={() => setDraft(value => ({ ...value, weekdays: result.weekdays?.includes(day) ? result.weekdays.filter(item => item !== day) : [...(result.weekdays ?? []), day] }))}>{weekdays[day]}</button>)}</div> : null}
        {usesWeeklyDays(result) && draft.repeat !== "weekly" ? <p className="schedule-hint">以开始日期所在周为第一周，每周从周一开始，按所选间隔和星期安排。</p> : null}
        {draft.repeat === "workdays" ? <p className="schedule-hint">每周一至周五重复，暂不按法定节假日或调休调整。</p> : null}
        {monthlyRule ? <p className="schedule-hint">从开始日期起按月间隔，在 {parseISODate(draft.date).getDate()} 日重复；当月没有该日期时安排在月末。</p> : null}
        {yearlyRule ? <p className="schedule-hint">从开始日期起按年间隔重复；2 月 29 日在非闰年安排于 2 月 28 日。</p> : null}
        {draft.repeat === "ebbinghaus" ? <div className="schedule-review"><p className="schedule-hint">开始日学习，之后第 1、2、4、7、15、30 天复习，共 6 次复习后结束；结束日期可提前截断。</p><ol aria-label="学习与复习日期">{reviewDates.map(review => <li key={review.offset}><span>{review.offset === 0 ? "开始学习" : `第 ${review.offset} 天复习`}</span><time dateTime={review.date}>{review.date}</time></li>)}</ol></div> : null}
        {draft.repeat !== "none" ? <div className="schedule-until"><label className="schedule-inline-checkbox"><input type="checkbox" checked={hasUntil} onChange={event => setHasUntil(event.target.checked)} />设置重复结束日期</label>{hasUntil ? <input type="date" aria-label="重复结束日期" min={draft.date} value={draft.until ?? draft.date} onInput={event => { const until = event.currentTarget.value; setDraft(value => ({ ...value, until })); }} /> : null}</div> : null}
      </fieldset>
      <p className={`schedule-preview${valid ? "" : " invalid"}`} role="status">{valid ? `${scheduleLabel(result)}${result.until ? `，至 ${result.until}` : ""}` : "请检查日期、时间和重复设置：间隔需为 1–999 的整数，按周重复需选择星期，结束时间需晚于开始时间，结束日期不能早于开始日期。"}</p>
      {saveError ? <p className="checklist-error" role="alert">{saveError}</p> : null}
      <div className="schedule-actions"><button className="secondary" type="button" disabled={busy} onClick={() => void save(null)}>清除</button><button className="primary" type="button" disabled={busy || !valid} onClick={() => void save(result)}>{busy ? "保存中…" : "确定"}</button></div>
    </div>
  </div>, document.body);
}
