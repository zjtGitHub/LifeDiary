import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DiaryDatabase } from "../db";
import { createEnvelope, readBlob, unlockEnvelope, VaultCipher } from "./crypto";
import { encryptedStorage, setVaultCipher, vaultDatabaseName } from "./storage";

describe("encrypted browser database", () => {
  let clear: DiaryDatabase;
  let raw: DiaryDatabase;
  let cipher: VaultCipher;
  beforeEach(async () => {
    vi.stubGlobal("crypto", webcrypto);
    clear = new DiaryDatabase(vaultDatabaseName);
    raw = new DiaryDatabase(vaultDatabaseName);
    await clear.delete();
    cipher = new VaultCipher("test-vault", new Uint8Array(32).fill(7));
    setVaultCipher(cipher);
    clear.use(encryptedStorage());
    await clear.open();
    await raw.open();
  });
  afterEach(async () => {
    clear.close();
    await raw.delete();
    setVaultCipher(null);
    cipher.destroy();
    vi.unstubAllGlobals();
  });

  it("writes only encrypted values, reads via indexes, and updates filtered collections", async () => {
    const date = "2026-11-04";
    const picture = new Blob(["private image body"], { type: "image/png" });
    await clear.dayEntries.put({
      date, text: "a private diary entry", weightKg: 66, waistCm: 81, tags: ["private tag"],
      images: [{ id: "photo", blob: picture, name: "private image name", type: "image/png", createdAt: date }],
      updatedAt: date
    });
    const stored = await raw.table("dayEntries").get(date);
    expect(stored.text).toBeUndefined();
    expect(stored.weightKg).toBeUndefined();
    expect(stored.images).toBeUndefined();
    expect(stored._vault.attachments).toHaveLength(1);
    expect(new TextDecoder().decode(stored._vault.attachments[0].bytes)).not.toContain("private image body");
    expect(await clear.dayEntries.where("date").between("2026-11-01", "2026-11-30", true, true).first()).toMatchObject({
      date, text: "a private diary entry", waistCm: 81
    });

    await clear.dayEntries.filter(entry => entry.tags.includes("private tag")).modify({ text: "new private text" });
    const updated = await clear.dayEntries.get(date);
    expect(updated?.text).toBe("new private text");
    expect(new TextDecoder().decode(await readBlob(updated!.images[0].blob))).toBe("private image body");
    expect((await raw.table("dayEntries").get(date))._vault.files).toEqual(stored._vault.files);
    await clear.dayEntries.where("date").equals(date).delete();
    expect(await raw.dayEntries.count()).toBe(0);
  });

  it("rejects reads of tampered ciphertext and keeps backup recovery independent of the login", async () => {
    const passphrase = "a different long diary passphrase";
    const { envelope, recoveryKey } = await createEnvelope(passphrase);
    const pass = await unlockEnvelope(envelope, passphrase, "passphrase");
    const recovery = await unlockEnvelope(envelope, recoveryKey, "recovery");
    const packed = await pass.pack({ table: "profile", key: "me" }, { id: "me", birthDate: "1990-01-01" });
    expect(recovery.unpack(packed).data).toEqual({ id: "me", birthDate: "1990-01-01" });
    expect(() => recovery.unpack({ ...packed, stamp: "altered" })).toThrow();
    await expect(unlockEnvelope(envelope, "wrong password", "passphrase")).rejects.toThrow("无法解锁");
    pass.destroy();
    recovery.destroy();
  });
});
