import { webcrypto } from "node:crypto";
import { expect, it, vi } from "vitest";

it("imports a legacy backup into an encrypted vault atomically", async () => {
  vi.stubGlobal("crypto", webcrypto);
  vi.stubEnv("VITE_PRIVATE_SYNC", "1");
  vi.resetModules();
  const { db, restoreBackupPayload, getDayEntry } = await import("../db");
  const storage = await import("./storage");
  const { VaultCipher } = await import("./crypto");
  const cipher = new VaultCipher("restore-test", new Uint8Array(32).fill(9));
  storage.setVaultCipher(cipher);
  storage.allowPrivateBackupImport(true);
  try {
    await db.delete(); await db.open();
    const entries = Array.from({ length: 45 }, (_, index) => ({
      date: `2026-10-${String(index + 1).padStart(2, "0")}`,
      text: index ? `entry ${index}` : "restore private entry",
      tags: [],
      images: index ? [] : [{ id: "image", name: "photo.png", type: "image/png", dataUrl: "data:image/png;base64,cHJpdmF0ZSBwaWN0dXJl", createdAt: "2026-11-04T00:00:00.000Z" }],
      updatedAt: "2026-11-04T00:00:00.000Z"
    }));
    // Include enough rows to exercise multiple encrypted batches.
    entries.forEach((entry, index) => { entry.date = new Date(Date.UTC(2026, 8, 1 + index)).toISOString().slice(0, 10); });
    entries[0].date = "2026-11-04";
    const payload = {
      app: "riji" as const, version: 1 as const, exportedAt: "2026-11-06T00:00:00.000Z",
      profile: { id: "me" as const }, dayEntries: entries, todos: []
    };
    await expect(restoreBackupPayload({ ...payload, todos: [{} as never] })).rejects.toThrow();
    expect(await db.dayEntries.count()).toBe(0);
    expect(await db.profile.count()).toBe(0);
    const progress: string[] = [];
    await restoreBackupPayload(payload, message => progress.push(message));
    expect(await db.dayEntries.count()).toBe(45);
    expect(progress.some(message => message.includes("20/45"))).toBe(true);
    expect(progress[progress.length - 1]).toBe("正在提交本机数据…");
    expect((await getDayEntry("2026-11-04")).text).toBe("restore private entry");
  } finally {
    await db.delete();
    storage.setVaultCipher(null);
    cipher.destroy(); vi.unstubAllGlobals(); vi.unstubAllEnvs();
  }
}, 5000);
