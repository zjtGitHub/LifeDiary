import { BarChart3, ChevronLeft, ChevronRight, Maximize2 } from "lucide-react";
import { useMemo } from "react";
import { buildMonthGrid, displayMonth, nextMonth, previousMonth } from "../lib/date";
import type { CalendarDayStatus, ISODate } from "../types";
import { AppLink } from "../lib/router";
import { healthLabels } from "../lib/health";
import { formatPortfolioMoney } from "../lib/portfolio-data";
import { navigate } from "../lib/router";

interface CalendarProps {
  month: Date;
  selectedDate: ISODate;
  statuses: Record<ISODate, CalendarDayStatus>;
  onMonthChange: (month: Date) => void;
  onSelectDate: (date: ISODate) => void;
}

const weekdays = ["一", "二", "三", "四", "五", "六", "日"];

export function Calendar({ month, selectedDate, statuses, onMonthChange, onSelectDate }: CalendarProps) {
  const today = useMemo(() => new Date(), []);
  const days = useMemo(() => buildMonthGrid(month, today), [month, today]);
  const selectedHealth = healthLabels(statuses[selectedDate] ?? {});

  return (
    <section className="panel calendar-panel" aria-label="月历">
      <div className="panel-header">
        <button
          className="icon-button"
          type="button"
          onClick={() => onMonthChange(previousMonth(month))}
          aria-label="上个月"
          title="上个月"
        >
          <ChevronLeft size={18} />
        </button>
        <h2>{displayMonth(month)}</h2>
        <div className="calendar-header-actions">
        <button
          className="icon-button"
          type="button"
          onClick={() => onMonthChange(nextMonth(month))}
          aria-label="下个月"
          title="下个月"
        >
          <ChevronRight size={18} />
        </button>
        <AppLink href="/calendar" className="icon-button" aria-label="放大日历" title="放大日历"><Maximize2 size={15} aria-hidden="true" /></AppLink>
        </div>
      </div>

      <div className="calendar-weekdays" aria-hidden="true">
        {weekdays.map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>

      <div className="calendar-grid">
        {days.map((day) => {
          const selected = day.iso === selectedDate;
          const status = statuses[day.iso];
          const statusLabel = [
            status?.hasDiary ? "有日记" : "",
            status?.hasImages ? "有图片" : "",
            status?.todoCount ? `${status.openTodoCount}项未完成计划` : "",
            status?.portfolioSnapshotId ? "有投资组合快照" : ""
          ]
            .filter(Boolean)
            .join("，");

          return (
            <div className="calendar-day-cell" key={day.iso}>
            <button
              className={[
                "calendar-day",
                day.isCurrentMonth ? "" : "muted",
                day.isToday ? "today" : "",
                selected ? "selected" : "",
                status ? "has-status" : ""
              ]
                .filter(Boolean)
                .join(" ")}
              type="button"
              onClick={() => onSelectDate(day.iso)}
              aria-pressed={selected}
              aria-current={day.isToday ? "date" : undefined}
              aria-label={`${day.iso}${day.isToday ? " 今天" : ""}${statusLabel ? ` ${statusLabel}` : ""}`}
            >
              <span className="calendar-day-number">{day.date.getDate()}</span>
              <span className="calendar-day-details" aria-hidden="true">
                {day.isToday ? <small className="calendar-today-label">今</small> : null}
                {status ? (
                  <span className="calendar-markers">
                    {status.hasDiary ? <i className="marker diary" /> : null}
                    {status.hasImages ? <i className="marker image" /> : null}
                    {status.todoCount > 0 ? <i className={status.openTodoCount > 0 ? "marker todo open" : "marker todo"} /> : null}
                    {status.portfolioSnapshotId ? <i className="marker portfolio" /> : null}
                  </span>
                ) : null}
              </span>
            </button>
            {status?.portfolioSnapshotId ? <button className="calendar-snapshot-link" type="button" aria-label={`查看投资组合快照：${formatPortfolioMoney(status.portfolioNav ?? 0, status.portfolioCurrency ?? "USD")}`} title="查看投资组合快照" onClick={() => navigate(`/stocks/portfolio/snapshots/${status.portfolioSnapshotId}`)}><BarChart3 size={11} aria-hidden="true" /></button> : null}
            </div>
          );
        })}
      </div>
      {selectedHealth.length ? <div className="calendar-selected-health" aria-label="所选日期健康记录"><span>当天健康</span>{selectedHealth.map(label => <strong key={label}>{label}</strong>)}</div> : null}
    </section>
  );
}
