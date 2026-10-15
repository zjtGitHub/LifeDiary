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
  saveDayWeight,
  saveDayHealth,
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

  it("saves daily weights independently, preserves them during concurrent diary edits, and clears just the weight", async () => {
    await Promise.all([
      saveDayWeight("2026-05-05", 65.25),
      saveDayText("2026-05-05", "一起保存的正文"),
      saveDayTags("2026-05-05", ["运动"])
    ]);
    await saveDayWeight("2026-05-06", 65.1);
    db.close(); await db.open();
    expect(await getDayEntry("2026-05-05")).toMatchObject({ weightKg: 65.25, text: "一起保存的正文", tags: ["运动"] });
    expect((await getDayEntry("2026-05-06")).weightKg).toBe(65.1);
    await saveDayWeight("2026-05-05");
    expect(await getDayEntry("2026-05-05")).toMatchObject({ text: "一起保存的正文", tags: ["运动"] });
    expect((await getDayEntry("2026-05-05")).weightKg).toBeUndefined();
    expect((await getDayEntry("2026-05-06")).weightKg).toBe(65.1);
  });

  it("includes weight-only dates in calendars, searches and monthly history", async () => {
    await saveDayWeight("2026-05-05", 65.25);
    expect((await listCalendarStatuses())["2026-05-05"].hasDiary).toBe(true);
    expect((await searchEntries("2026-05-05"))[0]).toMatchObject({ date: "2026-05-05", weightKg: 65.25 });
    expect((await getYearMonthSummaries(2026))[4].recordedDates).toEqual(["2026-05-05"]);
  });

  it("saves both health fields atomically with diary edits and tracks calorie-only dates including zero and surplus", async () => {
    await Promise.all([
      saveDayHealth("2026-05-05", { weightKg: 65.25, calorieDeficitKcal: 500 }),
      saveDayText("2026-05-05", "一起保存的正文")
    ]);
    await saveDayHealth("2026-05-06", { calorieDeficitKcal: 0 });
    await saveDayHealth("2026-05-07", { calorieDeficitKcal: -150 });
    db.close(); await db.open();
    expect(await getDayEntry("2026-05-05")).toMatchObject({ weightKg: 65.25, calorieDeficitKcal: 500, text: "一起保存的正文" });
    expect((await listCalendarStatuses())["2026-05-06"]).toMatchObject({ hasDiary: true, calorieDeficitKcal: 0 });
    expect((await searchEntries("2026-05-07"))[0].calorieDeficitKcal).toBe(-150);
    expect((await getYearMonthSummaries(2026))[4].recordedDates).toEqual(["2026-05-05", "2026-05-06", "2026-05-07"]);
    await saveDayHealth("2026-05-05", { weightKg: 65.25 });
    expect((await getDayEntry("2026-05-05")).calorieDeficitKcal).toBeUndefined();
    await saveDayHealth("2026-05-05", {});
    expect(await getDayEntry("2026-05-05")).toMatchObject({ text: "一起保存的正文" });
    expect((await getDayEntry("2026-05-05")).weightKg).toBeUndefined();
    expect((await getDayEntry("2026-05-07")).calorieDeficitKcal).toBe(-150);
  });

  it("round trips all health values in backups and rejects invalid calorie data before any overwrite", async () => {
    await saveDayHealth("2026-05-05", { weightKg: 65.25, calorieDeficitKcal: 500 });
    await saveDayHealth("2026-05-06", { calorieDeficitKcal: 0 });
    await saveDayHealth("2026-05-07", { calorieDeficitKcal: -150.5 });
    const payload = await createBackupPayload();
    await restoreBackupPayload(payload);
    expect(await getDayEntry("2026-05-05")).toMatchObject({ weightKg: 65.25, calorieDeficitKcal: 500 });
    expect((await getDayEntry("2026-05-06")).calorieDeficitKcal).toBe(0);
    expect((await getDayEntry("2026-05-07")).calorieDeficitKcal).toBe(-150.5);
    for (const invalid of [NaN, Infinity, "500", null]) {
      await expect(saveDayHealth("2026-05-05", { calorieDeficitKcal: invalid as number })).rejects.toThrow();
      const bad = structuredClone(payload);
      bad.dayEntries[0].calorieDeficitKcal = invalid as number;
      await expect(restoreBackupPayload(bad)).rejects.toThrow("Invalid diary calorie deficit data");
      expect(await getDayEntry("2026-05-05")).toMatchObject({ weightKg: 65.25, calorieDeficitKcal: 500 });
    }
  });

  it("round trips weights in backups, accepts legacy entries and rejects invalid weights before changing any data", async () => {
    await saveDayText("2026-05-05", "保留正文");
    await saveDayWeight("2026-05-05", 65.25);
    const payload = await createBackupPayload();
    expect(payload.dayEntries[0].weightKg).toBe(65.25);
    await saveDayWeight("2026-05-05", 70);
    await restoreBackupPayload(payload);
    expect((await getDayEntry("2026-05-05")).weightKg).toBe(65.25);
    for (const invalid of [0, -1, NaN, Infinity, "65", null]) {
      await expect(saveDayWeight("2026-05-05", invalid as number)).rejects.toThrow();
      const bad = structuredClone(payload);
      bad.dayEntries[0].weightKg = invalid as number;
      await expect(restoreBackupPayload(bad)).rejects.toThrow("Invalid diary weight data");
      expect(await getDayEntry("2026-05-05")).toMatchObject({ weightKg: 65.25, text: "保留正文" });
    }
    delete payload.dayEntries[0].weightKg;
    await restoreBackupPayload(payload);
    expect((await getDayEntry("2026-05-05")).weightKg).toBeUndefined();
    expect((await getDayEntry("2026-05-05")).text).toBe("保留正文");
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
