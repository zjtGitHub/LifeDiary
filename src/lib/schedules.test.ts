import { beforeEach, describe, expect, it } from "vitest";
import { createChecklistGroup, createChecklistItem, deleteChecklistGroup, deleteChecklistItem, updateChecklistItem } from "./checklists";
import { createBackupPayload, db, getCalendarMonthData, getWeekSummary, getYearMonthSummaries, listCalendarStatuses, listTodosByDate, restoreBackupPayload, setTodoCompleted } from "./db";
import { isValidSchedule, occursOn } from "./schedules";
import type { ChecklistSchedule } from "../types";

beforeEach(async () => { await db.delete(); await db.open(); });

async function scheduledItem(title: string, schedule: ChecklistSchedule) {
  const item = await createChecklistItem("", title);
  await updateChecklistItem(item.id, { schedule });
  return item;
}

describe("scheduled checklists", () => {
  it("shows different weekly workouts on their chosen days, with inclusive start and end dates", async () => {
    await scheduledItem("练上肢", { date: "2026-10-12", repeat: "weekly", weekdays: [1, 4], time: "18:30", endTime: "19:30", until: "2026-10-22" });
    await scheduledItem("练下肢", { date: "2026-10-13", repeat: "weekly", weekdays: [2, 5] });
    const data = await getCalendarMonthData("2026-10-11", "2026-10-26");
    expect(data.todos["2026-10-11"]).toBeUndefined();
    expect(data.todos["2026-10-12"][0]).toMatchObject({ title: "练上肢", time: "18:30", endTime: "19:30" });
    expect(data.todos["2026-10-13"][0].title).toBe("练下肢");
    expect(data.todos["2026-10-14"]).toBeUndefined();
    expect(data.todos["2026-10-22"][0].title).toBe("练上肢");
    expect(data.todos["2026-10-26"]).toBeUndefined();
    expect(await db.todos.count()).toBe(0);
  });

  it("keeps recurrence completion independent across days and preserves it after editing and reopening", async () => {
    const item = await scheduledItem("健身", { date: "2026-10-12", repeat: "weekly", weekdays: [1] });
    const [first] = await listTodosByDate("2026-10-12");
    await setTodoCompleted(first.id, true);
    expect((await listTodosByDate("2026-10-12"))[0].completed).toBe(true);
    expect((await listTodosByDate("2026-10-19"))[0].completed).toBe(false);
    expect((await db.checklistItems.get(item.id))?.completed).toBe(false);
    await updateChecklistItem(item.id, { title: "力量训练", schedule: { date: "2026-10-12", repeat: "weekly", weekdays: [1], time: "19:00" } });
    db.close(); await db.open();
    expect((await listTodosByDate("2026-10-12"))[0]).toMatchObject({ title: "力量训练", time: "19:00", completed: true });
    await setTodoCompleted(first.id, false);
    expect((await listTodosByDate("2026-10-12"))[0].completed).toBe(false);
  });

  it("clamps monthly repayment dates to the last day, including leap years and crossing years", () => {
    const schedule: ChecklistSchedule = { date: "2023-12-31", repeat: "monthly" };
    for (const date of ["2023-12-31", "2024-01-31", "2024-02-29", "2024-04-30", "2025-02-28"]) expect(occursOn(schedule, date)).toBe(true);
    for (const date of ["2023-11-30", "2024-02-28", "2024-03-30", "2024-05-30"]) expect(occursOn(schedule, date)).toBe(false);
  });

  it("syncs one-off checklist completion both ways and removes calendar entries when dates are cleared", async () => {
    const item = await scheduledItem("还款", { date: "2026-10-14", repeat: "none" });
    await updateChecklistItem(item.id, { completed: true });
    const [todo] = await listTodosByDate("2026-10-14");
    expect(todo.completed).toBe(true);
    await setTodoCompleted(todo.id, false);
    expect((await db.checklistItems.get(item.id))?.completed).toBe(false);
    await updateChecklistItem(item.id, { schedule: null });
    expect(await listTodosByDate("2026-10-14")).toEqual([]);
    expect(await db.checklistItems.count()).toBe(1);
  });

  it("includes scheduled tasks in small calendar markers and weekly and monthly summaries", async () => {
    await scheduledItem("散步", { date: "2026-10-14", repeat: "daily", until: "2026-10-16" });
    const [todo] = await listTodosByDate("2026-10-14");
    await setTodoCompleted(todo.id, true);
    expect((await listCalendarStatuses("2026-10-01", "2026-10-31"))["2026-10-14"]).toMatchObject({ todoCount: 1, openTodoCount: 0 });
    expect(await getWeekSummary("2026-10-11", "2026-10-17")).toMatchObject({ todoCount: 3, openTodoCount: 2 });
    expect((await getYearMonthSummaries(2026))[9]).toMatchObject({ todoCount: 3, completedTodoCount: 1 });
  });

  it("round trips schedules and completion records, rejects invalid backup data without clearing the database", async () => {
    await scheduledItem("信用卡还款", { date: "2026-01-31", repeat: "monthly", time: "09:00" });
    const [todo] = await listTodosByDate("2026-02-28");
    await setTodoCompleted(todo.id, true);
    const payload = await createBackupPayload();
    await restoreBackupPayload(payload);
    expect((await listTodosByDate("2026-02-28"))[0]).toMatchObject({ completed: true, title: "信用卡还款", time: "09:00" });
    payload.checklistItems![0].schedule!.date = "2026-02-30";
    await expect(restoreBackupPayload(payload)).rejects.toThrow("Invalid checklist data");
    expect((await listTodosByDate("2026-02-28"))[0].completed).toBe(true);
    const invalid = await createBackupPayload();
    invalid.checklistOccurrences![0].itemId = "missing";
    await expect(restoreBackupPayload(invalid)).rejects.toThrow("Invalid checklist occurrence data");
    expect(await db.checklistItems.count()).toBe(1);
  });

  it("keeps schedules when a group is deleted and removes associated completions when a task is deleted", async () => {
    const group = await createChecklistGroup("健身计划");
    const item = await scheduledItem("深蹲", { date: "2026-10-14", repeat: "daily" });
    await updateChecklistItem(item.id, { groupId: group.id });
    const [todo] = await listTodosByDate("2026-10-14");
    await setTodoCompleted(todo.id, true);
    await deleteChecklistGroup(group.id);
    expect((await listTodosByDate("2026-10-14"))[0].completed).toBe(true);
    await deleteChecklistItem(item.id);
    expect(await db.checklistOccurrences.count()).toBe(0);
    expect(await listTodosByDate("2026-10-14")).toEqual([]);
  });

  it("rejects impossible dates, empty weekdays, invalid times and backwards ranges", async () => {
    const invalid = [
      { date: "2026-02-30", repeat: "none" },
      { date: "2026-10-14", repeat: "weekly", weekdays: [] },
      { date: "2026-10-14", repeat: "weekly", weekdays: [7] },
      { date: "2026-10-14", repeat: "daily", time: "25:00" },
      { date: "2026-10-14", repeat: "daily", time: "19:00", endTime: "18:00" },
      { date: "2026-10-14", repeat: "daily", endTime: "18:00" },
      { date: "2026-10-14", repeat: "daily", until: "2026-10-13" }
    ];
    const item = await createChecklistItem("", "测试日期");
    for (const schedule of invalid) {
      expect(isValidSchedule(schedule)).toBe(false);
      await expect(updateChecklistItem(item.id, { schedule: schedule as ChecklistSchedule })).rejects.toThrow();
    }
    expect((await db.checklistItems.get(item.id))?.schedule).toBeUndefined();
  });
});
