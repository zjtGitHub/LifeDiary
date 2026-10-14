import { beforeEach, describe, expect, it, vi } from "vitest";
import { createChecklistGroup, createChecklistItem, deleteChecklistGroup, listChecklists, renameChecklistGroup, updateChecklistItem } from "./checklists";
import { addTodo, createBackupPayload, db, listCalendarStatuses, restoreBackupPayload } from "./db";

beforeEach(async () => { await db.delete(); await db.open(); });

describe("undated checklists", () => {
  it("creates groups and tasks over HTTP when randomUUID is unavailable", async () => {
    vi.stubGlobal("crypto", { randomUUID: undefined });
    try {
      const group = await createChecklistGroup("HTTP 清单");
      const first = await createChecklistItem(group.id, "第一项");
      const second = await createChecklistItem(group.id, "第二项");
      expect(new Set([group.id, first.id, second.id]).size).toBe(3);
      expect((await listChecklists()).items).toHaveLength(2);
      db.close(); await db.open();
      expect((await db.checklistItems.get(first.id))?.title).toBe("第一项");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("supports more than nine groups and keeps tasks out of the daily calendar", async () => {
    const groups = await Promise.all(Array.from({ length: 12 }, (_, index) => createChecklistGroup(`分组 ${index + 1}`)));
    const item = await createChecklistItem(groups[11].id, "一个长期想法");
    await renameChecklistGroup(groups[11].id, "长期计划");
    await updateChecklistItem(item.id, { notes: "随时可以开始", completed: true, groupId: groups[0].id });
    await addTodo("2026-05-06", "当天任务");
    const data = await listChecklists();
    expect(data.groups).toHaveLength(12);
    expect(data.groups.find(group => group.id === groups[11].id)?.name).toBe("长期计划");
    expect(data.items[0]).toMatchObject({ groupId: groups[0].id, completed: true, notes: "随时可以开始" });
    expect(data.items[0]).not.toHaveProperty("date");
    expect((await listCalendarStatuses())["2026-05-06"].todoCount).toBe(1);
    db.close(); await db.open();
    expect((await listChecklists()).groups).toHaveLength(12);
  });

  it("moves tasks to the inbox when a group is removed", async () => {
    const group = await createChecklistGroup("旅行");
    const item = await createChecklistItem(group.id, "充电宝");
    await deleteChecklistGroup(group.id);
    expect(await db.checklistGroups.count()).toBe(0);
    expect((await db.checklistItems.get(item.id))?.groupId).toBe("");
  });

  it("backs up groups and tasks and rejects broken group references before clearing data", async () => {
    const group = await createChecklistGroup("学习");
    await createChecklistItem(group.id, "学习一个新知识");
    const payload = await createBackupPayload();
    await db.checklistGroups.clear(); await db.checklistItems.clear();
    await restoreBackupPayload(payload);
    expect((await listChecklists()).items[0].title).toBe("学习一个新知识");
    payload.checklistItems![0].groupId = "missing";
    await expect(restoreBackupPayload(payload)).rejects.toThrow("Invalid checklist data");
    expect(await db.checklistItems.count()).toBe(1);
    const oldBackup = await createBackupPayload();
    delete oldBackup.checklistGroups; delete oldBackup.checklistItems;
    await restoreBackupPayload(oldBackup);
    expect(await db.checklistItems.count()).toBe(0);
  });
});
