import { memo } from "react";
import type { LifeStats } from "../../lib/life";
import type { ISODate } from "../../types";

interface LifeWeekGridProps {
  stats: LifeStats;
  selectedDate: ISODate;
  onSelectWeek: (startDate: ISODate, endDate: ISODate) => void;
}

// Keep the 5,000+ week cells stable while the selected week's diary data loads.
export const LifeWeekGrid = memo(function LifeWeekGrid({ stats, selectedDate, onSelectWeek }: LifeWeekGridProps) {
  return (
    <div className="life-grid" role="group" aria-label={`已经历 ${stats.livedWeeks} 周，共 ${stats.totalWeeks} 周`}>
      {stats.rows.map(row => (
        <div className="life-row" key={row.age}>
          <span className="age-label">{row.age}</span>
          <div className="week-row">
            {row.weeks.map(week => {
              const isSelectedWeek = selectedDate >= week.startDate && selectedDate <= week.endDate;
              return (
                <button
                  className={`week-cell ${week.status}${isSelectedWeek ? " selected-date" : ""}`}
                  key={week.index}
                  type="button"
                  aria-pressed={isSelectedWeek}
                  onClick={() => onSelectWeek(week.startDate, week.endDate)}
                  aria-label={`${week.age} 岁第 ${week.weekInYear + 1} 周，${week.startDate} 到 ${week.endDate}`}
                  title={`${week.age} 岁 第 ${week.weekInYear + 1} 周｜${week.startDate} 到 ${week.endDate}`}
                />
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
});
