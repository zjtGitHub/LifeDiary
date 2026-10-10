import type { Stock, StockNote, StockNoteContent, StockNoteImage, StockNoteRevision } from "../types";

export interface StockBackupData {
  stocks: Stock[];
  notes: StockNote[];
  revisions: StockNoteRevision[];
  images: { id: string; name: string; createdAt: string; dataUrl: string; thumbnailDataUrl: string }[];
}
export interface StockBackupTables {
  stocks: Stock[]; notes: StockNote[]; revisions: StockNoteRevision[]; images: StockNoteImage[];
}
function fail(): never { throw new Error("股票备忘录备份数据无效或关联不完整"); }
const isTime = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
const isString = (value: unknown): value is string => typeof value === "string";
const unique = (items: { id: string }[]) => {
  const ids = new Set<string>();
  for (const item of items) { if (!item || !isString(item.id) || !item.id || ids.has(item.id)) fail(); ids.add(item.id); }
  return ids;
};
const toDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob);
});
const fromDataUrl = (url: string): Blob => {
  const match = /^data:(image\/(?:png|jpeg|webp|gif|avif));base64,([A-Za-z0-9+/]*={0,2})$/.exec(url);
  if (!match) return fail();
  try {
    const data = atob(match[2]);
    if (!data.length || data.length > 15 * 1024 * 1024) return fail();
    return new Blob([Uint8Array.from(data, char => char.charCodeAt(0))], { type: match[1] });
  } catch { return fail(); }
};

export async function encodeStockBackup(data: StockBackupTables): Promise<StockBackupData> {
  const referenced = new Set([
    ...data.notes.flatMap(note => note.draft?.images.map(image => image.id) ?? []),
    ...data.revisions.flatMap(revision => revision.images.map(image => image.id))
  ]);
  return {
    stocks: data.stocks, notes: data.notes, revisions: data.revisions,
    images: await Promise.all(data.images.filter(image => referenced.has(image.id)).map(async image => ({
      id: image.id, name: image.name, createdAt: image.createdAt,
      dataUrl: await toDataUrl(image.blob), thumbnailDataUrl: await toDataUrl(image.thumbnail)
    })))
  };
}

export function decodeStockBackup(data?: StockBackupData): StockBackupTables {
  if (data === undefined) return { stocks: [], notes: [], revisions: [], images: [] };
  if (!data || !Array.isArray(data.stocks) || !Array.isArray(data.notes) || !Array.isArray(data.revisions) || !Array.isArray(data.images)) return fail();
  const stockIds = unique(data.stocks); unique(data.notes); unique(data.revisions); const imageIds = unique(data.images);
  const identities = new Set<string>();
  for (const stock of data.stocks) {
    if (![stock.name, stock.market, stock.code].every(value => isString(value) && value.trim()) || typeof stock.pinned !== "boolean" || !isTime(stock.createdAt) || !isTime(stock.updatedAt) || stock.archivedAt !== null && !isTime(stock.archivedAt)) fail();
    const normalizedCode = stock.market.trim().toUpperCase() === "HK" && /^\d{1,5}$/.test(stock.code) ? stock.code.padStart(5, "0") : stock.code.trim().replace(/\s+/g, "").toUpperCase();
    if (stock.market !== stock.market.trim().toUpperCase() || stock.code !== normalizedCode) fail();
    const key = JSON.stringify([stock.market, stock.code]); if (identities.has(key)) fail(); identities.add(key);
  }
  const notesById = new Map(data.notes.map(note => [note.id, note]));
  const revisionsById = new Map(data.revisions.map(revision => [revision.id, revision]));
  const contentValid = (content: StockNoteContent, stockId: string, ownNoteId: string, draft = false) => {
    if (!content || !(isTime(content.occurredAt) || draft && content.occurredAt === "") || !isString(content.title) || !isString(content.text) || !["想法", "事件", "操作", "复盘"].includes(content.type) || !["未判断", "偏乐观", "中性", "偏谨慎"].includes(content.stance) || typeof content.isKeyNode !== "boolean") fail();
    if (!Array.isArray(content.tags) || !content.tags.every(isString) || !Array.isArray(content.images) || content.images.length > 20 || !content.images.every(image => image && imageIds.has(image.id) && isString(image.caption))) fail();
    if (new Set(content.images.map(image => image.id)).size !== content.images.length) fail();
    if (content.reviewOfNoteId !== null && (content.reviewOfNoteId === ownNoteId || notesById.get(content.reviewOfNoteId)?.stockId !== stockId)) fail();
  };
  const perNote = new Map<string, StockNoteRevision[]>();
  for (const revision of data.revisions) {
    if (notesById.get(revision.noteId)?.stockId !== revision.stockId || !stockIds.has(revision.stockId) || !Number.isInteger(revision.revisionNumber) || revision.revisionNumber < 1 || !isTime(revision.publishedAt) || typeof revision.deleted !== "boolean") fail();
    contentValid(revision, revision.stockId, revision.noteId);
    if (!revision.text.trim() && !revision.images.length) fail();
    const versions = perNote.get(revision.noteId) ?? []; versions.push(revision); perNote.set(revision.noteId, versions);
  }
  for (const note of data.notes) {
    if (!stockIds.has(note.stockId) || !isTime(note.createdAt) || !isTime(note.updatedAt) || note.deletedAt !== null && !isTime(note.deletedAt) || note.firstPublishedAt !== null && !isTime(note.firstPublishedAt)) fail();
    if (note.draft !== null) contentValid(note.draft, note.stockId, note.id, true);
    const versions = (perNote.get(note.id) ?? []).sort((a, b) => a.revisionNumber - b.revisionNumber);
    if (note.currentRevisionId === null) {
      if (versions.length || note.firstPublishedAt !== null || note.deletedAt !== null || note.draft === null) fail();
    } else {
      const revision = revisionsById.get(note.currentRevisionId);
      if (!revision || revision.noteId !== note.id || revision.id !== versions[versions.length - 1]?.id || Boolean(note.deletedAt) !== revision.deleted || note.firstPublishedAt !== versions[0]?.publishedAt) fail();
      if (note.deletedAt !== null && note.deletedAt !== revision.publishedAt) fail();
      if (versions.some((item, index) => item.revisionNumber !== index + 1 || index > 0 && Date.parse(item.publishedAt) < Date.parse(versions[index - 1].publishedAt))) fail();
    }
  }
  const images = data.images.map(image => {
    if (!isString(image.name) || !isTime(image.createdAt) || !isString(image.dataUrl) || !isString(image.thumbnailDataUrl)) fail();
    return { id: image.id, name: image.name, createdAt: image.createdAt, blob: fromDataUrl(image.dataUrl), thumbnail: fromDataUrl(image.thumbnailDataUrl) };
  });
  return { stocks: data.stocks, notes: data.notes, revisions: data.revisions, images };
}
