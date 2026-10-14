import { eachDayOfInterval, format, getDaysInMonth, isValid, parseISO } from "date-fns";
import type { ChecklistItem, ChecklistOccurrence, ChecklistSchedule, ISODate, TodoItem } from "../types";

export const isISODate = (value: unknown): value is ISODate => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = parseISO(value);
  return isValid(date) && format(date, "yyyy-MM-dd") === value;
};

export const isValidSchedule = (value: unknown): value is ChecklistSchedule => {
  if (!value || typeof value !== "object") return false;
  const schedule = value as ChecklistSchedule;
  const validTime = (time: unknown) => typeof time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
  return isISODate(schedule.date) && ["none", "daily", "weekly", "monthly"].includes(schedule.repeat) &&
    (schedule.time === undefined || validTime(schedule.time)) &&
    (schedule.endTime === undefined || (validTime(schedule.endTime) && !!schedule.time && schedule.endTime > schedule.time)) &&
    (schedule.until === undefined || (isISODate(schedule.until) && schedule.until >= schedule.date)) &&
    (schedule.weekdays === undefined || (Array.isArray(schedule.weekdays) && schedule.weekdays.every(day => Number.isInteger(day) && day >= 0 && day <= 6))) &&
    (schedule.repeat !== "weekly" || (!!schedule.weekdays?.length && new Set(schedule.weekdays).size === schedule.weekdays.length));
};

export const occursOn = (schedule: ChecklistSchedule, date: ISODate): boolean => {
  if (date < schedule.date || (schedule.until && date > schedule.until)) return false;
  if (schedule.repeat === "none") return date === schedule.date;
  if (schedule.repeat === "daily") return true;
  const day = parseISO(date);
  if (schedule.repeat === "weekly") return schedule.weekdays?.includes(day.getDay()) ?? false;
  return day.getDate() === Math.min(parseISO(schedule.date).getDate(), getDaysInMonth(day));
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
  const repeat = schedule.repeat === "daily" ? "每天" : schedule.repeat === "weekly"
    ? `每周${[1, 2, 3, 4, 5, 6, 0].filter(day => schedule.weekdays?.includes(day)).map(day => weekdays[day]).join("、")}`
    : schedule.repeat === "monthly" ? `每月 ${parseISO(schedule.date).getDate()} 日` : schedule.date;
  return `${repeat} · ${scheduleTimeLabel(schedule)}`;
};
