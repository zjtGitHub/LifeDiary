import { db } from "./db";
import type { ChecklistGroup, ChecklistItem } from "../types";

export const listChecklists = async () => {
  const [groups, items] = await Promise.all([
    db.checklistGroups.orderBy("createdAt").toArray(),
    db.checklistItems.orderBy("createdAt").toArray()
  ]);
  return { groups, items };
};

export const createChecklistGroup = async (name: string): Promise<ChecklistGroup> => {
  if (!name.trim()) throw new Error("请输入分组名称");
  const timestamp = new Date().toISOString();
  const group = { id: crypto.randomUUID(), name: name.trim(), createdAt: timestamp, updatedAt: timestamp };
  await db.checklistGroups.add(group);
  return group;
};

export const renameChecklistGroup = async (id: string, name: string) => {
  if (!name.trim()) throw new Error("请输入分组名称");
  await db.checklistGroups.update(id, { name: name.trim(), updatedAt: new Date().toISOString() });
};

export const deleteChecklistGroup = async (id: string) => {
  await db.transaction("rw", db.checklistGroups, db.checklistItems, async () => {
    await db.checklistItems.where("groupId").equals(id).modify({ groupId: "", updatedAt: new Date().toISOString() });
    await db.checklistGroups.delete(id);
  });
};

export const createChecklistItem = async (groupId: string, title: string): Promise<ChecklistItem> => {
  if (!title.trim()) throw new Error("请输入任务名称");
  return db.transaction("rw", db.checklistGroups, db.checklistItems, async () => {
    if (groupId && !await db.checklistGroups.get(groupId)) throw new Error("分组不存在");
    const timestamp = new Date().toISOString();
    const item: ChecklistItem = { id: crypto.randomUUID(), groupId, title: title.trim(), notes: "", completed: false, createdAt: timestamp, updatedAt: timestamp };
    await db.checklistItems.add(item);
    return item;
  });
};

export const updateChecklistItem = async (id: string, changes: Partial<Pick<ChecklistItem, "title" | "notes" | "completed" | "groupId">>) => {
  if (changes.title !== undefined && !changes.title.trim()) throw new Error("请输入任务名称");
  await db.transaction("rw", db.checklistGroups, db.checklistItems, async () => {
    if (changes.groupId && !await db.checklistGroups.get(changes.groupId)) throw new Error("分组不存在");
    await db.checklistItems.update(id, { ...changes, ...(changes.title !== undefined ? { title: changes.title.trim() } : {}), updatedAt: new Date().toISOString() });
  });
};

export const deleteChecklistItem = async (id: string) => { await db.checklistItems.delete(id); };
