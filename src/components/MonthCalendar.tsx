import { ArrowLeft, CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { addTodo, getCalendarMonthData, setTodoCompleted } from "../lib/db";
import { buildCalendarDays, displayDate, displayMonth, isoDate, moveCalendarDate, parseISODate, type CalendarView } from "../lib/date";
import type { DayEntry, ISODate, TodoItem } from "../types";
import { AppLink } from "../lib/router";

interface MonthCalendarProps {
  month: Date;
  selectedDate: ISODate;
  onMonthChange: (month: Date) => void;
  onSelectDate: (date: ISODate) => void;
}

const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const viewNames: Record<CalendarView, string> = { day: "日", week: "周", month: "月" };

export function MonthCalendar({ month, selectedDate, onMonthChange, onSelectDate }: MonthCalendarProps) {
  const [view, setView] = useState<CalendarView>("month");
  const selected = parseISODate(selectedDate);
  const focusDate = selected.getFullYear() === month.getFullYear() && selected.getMonth() === month.getMonth() ? selected : month;
  const focusISO = isoDate(focusDate);
  const days = useMemo(() => buildCalendarDays(parseISODate(focusISO), view), [focusISO, view]);
  const rows = useMemo(() => Array.from({ length: Math.ceil(days.length / 7) }, (_, index) => days.slice(index * 7, index * 7 + 7)), [days]);
  const firstDay = days[0];
  const lastDay = days[days.length - 1];
  const title = view === "month" ? displayMonth(focusDate) : view === "day" ? displayDate(focusISO) : `${displayDate(firstDay.iso)} — ${displayDate(lastDay.iso)}`;
  const [entries, setEntries] = useState<Record<ISODate, DayEntry>>({});
  const [todos, setTodos] = useState<Record<ISODate, TodoItem[]>>({});
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);
  const [quickAddTitle, setQuickAddTitle] = useState("");
  const [refreshVersion, setRefreshVersion] = useState(0);

  useEffect(() => {
    let alive = true;
    getCalendarMonthData(firstDay.iso, lastDay.iso).then((data) => {
      if (alive) {
        setEntries(data.entries);
        setTodos(data.todos);
      }
    });
    return () => { alive = false; };
  }, [firstDay.iso, lastDay.iso, refreshVersion]);

  const selectDate = (date: Date) => {
    onMonthChange(date);
    onSelectDate(isoDate(date));
  };
  const openDay = (date: Date) => {
    selectDate(date);
    setView("day");
  };
  const handleQuickAdd = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const taskTitle = quickAddTitle.trim();
    if (!taskTitle) return;
    await addTodo(focusISO, taskTitle);
    setQuickAddTitle("");
    setRefreshVersion((version) => version + 1);
    window.dispatchEvent(new Event("diary-data-changed"));
  };
  const handleToggleTodo = async (todo: TodoItem) => {
    await setTodoCompleted(todo.id, !todo.completed);
    setRefreshVersion((version) => version + 1);
    window.dispatchEvent(new Event("diary-data-changed"));
  };

  return (
    <main className="app-shell month-calendar-page">
      <AppLink href="/" className="calendar-back-link"><ArrowLeft size={16} aria-hidden="true" />返回日记</AppLink>
      <section className={`panel month-calendar-panel calendar-view-${view}`} aria-label={`${title}${viewNames[view]}历`}>
        <div className="month-calendar-toolbar">
          <h1><CalendarDays size={23} aria-hidden="true" />{title}</h1>
          <div className="month-calendar-actions">
            <button className="icon-button month-add-button" type="button" onClick={() => setIsQuickAddOpen((open) => !open)} aria-label="新增计划" title="新增计划" aria-expanded={isQuickAddOpen} aria-controls="calendar-quick-add">
              <Plus size={21} aria-hidden="true" />
            </button>
            <div className="calendar-view-select">
              <select aria-label="日历维度" value={view} onChange={(event) => { selectDate(focusDate); setView(event.target.value as CalendarView); }}>
                <option value="day">日</option>
                <option value="week">周</option>
                <option value="month">月</option>
              </select>
              <ChevronDown size={15} aria-hidden="true" />
            </div>
            <div className="calendar-period-navigation" role="group" aria-label="日历翻页">
              <button type="button" aria-label={`上一${viewNames[view]}`} title={`上一${viewNames[view]}`} onClick={() => selectDate(moveCalendarDate(focusDate, view, -1))}><ChevronLeft size={18} aria-hidden="true" /></button>
              <button className="month-today-button" type="button" onClick={() => selectDate(new Date())}>今天</button>
              <button type="button" aria-label={`下一${viewNames[view]}`} title={`下一${viewNames[view]}`} onClick={() => selectDate(moveCalendarDate(focusDate, view, 1))}><ChevronRight size={18} aria-hidden="true" /></button>
            </div>
          </div>
        </div>

        {isQuickAddOpen ? (
          <form id="calendar-quick-add" className="month-quick-add" onSubmit={handleQuickAdd}>
            <label htmlFor="month-quick-add-title">为 {displayDate(focusISO)} 添加计划</label>
            <input id="month-quick-add-title" autoFocus value={quickAddTitle} onChange={(event) => setQuickAddTitle(event.target.value)} placeholder="写下一个计划" />
            <button className="primary" type="submit" disabled={!quickAddTitle.trim()}>添加</button>
          </form>
        ) : null}

        <div className="month-calendar-scroll" role="grid" aria-label={`${title}，${viewNames[view]}视图`}>
          <div className="month-calendar-weekdays" role="row">
            {(view === "day" ? [weekdays[firstDay.date.getDay()]] : weekdays).map((weekday) => <span role="columnheader" key={weekday}>{weekday}</span>)}
          </div>
          <div className="month-calendar-grid" role="rowgroup">
            {rows.map((row) => (
              <div className="month-calendar-week" role="row" key={row[0].iso}>
                {row.map((day) => {
                  const dayTodos = todos[day.iso] ?? [];
                  const entry = entries[day.iso];
                  const diaryText = entry?.text.trim();
                  const hasDiary = Boolean(diaryText || entry?.images.length || entry?.tags.length);
                  const visibleTodos = view === "month" ? dayTodos.slice(0, hasDiary ? 3 : 4) : dayTodos;
                  const hiddenCount = dayTodos.length - visibleTodos.length;
                  const isSelected = day.iso === focusISO;

                  return (
                    <article
                      className={[
                        "month-calendar-day",
                        view === "month" && !day.isCurrentMonth ? "outside-month" : "",
                        day.isToday ? "is-today" : "",
                        isSelected ? "is-selected" : ""
                      ].filter(Boolean).join(" ")}
                      role="gridcell" aria-selected={isSelected}
                      aria-label={`${displayDate(day.iso)}，${dayTodos.length}项计划${hasDiary ? "，有日记" : ""}`} key={day.iso}
                    >
                      <button className="month-calendar-date" type="button" onClick={() => selectDate(day.date)} onDoubleClick={() => openDay(day.date)} aria-label={`选择${displayDate(day.iso)}`} aria-current={day.isToday ? "date" : undefined}>
                        <span className="month-calendar-date-number">{day.date.getDate()}</span>
                        {day.isToday ? <span className="month-calendar-today-label">今天</span> : null}
                      </button>
                      <div className="month-calendar-events">
                        {visibleTodos.map((todo) => (
                          <button className={`month-calendar-event${todo.completed ? " completed" : ""}`} type="button" key={todo.id}
                            onClick={() => void handleToggleTodo(todo)} aria-label={`${todo.completed ? "标记未完成" : "完成计划"}：${todo.title}`} title={todo.title}>
                            <span className="month-calendar-check" aria-hidden="true">{todo.completed ? <Check size={11} strokeWidth={3} /> : null}</span>
                            <span className="month-calendar-event-title">{todo.title}</span>
                          </button>
                        ))}
                        {hasDiary ? (
                          <AppLink href="/" className="month-calendar-diary" onClick={() => selectDate(day.date)} title="打开这一天的日记">
                            <span className="month-calendar-diary-dot" aria-hidden="true" />
                            <span>{diaryText || (entry?.images.length ? `${entry.images.length} 张图片` : entry?.tags.join("、"))}</span>
                          </AppLink>
                        ) : null}
                        {hiddenCount > 0 ? <button className="month-calendar-more" type="button" onClick={() => openDay(day.date)}>还有 {hiddenCount} 项</button> : null}
                        {view !== "month" && dayTodos.length === 0 && !hasDiary ? <p className="calendar-day-empty">暂无计划与日记</p> : null}
                      </div>
                    </article>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
