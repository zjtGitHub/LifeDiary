import Dexie from "dexie";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createBackupPayload, db, DiaryDatabase, getDayEntry, restoreBackupPayload, saveDayText } from "./db";
import { addStock, createStockDraft, emptyStockContent, listStockTimeline, publishStockNote, saveStockDraft, setStockNoteDeleted, startStockEdit, updateStock } from "./stocks";

const at = (time: string) => new Date(time).toISOString();
const clock = (time: string) => vi.setSystemTime(new Date(time));
async function record(stockId: string, text: string, time = "2026-03-12T09:30:00") {
  const note = await createStockDraft(stockId);
  await saveStockDraft(note.id, { ...note.draft!, text, occurredAt: at(time) });
  await publishStockNote(note.id); return note;
}

describe("stock memo persistence and historical views", () => {
  beforeEach(async () => { await db.delete(); await db.open(); clock("2026-03-12T12:00:00"); });

  it("normalizes identity, opens duplicates, and separates the same name across markets", async () => {
    const first = await addStock("示例公司", " hk ", "700");
    expect(first.stock.code).toBe("00700");
    expect((await addStock("另一个名称", "HK", "00700")).stock.id).toBe(first.stock.id);
    const other = await addStock("示例公司", "US", "demo");
    expect(other.stock.id).not.toBe(first.stock.id);
    expect(other.stock.code).toBe("DEMO");
    await expect(addStock("无效", "SH", "123")).rejects.toThrow("6 位数字");
    await updateStock(first.stock.id, { archivedAt: at("2026-03-12T11:00:00"), pinned: true });
    expect((await addStock("示例公司", "HK", "700")).existing).toBe(true);
    expect(await db.stocks.count()).toBe(2);
  });

  it("keeps multiple same-day notes ordered and isolates drafts and other stocks", async () => {
    const { stock } = await addStock("甲", "US", "AAA");
    const other = (await addStock("乙", "US", "BBB")).stock;
    await record(stock.id, "早上的理解"); await record(stock.id, "午间的理解", "2026-03-12T11:00:00");
    await record(other.id, "另一只股票");
    const draft = await createStockDraft(stock.id);
    await Promise.all([saveStockDraft(draft.id, { ...draft.draft!, text: "第一个输入" }), saveStockDraft(draft.id, { ...draft.draft!, text: "最后的输入" })]);
    expect((await db.stockNotes.get(draft.id))?.draft?.text).toBe("最后的输入");
    expect((await listStockTimeline(stock.id)).map(item => item.revision.text)).toEqual(["午间的理解", "早上的理解"]);
  });

  it("restores the old time, tags, stance, key flag and image captions when viewing a historical date", async () => {
    const { stock } = await addStock("甲", "US", "AAA");
    await db.stockImages.add({ id: "image-a", name: "依据.png", blob: new Blob(["image"], { type: "image/png" }), thumbnail: new Blob(["thumb"], { type: "image/png" }), createdAt: new Date().toISOString() });
    const note = await createStockDraft(stock.id);
    await saveStockDraft(note.id, { ...note.draft!, text: "当时的想法", stance: "偏乐观", tags: ["原假设"], images: [{ id: "image-a", caption: "当时的依据" }] });
    await publishStockNote(note.id);
    clock("2026-03-20T12:00:00");
    const edited = await startStockEdit(note.id);
    await saveStockDraft(note.id, { ...edited.draft!, text: "后来修改的想法", occurredAt: at("2026-03-11T10:00:00"), stance: "偏谨慎", tags: ["新理解"], isKeyNode: true, images: [{ id: "image-a", caption: "后来改的说明" }] });
    await publishStockNote(note.id);
    const original = (await listStockTimeline(stock.id, { cutoff: "2026-03-15", strict: true }))[0];
    expect(original.revision).toMatchObject({ text: "当时的想法", stance: "偏乐观", tags: ["原假设"], isKeyNode: false, images: [{ id: "image-a", caption: "当时的依据" }] });
    expect(original.versionCount).toBe(1);
    expect(await listStockTimeline(stock.id, { cutoff: "2026-03-15", strict: true, keyOnly: true })).toHaveLength(0);
    expect((await listStockTimeline(stock.id, { cutoff: "2026-03-15" }))[0].revision.text).toBe("后来修改的想法");
  });

  it("excludes later backfills and respects local end of day", async () => {
    const { stock } = await addStock("甲", "US", "AAA");
    clock("2026-03-13T00:10:00");
    await record(stock.id, "后来补记", "2026-03-12T23:59:00");
    expect(await listStockTimeline(stock.id, { cutoff: "2026-03-12" })).toHaveLength(1);
    expect(await listStockTimeline(stock.id, { cutoff: "2026-03-12", strict: true })).toHaveLength(0);
    expect(await listStockTimeline(stock.id, { cutoff: "2026-03-13", strict: true })).toHaveLength(1);
  });

  it("preserves historical deletion and restoration state and links a new review", async () => {
    const { stock } = await addStock("甲", "US", "AAA");
    const original = await record(stock.id, "最初想法");
    clock("2026-03-14T12:00:00");
    const review = await createStockDraft(stock.id, original.id);
    await saveStockDraft(review.id, { ...review.draft!, text: "补充复盘" }); await publishStockNote(review.id);
    expect((await listStockTimeline(stock.id))[0].revision.reviewOfNoteId).toBe(original.id);
    clock("2026-03-15T12:00:00"); await setStockNoteDeleted(original.id, true);
    expect(await listStockTimeline(stock.id, { trash: true })).toHaveLength(1);
    expect(await listStockTimeline(stock.id, { cutoff: "2026-03-13", strict: true })).toHaveLength(1);
    expect(await listStockTimeline(stock.id, { cutoff: "2026-03-15", strict: true })).toHaveLength(1);
    clock("2026-03-16T12:00:00"); await setStockNoteDeleted(original.id, false);
    expect(await listStockTimeline(stock.id)).toHaveLength(2);
    expect(await listStockTimeline(stock.id, { cutoff: "2026-03-15", strict: true })).toHaveLength(1);
    expect((await listStockTimeline(stock.id, { cutoff: "2026-03-15", strict: true, trash: true }))[0].note.id).toBe(original.id);
  });

  it("validates publishing and supports combined search, year and month filters", async () => {
    const { stock } = await addStock("甲", "US", "AAA");
    const draft = await createStockDraft(stock.id);
    await expect(publishStockNote(draft.id)).rejects.toThrow("填写想法");
    await saveStockDraft(draft.id, { ...draft.draft!, text: "未来", occurredAt: at("2027-01-01T00:00:00") });
    await expect(publishStockNote(draft.id)).rejects.toThrow("过去的时间");
    await saveStockDraft(draft.id, { ...draft.draft!, text: "客户反馈", tags: ["产品"], isKeyNode: true }); await publishStockNote(draft.id);
    expect(await listStockTimeline(stock.id, { year: "2026", month: "03", keyOnly: true, query: "产品" })).toHaveLength(1);
    expect(await listStockTimeline(stock.id, { month: "02" })).toHaveLength(0);
    expect(await db.stockRevisions.count()).toBe(1);
  });

  it("round trips images, draft edits, archived stocks, reviews, revisions and trash with diary data", async () => {
    const { stock } = await addStock("甲", "US", "AAA"); await saveDayText("2026-03-12", "日记数据");
    await db.stockImages.add({ id: "picture", name: "截图.png", blob: new Blob(["image"], { type: "image/png" }), thumbnail: new Blob(["thumb"], { type: "image/png" }), createdAt: new Date().toISOString() });
    const note = await createStockDraft(stock.id);
    await saveStockDraft(note.id, { ...note.draft!, text: "有图片的想法", images: [{ id: "picture", caption: "当时依据" }] }); await publishStockNote(note.id);
    const review = await createStockDraft(stock.id, note.id); await saveStockDraft(review.id, { ...review.draft!, text: "复盘" }); await publishStockNote(review.id);
    await startStockEdit(review.id); await setStockNoteDeleted(note.id, true); await updateStock(stock.id, { archivedAt: new Date().toISOString() });
    const payload = await createBackupPayload();
    await db.delete(); await db.open(); await restoreBackupPayload(payload);
    expect((await getDayEntry("2026-03-12")).text).toBe("日记数据");
    expect((await db.stocks.get(stock.id))?.archivedAt).not.toBeNull();
    expect((await db.stockImages.get("picture"))?.blob.size).toBe(5);
    expect((await db.stockNotes.get(review.id))?.draft?.reviewOfNoteId).toBe(note.id);
    expect((await listStockTimeline(stock.id, { trash: true }))[0].revision.images[0].caption).toBe("当时依据");
    expect(await db.stockRevisions.count()).toBe(3);
  });

  it("rejects missing image references and invalid revisions before clearing any existing data", async () => {
    const { stock } = await addStock("甲", "US", "AAA"); await record(stock.id, "保留的想法"); await saveDayText("2026-03-12", "保留的日记");
    const payload = await createBackupPayload();
    payload.stockMemo!.revisions[0].images = [{ id: "missing", caption: "" }];
    await expect(restoreBackupPayload(payload)).rejects.toThrow("备份数据无效");
    expect((await listStockTimeline(stock.id))[0].revision.text).toBe("保留的想法");
    expect((await getDayEntry("2026-03-12")).text).toBe("保留的日记");
    const invalid = await createBackupPayload(); invalid.stockMemo!.notes[0].currentRevisionId = "missing";
    await expect(restoreBackupPayload(invalid)).rejects.toThrow("备份数据无效");
  });

  it("imports legacy backups and preserves an incomplete date in an unpublished draft", async () => {
    const { stock } = await addStock("甲", "US", "AAA");
    const draft = await createStockDraft(stock.id); await saveStockDraft(draft.id, { ...emptyStockContent(), occurredAt: "", text: "编辑中的草稿" });
    const payload = await createBackupPayload(); await restoreBackupPayload(payload);
    expect((await db.stockNotes.get(draft.id))?.draft?.occurredAt).toBe("");
    delete payload.stockMemo; await restoreBackupPayload(payload);
    expect(await db.stocks.count()).toBe(0);
  });

  it("upgrades version 2 without losing existing diary and monthly summaries", async () => {
    const old = new Dexie("stock-upgrade-test");
    old.version(1).stores({ dayEntries: "&date, updatedAt", todos: "&id, date, completed, updatedAt", profile: "&id" });
    old.version(2).stores({ monthlyReflections: "&month, updatedAt" });
    await old.table("dayEntries").put({ date: "2026-03-12", text: "旧日记", images: [], tags: [], updatedAt: new Date().toISOString() });
    await old.table("monthlyReflections").put({ month: "2026-03", text: "旧总结", updatedAt: new Date().toISOString() }); old.close();
    const upgraded = new DiaryDatabase("stock-upgrade-test");
    try { await upgraded.open(); expect((await upgraded.dayEntries.get("2026-03-12"))?.text).toBe("旧日记"); expect((await upgraded.monthlyReflections.get("2026-03"))?.text).toBe("旧总结"); expect(await upgraded.stocks.count()).toBe(0); }
    finally { await upgraded.delete(); }
  });
});
