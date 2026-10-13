import { describe, expect, it } from "vitest";
import { buildCalendarDays, buildMonthGrid, isoDate, moveCalendarDate, parseISODate } from "./date";

describe("date utilities", () => {
  it("formats and parses ISO dates", () => {
    const date = parseISODate("2026-05-05");
    expect(isoDate(date)).toBe("2026-05-05");
  });

  it("builds a Monday-starting month grid with selectable ISO dates", () => {
    const days = buildMonthGrid(new Date("2026-05-15T00:00:00"), new Date("2026-05-05T00:00:00"));

    expect(days[0].iso).toBe("2026-04-27");
    expect(days[days.length - 1].iso).toBe("2026-05-31");
    expect(days.find((day) => day.iso === "2026-05-05")?.isToday).toBe(true);
    expect(days.find((day) => day.iso === "2026-04-30")?.isCurrentMonth).toBe(false);
  });

  it("builds Sunday-starting calendar ranges across a year boundary", () => {
    const date = parseISODate("2027-01-01");
    const week = buildCalendarDays(date, "week", date);
    expect(week.map((day) => day.iso)).toEqual([
      "2026-12-27", "2026-12-28", "2026-12-29", "2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"
    ]);
    expect(buildCalendarDays(date, "day", date)).toHaveLength(1);
    expect(buildCalendarDays(date, "day", date)[0].isToday).toBe(true);
    const month = buildCalendarDays(date, "month", date);
    expect(month[0].iso).toBe("2026-12-27");
    expect(month[month.length - 1].iso).toBe("2027-02-06");
  });

  it("handles leap days and short months when paging", () => {
    expect(isoDate(moveCalendarDate(parseISODate("2028-01-31"), "month", 1))).toBe("2028-02-29");
    expect(isoDate(moveCalendarDate(parseISODate("2028-02-28"), "day", 1))).toBe("2028-02-29");
    expect(isoDate(moveCalendarDate(parseISODate("2026-12-29"), "week", 1))).toBe("2027-01-05");
  });
});
