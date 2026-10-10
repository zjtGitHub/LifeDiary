import { format } from "date-fns";
import { db } from "./db";
import type { Stock, StockNote, StockNoteContent, StockNoteRevision, StockTimelineItem } from "../types";

export const stockNoteTypes = ["想法", "事件", "操作", "复盘"] as const;
export const stockStances = ["未判断", "偏乐观", "中性", "偏谨慎"] as const;
export const newId = () => typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const now = () => new Date().toISOString();
export const localDateTime = (timestamp: string) => format(new Date(timestamp), "yyyy-MM-dd'T'HH:mm");
export const localDay = (timestamp: string) => format(new Date(timestamp), "yyyy-MM-dd");
export const displayTimestamp = (timestamp: string) => format(new Date(timestamp), "yyyy-MM-dd HH:mm");
export const emptyStockContent = (): StockNoteContent => ({
  occurredAt: now(), title: "", text: "", type: "想法", isKeyNode: false, stance: "未判断",
  tags: [], images: [], reviewOfNoteId: null
});

export function normalizeStockIdentity(market: string, code: string) {
  const normalizedMarket = market.trim().toUpperCase();
  let normalizedCode = code.trim().replace(/\s+/g, "").toUpperCase();
  if (!normalizedMarket || !normalizedCode) throw new Error("请填写市场和股票代码");
  if (["SH", "SZ"].includes(normalizedMarket) && !/^\d{6}$/.test(normalizedCode)) throw new Error("沪深股票代码需要 6 位数字");
  if (normalizedMarket === "HK") {
    if (!/^\d{1,5}$/.test(normalizedCode)) throw new Error("港股代码需要 1—5 位数字");
    normalizedCode = normalizedCode.padStart(5, "0");
  }
  return { market: normalizedMarket, code: normalizedCode };
}

export async function addStock(name: string, market: string, code: string): Promise<{ stock: Stock; existing: boolean }> {
  if (!name.trim()) throw new Error("请填写股票名称");
  const identity = normalizeStockIdentity(market, code);
  return db.transaction("rw", db.stocks, async () => {
    const existing = await db.stocks.where("[market+code]").equals([identity.market, identity.code]).first();
    if (existing) return { stock: existing, existing: true };
    const timestamp = now();
    const stock: Stock = { id: newId(), name: name.trim(), ...identity, pinned: false, archivedAt: null, createdAt: timestamp, updatedAt: timestamp };
    await db.stocks.add(stock);
    return { stock, existing: false };
  });
}

export async function updateStock(id: string, changes: Partial<Pick<Stock, "name" | "pinned" | "archivedAt">>) {
  if (changes.name !== undefined && !changes.name.trim()) throw new Error("股票名称不能为空");
  await db.stocks.update(id, { ...changes, ...(changes.name === undefined ? {} : { name: changes.name.trim() }), updatedAt: now() });
}

export async function createStockDraft(stockId: string, reviewOfNoteId: string | null = null): Promise<StockNote> {
  return db.transaction("rw", db.stocks, db.stockNotes, async () => {
    if (!await db.stocks.get(stockId)) throw new Error("股票不存在");
    if (reviewOfNoteId && (await db.stockNotes.get(reviewOfNoteId))?.stockId !== stockId) throw new Error("原记录不存在");
    const timestamp = now();
    const note: StockNote = {
      id: newId(), stockId, draft: { ...emptyStockContent(), type: reviewOfNoteId ? "复盘" : "想法", reviewOfNoteId },
      currentRevisionId: null, firstPublishedAt: null, deletedAt: null, createdAt: timestamp, updatedAt: timestamp
    };
    await db.stockNotes.add(note);
    return note;
  });
}

export async function saveStockDraft(noteId: string, content: StockNoteContent) {
  await db.transaction("rw", db.stockNotes, db.stockImages, async () => {
    const note = await db.stockNotes.get(noteId);
    if (!note || note.deletedAt) throw new Error("记录不存在或已移入回收站");
    const images = await db.stockImages.bulkGet(content.images.map(image => image.id));
    if (images.some(image => !image)) throw new Error("图片尚未保存，请重试");
    await db.stockNotes.update(noteId, { draft: content, updatedAt: now() });
  });
}

export async function startStockEdit(noteId: string): Promise<StockNote> {
  return db.transaction("rw", db.stockNotes, db.stockRevisions, async () => {
    const note = await db.stockNotes.get(noteId);
    if (!note || note.deletedAt) throw new Error("记录不存在或已移入回收站");
    if (note.draft) return note;
    const revision = note.currentRevisionId ? await db.stockRevisions.get(note.currentRevisionId) : null;
    if (!revision) throw new Error("记录版本不存在");
    const { id, noteId: originalId, stockId, revisionNumber, publishedAt, deleted, ...content } = revision;
    const edited = { ...note, draft: content, updatedAt: now() };
    await db.stockNotes.put(edited);
    return edited;
  });
}

export async function publishStockNote(noteId: string) {
  return db.transaction("rw", db.stockNotes, db.stockRevisions, db.stockImages, async () => {
    const note = await db.stockNotes.get(noteId);
    if (!note?.draft || note.deletedAt) throw new Error("没有可发布的草稿");
    const content = note.draft;
    if (!content.text.trim() && !content.images.length) throw new Error("请填写想法或添加图片");
    if (!Number.isFinite(Date.parse(content.occurredAt)) || Date.parse(content.occurredAt) > Date.now()) throw new Error("记录时间需要是当前或过去的时间");
    if (!stockNoteTypes.includes(content.type) || !stockStances.includes(content.stance)) throw new Error("记录类型或态度无效");
    if ((await db.stockImages.bulkGet(content.images.map(image => image.id))).some(image => !image)) throw new Error("记录图片缺失");
    if (content.reviewOfNoteId && (await db.stockNotes.get(content.reviewOfNoteId))?.stockId !== note.stockId) throw new Error("关联复盘的原记录不存在");
    const previous = note.currentRevisionId ? await db.stockRevisions.get(note.currentRevisionId) : null;
    const timestamp = now();
    const revision: StockNoteRevision = {
      ...content, title: content.title.trim() || content.text.trim().split("\n")[0].slice(0, 80) || "图片记录",
      tags: Array.from(new Set(content.tags.map(tag => tag.trim().replace(/^#/, "")).filter(Boolean))).slice(0, 16),
      id: newId(), noteId, stockId: note.stockId, revisionNumber: (previous?.revisionNumber ?? 0) + 1, publishedAt: timestamp, deleted: false
    };
    await db.stockRevisions.add(revision);
    await db.stockNotes.update(noteId, { draft: null, currentRevisionId: revision.id, firstPublishedAt: note.firstPublishedAt ?? timestamp, updatedAt: timestamp });
    return revision;
  });
}

export async function setStockNoteDeleted(noteId: string, deleted: boolean) {
  await db.transaction("rw", db.stockNotes, db.stockRevisions, async () => {
    const note = await db.stockNotes.get(noteId);
    const previous = note?.currentRevisionId ? await db.stockRevisions.get(note.currentRevisionId) : null;
    if (!note || !previous) throw new Error("已发布记录不存在");
    if (Boolean(note.deletedAt) === deleted) return;
    const timestamp = now();
    const revision = { ...previous, id: newId(), revisionNumber: previous.revisionNumber + 1, publishedAt: timestamp, deleted };
    await db.stockRevisions.add(revision);
    await db.stockNotes.update(noteId, { currentRevisionId: revision.id, deletedAt: deleted ? timestamp : null, updatedAt: timestamp });
  });
}

export interface StockFilters {
  cutoff?: string; strict?: boolean; keyOnly?: boolean; query?: string; year?: string; month?: string; trash?: boolean;
}

export function cutoffEnd(date: string): number {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!parts) throw new Error("回看日期无效");
  const day = new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
  if (localDay(day.toISOString()) !== date) throw new Error("回看日期无效");
  day.setDate(day.getDate() + 1);
  return day.getTime() - 1;
}

export async function listStockTimeline(stockId: string, filters: StockFilters = {}): Promise<StockTimelineItem[]> {
  const notes = await db.stockNotes.where("stockId").equals(stockId).toArray();
  const end = filters.cutoff ? cutoffEnd(filters.cutoff) : Infinity;
  const historical = Boolean(filters.cutoff && filters.strict);
  const revisions = historical
    ? await db.stockRevisions.where("stockId").equals(stockId).filter(item => Date.parse(item.publishedAt) <= end).toArray()
    : (await db.stockRevisions.bulkGet(notes.map(note => note.currentRevisionId ?? ""))).filter((item): item is StockNoteRevision => Boolean(item));
  const query = filters.query?.trim().toLocaleLowerCase() ?? "";
  const byNote = new Map<string, StockNoteRevision[]>();
  for (const revision of revisions) {
    const items = byNote.get(revision.noteId) ?? []; items.push(revision); byNote.set(revision.noteId, items);
  }
  return notes.flatMap(note => {
    const versions = byNote.get(note.id)?.sort((a, b) => b.revisionNumber - a.revisionNumber);
    const revision = versions?.[0];
    if (!revision || revision.deleted !== Boolean(filters.trash) || Date.parse(revision.occurredAt) > end) return [];
    const date = localDay(revision.occurredAt);
    if (filters.keyOnly && !revision.isKeyNode || filters.year && !date.startsWith(filters.year) || filters.month && date.slice(5, 7) !== filters.month) return [];
    if (query && ![revision.title, revision.text, ...revision.tags].join(" ").toLocaleLowerCase().includes(query)) return [];
    return [{ note, revision, versionCount: revision.revisionNumber }];
  }).sort((a, b) => b.revision.occurredAt.localeCompare(a.revision.occurredAt) || b.note.createdAt.localeCompare(a.note.createdAt) || b.note.id.localeCompare(a.note.id));
}
