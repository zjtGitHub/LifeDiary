import { Save } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { LifeWeekGrid } from "./LifeWeekGrid";
import { calculateLifeStats, isValidBirthDate } from "../../lib/life";
import type { ISODate, WeekSummary } from "../../types";

interface LifeGridProps {
  birthDate?: ISODate;
  selectedDate: ISODate;
  weekSummary: WeekSummary | null;
  onSaveBirthDate: (birthDate: ISODate) => Promise<void>;
  onSelectDate: (date: ISODate) => void;
  onSelectWeek: (startDate: ISODate, endDate: ISODate) => void;
}

export function LifeGrid({
  birthDate,
  selectedDate,
  weekSummary,
  onSaveBirthDate,
  onSelectDate,
  onSelectWeek
}: LifeGridProps) {
  const [draft, setDraft] = useState(birthDate ?? "");
  const [error, setError] = useState("");

  useEffect(() => {
    setDraft(birthDate ?? "");
  }, [birthDate]);

  const stats = useMemo(() => {
    if (!birthDate || !isValidBirthDate(birthDate)) {
      return null;
    }

    return calculateLifeStats(birthDate);
  }, [birthDate]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!isValidBirthDate(draft)) {
      setError("请输入有效的生日。");
      return;
    }
    setError("");
    try {
      await onSaveBirthDate(draft);
    } catch {
      setError("生日保存失败，请重试。");
    }
  };

  return (
    <section className="panel life-panel" aria-label="人生表格">
      <div className="section-heading">
        <div>
          <p className="eyebrow">100 岁人生表格</p>
          <h2>一周一个方块</h2>
          <p>点击周格子查看这一周，再点击某一天打开日记。</p>
        </div>
      </div>

      <form className="birthday-form" onSubmit={handleSubmit}>
        <label>
          生日
          <input
            type="date"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            aria-label="生日"
          />
        </label>
        <button className="primary icon-text-button" type="submit">
          <Save size={17} />
          保存
        </button>
      </form>
      {error ? <p className="form-error">{error}</p> : null}

      {stats ? (
        <>
          <div className="life-stats">
            <span>
              已经历 <strong>{stats.livedWeeks}</strong> 周
            </span>
            <span>
              总计 <strong>{stats.totalWeeks}</strong> 周
            </span>
            <span>
              当前 <strong>{stats.currentAge} 岁第 {stats.currentAgeWeek + 1} 周</strong>
            </span>
          </div>

          {weekSummary ? (
            <div className="week-summary" aria-label="周回顾">
              <div className="section-heading compact">
                <div>
                  <h2>周回顾</h2>
                  <p>
                    {weekSummary.startDate} 到 {weekSummary.endDate}
                  </p>
                </div>
                <div className="week-summary-stats">
                  <span>{weekSummary.diaryDays} 天日记</span>
                  <span>{weekSummary.imageCount} 张图片</span>
                  <span>{weekSummary.openTodoCount}/{weekSummary.todoCount} 计划</span>
                </div>
              </div>
              <div className="week-summary-days">
                {weekSummary.days.map((day) => (
                  <button
                    className={day.date === selectedDate ? "summary-day selected" : "summary-day"}
                    key={day.date}
                    type="button"
                    aria-label={`打开 ${day.date} 的日记`}
                    onClick={() => onSelectDate(day.date)}
                  >
                    <strong>{day.date}</strong>
                    <span>{day.text.trim() ? day.text.trim().slice(0, 38) : "没有日记"}</span>
                    <small>
                      {day.tags.map((tag) => `#${tag}`).join(" ")}
                      {day.imageCount > 0 ? ` 图片 ${day.imageCount}` : ""}
                      {day.todos.length > 0
                        ? ` 计划 ${day.todos.filter((todo) => !todo.completed).length}/${day.todos.length}`
                        : ""}
                    </small>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="life-legend" aria-hidden="true">
            <span>
              <i className="legend-box past" /> 已经历
            </span>
            <span>
              <i className="legend-box current" /> 当前
            </span>
            <span>
              <i className="legend-box future" /> 未经历
            </span>
          </div>

          <LifeWeekGrid stats={stats} selectedDate={selectedDate} onSelectWeek={onSelectWeek} />
        </>
      ) : (
        <p className="empty-copy">保存生日后，这里会显示按 100 岁计算的人生周表格。</p>
      )}
    </section>
  );
}
