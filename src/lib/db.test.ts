import { beforeEach, describe, expect, it } from "vitest";
import Dexie from "dexie";
import {
  addImagesToDay,
  addTodo,
  createBackupPayload,
  db,
  DiaryDatabase,
  deleteImageFromDay,
  deleteTodo,
  getDayEntry,
  getWeekSummary,
  getYearMonthSummaries,
  listAllTags,
  listCalendarStatuses,
  listTodosByDate,
  restoreBackupPayload,
  saveBirthDate,
  saveDayTags,
  saveDayText,
  saveMonthlyReflection,
  searchEntries,
  setTodoCompleted
} from "./db";

describe("IndexedDB data layer", () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });

  it("saves and loads diary text and images", async () => {
    await saveDayText("2026-05-05", "今天开始写日记。");
    const file = new File(["image"], "day.png", { type: "image/png" });
    const entryWithImage = await addImagesToDay("2026-05-05", [file]);

    expect(entryWithImage.images).toHaveLength(1);
    expect((await getDayEntry("2026-05-05")).text).toBe("今天开始写日记。");

    await deleteImageFromDay("2026-05-05", entryWithImage.images[0].id);
    expect((await getDayEntry("2026-05-05")).images).toHaveLength(0);
  });

  it("manages todos by date", async () => {
    const todo = await addTodo("2026-05-05", "写计划");
    await addTodo("2026-05-06", "另一天");

    expect(await listTodosByDate("2026-05-05")).toHaveLength(1);

    await setTodoCompleted(todo.id, true);
    expect((await listTodosByDate("2026-05-05"))[0].completed).toBe(true);

    await deleteTodo(todo.id);
    expect(await listTodosByDate("2026-05-05")).toHaveLength(0);
  });

  it("saves profile birth date", async () => {
    const profile = await saveBirthDate("2000-01-01");
    expect(profile.birthDate).toBe("2000-01-01");
  });

  it("tracks tags, calendar statuses, and search results", async () => {
    await saveDayText("2026-05-05", "今天去了海边。");
    await saveDayTags("2026-05-05", ["旅行", "旅行", "照片"]);
    await addTodo("2026-05-05", "整理照片");

    const statuses = await listCalendarStatuses();
    expect(statuses["2026-05-05"].hasDiary).toBe(true);
    expect(statuses["2026-05-05"].openTodoCount).toBe(1);
    expect(await listAllTags()).toEqual(["旅行", "照片"]);
    expect((await searchEntries("海边"))[0].date).toBe("2026-05-05");
    expect((await searchEntries("#旅行"))[0].tags).toContain("旅行");
  });

  it("summarizes a selected life week", async () => {
    await saveDayText("2026-05-05", "周二记录");
    await addTodo("2026-05-06", "周三计划");

    const summary = await getWeekSummary("2026-05-04", "2026-05-10");

    expect(summary.days).toHaveLength(7);
    expect(summary.diaryDays).toBe(1);
    expect(summary.todoCount).toBe(1);
    expect(summary.days.find((day) => day.date === "2026-05-05")?.text).toBe("周二记录");
  });

  it("exports and restores text backup data", async () => {
    await saveBirthDate("2000-01-01");
    await saveDayText("2026-05-05", "备份内容");
    await saveDayTags("2026-05-05", ["备份"]);
    await addTodo("2026-05-05", "备份计划");
    await saveMonthlyReflection("2026-05", "五月总结");

    const payload = await createBackupPayload();
    await db.dayEntries.clear();
    await db.todos.clear();
    await db.profile.clear();
    await db.monthlyReflections.clear();
    await restoreBackupPayload(payload);

    expect((await getDayEntry("2026-05-05")).text).toBe("备份内容");
    expect((await getDayEntry("2026-05-05")).tags).toEqual(["备份"]);
    expect(await listTodosByDate("2026-05-05")).toHaveLength(1);
    expect((await getYearMonthSummaries(2026))[4].reflection).toBe("五月总结");
  });

  it("returns all twelve months with independent summaries and accurate month boundaries", async () => {
    await saveDayText("2025-12-31", "去年记录");
    await saveDayText("2026-01-01", "年初");
    await saveDayText("2026-01-31", "月底");
    await saveDayTags("2026-01-31", ["旅行"]);
    await saveDayText("2026-01-02", "");
    await addImagesToDay("2026-01-03", [new File(["image"], "photo.png", { type: "image/png" })]);
    const done = await addTodo("2026-01-04", "只有计划的日子");
    await setTodoCompleted(done.id, true);
    await addTodo("2026-01-31", "未完成");
    await saveDayText("2026-02-01", "下个月");
    await saveDayText("2026-12-31", "年底");
    await saveMonthlyReflection("2026-01", "一月总结");
    await saveMonthlyReflection("2025-01", "去年总结");

    const months = await getYearMonthSummaries(2026);
    expect(months).toHaveLength(12);
    expect(months[0]).toEqual({
      month: "2026-01", reflection: "一月总结", diaryDays: 2, imageCount: 1,
      todoCount: 2, completedTodoCount: 1, tags: ["旅行"],
      recordedDates: ["2026-01-01", "2026-01-03", "2026-01-04", "2026-01-31"]
    });
    expect(months[1].diaryDays).toBe(1);
    expect(months[2].recordedDates).toEqual([]);
    expect(months[11].diaryDays).toBe(1);
    expect((await getYearMonthSummaries(2025))[0].reflection).toBe("去年总结");
  });

  it("restores old backups without monthly summaries", async () => {
    await saveDayText("2026-05-05", "旧备份的日记");
    const payload = await createBackupPayload();
    delete payload.monthlyReflections;
    await saveMonthlyReflection("2026-05", "当前总结");
    await restoreBackupPayload(payload);
    expect((await getDayEntry("2026-05-05")).text).toBe("旧备份的日记");
    expect(await db.monthlyReflections.count()).toBe(0);
  });

  it("rejects invalid monthly backup data before clearing existing records", async () => {
    await saveMonthlyReflection("2026-05", "保留的总结");
    const payload = await createBackupPayload();
    payload.monthlyReflections![0].month = "2026-13";
    await expect(restoreBackupPayload(payload)).rejects.toThrow("Invalid monthly reflections");
    expect((await getYearMonthSummaries(2026))[4].reflection).toBe("保留的总结");
  });

  it("adds the monthly summary table without losing version 1 data", async () => {
    const name = "riji-migration-test";
    const oldDb = new Dexie(name);
    oldDb.version(1).stores({ dayEntries: "&date, updatedAt", todos: "&id, date, completed, updatedAt", profile: "&id" });
    await oldDb.table("dayEntries").put({ date: "2026-05-05", text: "升级前日记", updatedAt: "2026-05-05" });
    oldDb.close();
    const upgraded = new DiaryDatabase(name);
    try {
      await upgraded.open();
      expect((await upgraded.dayEntries.get("2026-05-05"))?.text).toBe("升级前日记");
      expect(await upgraded.monthlyReflections.count()).toBe(0);
    } finally {
      await upgraded.delete();
    }
  });
});
