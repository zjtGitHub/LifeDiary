import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DiaryDatabase } from "../db";
import { readBlob, VaultCipher, type RemoteRecord } from "./crypto";
import { encryptedStorage, setVaultCipher } from "./storage";
import { VaultSync, type SyncState } from "./sync";

let cipher: VaultCipher;
let connections: DiaryDatabase[];
let workers: VaultSync[];

beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
  cipher = new VaultCipher("test-sync", new Uint8Array(32).fill(8));
  setVaultCipher(cipher);
  connections = [];
  workers = [];
});
afterEach(async () => {
  await Promise.all(workers.map(worker => worker.stop()));
  for (const connection of connections) connection.close();
  await Promise.all([...new Set(connections.map(connection => connection.name))].map(name => new DiaryDatabase(name).delete()));
  setVaultCipher(null);
  cipher.destroy();
  vi.unstubAllGlobals();
});

it("syncs separately encrypted image bytes, keeps offline edits, and resolves concurrent writes without overwriting either early", async () => {
  const records = new Map<string, RemoteRecord>();
  const files = new Map<string, Uint8Array>();
  let revision = 0;
  let online = true;
  let dropWriteResponse = false;
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  vi.stubGlobal("fetch", vi.fn(async (path: string, options?: RequestInit) => {
    if (!online) throw new TypeError("offline");
    const url = new URL(path, "https://test.invalid");
    if (url.pathname.endsWith("/changes")) {
      const after = Number(url.searchParams.get("after"));
      return reply({ head: revision, records: [...records.values()].filter(row => row.revision > after).sort((a, b) => a.revision - b.revision) });
    }
    const id = url.pathname.slice(url.pathname.lastIndexOf("/") + 1);
    if (url.pathname.includes("/files/")) {
      if (options?.method === "PUT") {
        files.set(id, options.body as Uint8Array);
        return new Response(null, { status: 204 });
      }
      if (!files.has(id)) return reply({}, 404);
      return new Response(options?.method === "HEAD" ? null : Uint8Array.from(files.get(id)!));
    }
    const input = JSON.parse(options?.body as string);
    const current = records.get(id);
    if ((current?.revision ?? 0) !== input.base) return reply({ conflict: current }, 409);
    const row = { id, revision: ++revision, stamp: input.stamp, cipher: input.cipher, files: input.files };
    records.set(id, row);
    if (dropWriteResponse) { dropWriteResponse = false; throw new TypeError("lost response"); }
    return reply({ revision: row.revision });
  }));

  const device = async (name: string) => {
    const clear = new DiaryDatabase(name, true);
    const raw = new DiaryDatabase(name, true);
    connections.push(clear, raw);
    clear.use(encryptedStorage());
    await clear.open(); await raw.open();
    let state: SyncState | undefined;
    const sync = new VaultSync(raw, cipher, next => { state = next; });
    workers.push(sync);
    return { clear, sync, status: () => state! };
  };
  const laptop = await device("lifediary-sync-laptop");
  const phone = await device("lifediary-sync-phone");
  const date = "2026-11-04";
  await laptop.clear.dayEntries.put({
    date, text: "entry first version", tags: [], updatedAt: date,
    images: [{ id: "image", blob: new Blob(["secret-photo"], { type: "image/jpeg" }), name: "private.jpg", type: "image/jpeg", createdAt: date }]
  });
  await laptop.sync.run();
  expect(laptop.status().phase).toBe("ready");
  expect(files.size).toBe(1);
  expect(JSON.stringify([...records.values()])).not.toContain(date);
  expect(JSON.stringify([...records.values()])).not.toContain("entry first version");
  expect(new TextDecoder().decode([...files.values()][0])).not.toContain("secret-photo");
  await phone.sync.run();
  const mirrored = await phone.clear.dayEntries.get(date);
  expect(mirrored?.text).toBe("entry first version");
  expect(new TextDecoder().decode(await readBlob(mirrored!.images[0].blob))).toBe("secret-photo");

  online = false;
  await laptop.clear.dayEntries.update(date, { text: "offline laptop edit" });
  await laptop.sync.run();
  expect(laptop.status().phase).toBe("offline");
  online = true;
  await phone.clear.dayEntries.update(date, { text: "phone edit" });
  await phone.sync.run();
  await laptop.sync.run();
  expect((await laptop.clear.dayEntries.get(date))?.text).toBe("offline laptop edit");
  expect(laptop.status().conflicts).toHaveLength(1);
  const conflict = laptop.status().conflicts[0];
  const preview = await laptop.sync.preview(conflict);
  expect(preview).toMatchObject({
    local: { text: "offline laptop edit" }, remote: { text: "phone edit" }
  });
  await laptop.sync.resolve(conflict, "local", preview.localStamp);
  await laptop.sync.run();
  await phone.sync.run();
  expect((await phone.clear.dayEntries.get(date))?.text).toBe("offline laptop edit");
  expect(files.size).toBe(1);

  await phone.clear.dayEntries.delete(date);
  await phone.sync.run();
  await laptop.sync.run();
  expect(await laptop.clear.dayEntries.get(date)).toBeUndefined();

  await laptop.clear.todos.add({ id: "racing-todo", date, title: "will delete", completed: false, createdAt: date, updatedAt: date });
  dropWriteResponse = true;
  await laptop.sync.run();
  expect(laptop.status().phase).toBe("offline");
  await laptop.clear.todos.delete("racing-todo");
  await laptop.sync.run();
  expect(await laptop.clear.todos.get("racing-todo")).toBeUndefined();
  expect(laptop.status().conflicts).toHaveLength(1);
  const raced = laptop.status().conflicts[0];
  await laptop.sync.resolve(raced, "local", null);
  await laptop.sync.run();
  await phone.sync.run();
  expect(await phone.clear.todos.get("racing-todo")).toBeUndefined();
});
