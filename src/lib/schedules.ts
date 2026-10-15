import { differenceInCalendarDays, eachDayOfInterval, format, getDaysInMonth, isValid, parseISO, startOfWeek } from "date-fns";
import type { ChecklistItem, ChecklistOccurrence, ChecklistSchedule, ISODate, TodoItem } from "../types";

export const repeatOptions: { value: ChecklistSchedule["repeat"]; label: string }[] = [
  { value: "none", label: "不重复" },
  { value: "daily", label: "每天" },
  { value: "workdays", label: "工作日（周一至周五）" },
  { value: "weekends", label: "周末（周六、周日）" },
  { value: "weekly", label: "每周" },
  { value: "biweekly", label: "每两周" },
  { value: "monthly", label: "每月" },
  { value: "quarterly", label: "每三个月" },
  { value: "semiannual", label: "每半年" },
  { value: "yearly", label: "每年" },
  { value: "ebbinghaus", label: "艾宾浩斯复习" },
  { value: "custom", label: "自定义…" }
];

// Calendar-day offsets from the initial learning date; the plan ends after day 30.
export const ebbinghausOffsets = [0, 1, 2, 4, 7, 15, 30];
export const usesWeeklyDays = (schedule: ChecklistSchedule) =>
  schedule.repeat === "weekly" || schedule.repeat === "biweekly" || (schedule.repeat === "custom" && schedule.unit === "week");

export const isISODate = (value: unknown): value is ISODate => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = parseISO(value);
  return isValid(date) && format(date, "yyyy-MM-dd") === value;
};

export const isValidSchedule = (value: unknown): value is ChecklistSchedule => {
  if (!value || typeof value !== "object") return false;
  const schedule = value as ChecklistSchedule;
  const validTime = (time: unknown) => typeof time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
  return isISODate(schedule.date) && repeatOptions.some(option => option.value === schedule.repeat) &&
    (schedule.time === undefined || validTime(schedule.time)) &&
    (schedule.endTime === undefined || (validTime(schedule.endTime) && !!schedule.time && schedule.endTime > schedule.time)) &&
    (schedule.until === undefined || (isISODate(schedule.until) && schedule.until >= schedule.date)) &&
    (schedule.weekdays === undefined || (Array.isArray(schedule.weekdays) && schedule.weekdays.every(day => Number.isInteger(day) && day >= 0 && day <= 6))) &&
    (!usesWeeklyDays(schedule) || (!!schedule.weekdays?.length && new Set(schedule.weekdays).size === schedule.weekdays.length)) &&
    (schedule.repeat !== "custom" || (Number.isInteger(schedule.interval) && schedule.interval! >= 1 && schedule.interval! <= 999 && ["day", "week", "month", "year"].includes(schedule.unit!)));
};

export const occursOn = (schedule: ChecklistSchedule, date: ISODate): boolean => {
  if (date < schedule.date || (schedule.until && date > schedule.until)) return false;
  if (schedule.repeat === "none") return date === schedule.date;
  if (schedule.repeat === "daily") return true;
  const day = parseISO(date);
  const start = parseISO(schedule.date);
  if (schedule.repeat === "workdays") return day.getDay() >= 1 && day.getDay() <= 5;
  if (schedule.repeat === "weekends") return day.getDay() === 0 || day.getDay() === 6;
  const days = differenceInCalendarDays(day, start);
  if (schedule.repeat === "ebbinghaus") return ebbinghausOffsets.includes(days);
  if (usesWeeklyDays(schedule)) {
    const interval = schedule.repeat === "biweekly" ? 2 : schedule.repeat === "custom" ? schedule.interval! : 1;
    const weeks = differenceInCalendarDays(startOfWeek(day, { weekStartsOn: 1 }), startOfWeek(start, { weekStartsOn: 1 })) / 7;
    return weeks % interval === 0 && (schedule.weekdays?.includes(day.getDay()) ?? false);
  }
  if (schedule.repeat === "custom" && schedule.unit === "day") return days % schedule.interval! === 0;
  const months = (day.getFullYear() - start.getFullYear()) * 12 + day.getMonth() - start.getMonth();
  const interval = schedule.repeat === "monthly" ? 1 : schedule.repeat === "quarterly" ? 3
    : schedule.repeat === "semiannual" ? 6 : schedule.repeat === "yearly" ? 12
    : schedule.repeat === "custom" && schedule.unit === "month" ? schedule.interval!
    : schedule.repeat === "custom" && schedule.unit === "year" ? schedule.interval! * 12 : 0;
  return interval > 0 && months % interval === 0 && day.getDate() === Math.min(start.getDate(), getDaysInMonth(day));
};

export const occurrenceId = (itemId: string, date: ISODate) => `checklist:${itemId}:${date}`;

export const parseOccurrenceId = (id: string) => {
  if (!id.startsWith("checklist:")) return null;
  const date = id.slice(-10);
  const itemId = id.slice(10, -11);
  return itemId && id[id.length - 11] === ":" && isISODate(date) ? { itemId, date } : null;
};

export const expandChecklistSchedules = (items: ChecklistItem[], occurrences: ChecklistOccurrence[], start: ISODate, end: ISODate): TodoItem[] => {
  const states = new Map(occurrences.map(state => [occurrenceId(state.itemId, state.date), state]));
  const dates = eachDayOfInterval({ start: parseISO(start), end: parseISO(end) }).map(date => format(date, "yyyy-MM-dd"));
  return items.flatMap(item => {
    const schedule = item.schedule;
    if (!schedule || !isValidSchedule(schedule)) return [];
    return dates.filter(date => occursOn(schedule, date)).map(date => {
      const id = occurrenceId(item.id, date);
      const state = states.get(id);
      return {
        id, date, title: item.title, checklistItemId: item.id,
        time: schedule.time, endTime: schedule.endTime,
        completed: schedule.repeat === "none" ? item.completed : state?.completed ?? false,
        createdAt: item.createdAt, updatedAt: state?.updatedAt ?? item.updatedAt
      };
    });
  });
};

export const sortPlans = (todos: TodoItem[]) => todos.sort((a, b) =>
  (a.time ?? "").localeCompare(b.time ?? "") || a.createdAt.localeCompare(b.createdAt) || a.title.localeCompare(b.title, "zh-CN"));

export const scheduleTimeLabel = (schedule: { time?: string; endTime?: string }) =>
  schedule.time ? `${schedule.time}${schedule.endTime ? `–${schedule.endTime}` : ""}` : "全天";

const weekdays = ["日", "一", "二", "三", "四", "五", "六"];
export const scheduleLabel = (schedule: ChecklistSchedule): string => {
  const start = parseISO(schedule.date);
  let repeat = repeatOptions.find(option => option.value === schedule.repeat)?.label ?? schedule.date;
  if (schedule.repeat === "none") repeat = schedule.date;
  if (schedule.repeat === "custom") repeat = `每 ${schedule.interval} ${{ day: "天", week: "周", month: "个月", year: "年" }[schedule.unit!]}`;
  if (usesWeeklyDays(schedule)) repeat += `${schedule.repeat === "weekly" ? "" : " · 周"}${[1, 2, 3, 4, 5, 6, 0].filter(day => schedule.weekdays?.includes(day)).map(day => weekdays[day]).join("、")}`;
  if (["monthly", "quarterly", "semiannual"].includes(schedule.repeat) || (schedule.repeat === "custom" && schedule.unit === "month")) repeat += ` ${start.getDate()} 日`;
  if (schedule.repeat === "yearly" || (schedule.repeat === "custom" && schedule.unit === "year")) repeat += ` ${start.getMonth() + 1} 月 ${start.getDate()} 日`;
  return `${repeat} · ${scheduleTimeLabel(schedule)}`;
};
