import { db } from "./db";
import { newId } from "./stocks";
import type { StockNoteImage } from "../types";

export const stockImageTypes = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"];
export const MAX_STOCK_IMAGE_BYTES = 15 * 1024 * 1024;
export const MAX_STOCK_IMAGES = 20;

async function prepareImage(file: File): Promise<StockNoteImage> {
  if (!stockImageTypes.includes(file.type)) throw new Error("支持 JPG、PNG、WebP、GIF 和 AVIF 图片");
  if (!file.size || file.size > MAX_STOCK_IMAGE_BYTES) throw new Error("单张图片需小于 15 MB，且不能为空");
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve(); image.onerror = () => reject(new Error(`无法读取图片：${file.name}`)); image.src = url;
    });
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 420 / Math.max(image.naturalWidth, image.naturalHeight));
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("当前浏览器无法生成图片预览");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const thumbnail = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("生成图片预览失败")), "image/png"));
    return { id: newId(), blob: file, thumbnail, name: file.name, createdAt: new Date().toISOString() };
  } finally { URL.revokeObjectURL(url); }
}

export async function storeStockImages(files: File[]): Promise<StockNoteImage[]> {
  // Decode the entire selection before writing, so one broken image cannot leave a partial upload.
  const images: StockNoteImage[] = [];
  for (const file of files) images.push(await prepareImage(file));
  await db.stockImages.bulkAdd(images);
  return images;
}
