import {
  addDays,
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  parseISO,
  startOfMonth,
  startOfWeek,
  subMonths
} from "date-fns";
import type { ISODate } from "../types";

export const isoDate = (date: Date): ISODate => format(date, "yyyy-MM-dd");

export const parseISODate = (date: ISODate): Date => parseISO(date);

export const displayDate = (date: ISODate): string => format(parseISODate(date), "yyyy年M月d日");

export const displayMonth = (date: Date): string => format(date, "yyyy年M月");

export const previousMonth = (date: Date): Date => subMonths(date, 1);

export const nextMonth = (date: Date): Date => addMonths(date, 1);

export interface CalendarDay {
  date: Date;
  iso: ISODate;
  isCurrentMonth: boolean;
  isToday: boolean;
}

export type CalendarView = "day" | "week" | "month";

export const moveCalendarDate = (date: Date, view: CalendarView, direction: number): Date =>
  view === "month" ? addMonths(date, direction) : addDays(date, direction * (view === "week" ? 7 : 1));

export const buildCalendarDays = (date: Date, view: CalendarView, today = new Date()): CalendarDay[] => {
  if (view === "month") return buildCalendarMonthGrid(date, today);
  const dates = view === "day" ? [date] : eachDayOfInterval({
    start: startOfWeek(date, { weekStartsOn: 0 }),
    end: endOfWeek(date, { weekStartsOn: 0 })
  });
  return dates.map((day) => ({
    date: day,
    iso: isoDate(day),
    isCurrentMonth: isSameMonth(day, date),
    isToday: isSameDay(day, today)
  }));
};

export const buildMonthGrid = (monthDate: Date, today = new Date()): CalendarDay[] => {
  const monthStart = startOfMonth(monthDate);
  const monthEnd = endOfMonth(monthDate);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });

  return eachDayOfInterval({ start: gridStart, end: gridEnd }).map((date) => ({
    date,
    iso: isoDate(date),
    isCurrentMonth: isSameMonth(date, monthDate),
    isToday: isSameDay(date, today)
  }));
};

export const buildCalendarMonthGrid = (monthDate: Date, today = new Date()): CalendarDay[] => {
  const monthStart = startOfMonth(monthDate);
  const monthEnd = endOfMonth(monthDate);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 0 });
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });

  return eachDayOfInterval({ start: gridStart, end: gridEnd }).map((date) => ({
    date,
    iso: isoDate(date),
    isCurrentMonth: isSameMonth(date, monthDate),
    isToday: isSameDay(date, today)
  }));
};
