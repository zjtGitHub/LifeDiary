import { DiaryDatabase, diaryTables } from "../db";
import { jsonRequest, SyncHttpError, vaultError, vaultFetch, vaultJson } from "./api";
import type { Identity, RemoteRecord, SealedRow, StoredPayload, VaultCipher } from "./crypto";
import { allowPrivateBackupImport, type Baseline, deletionKey, rowWithIndexes, vaultDatabaseName } from "./storage";

export const openRawVault = () => new DiaryDatabase(vaultDatabaseName);
const baseKey = (id: string) => `base:${id}`;
export const remoteCommitEvent = "diary-vault-remote-commit";
export interface SyncState {
  phase: "syncing" | "ready" | "offline" | "login" | "error";
  message: string;
  conflicts: RemoteRecord[];
}
interface UpdateResult { revision?: number; conflict?: RemoteRecord | null }

export class VaultSync {
  readonly #abort = new AbortController();
  #busy: Promise<void> | null = null;
  #again = false;

  constructor(
    readonly raw: DiaryDatabase,
    readonly cipher: VaultCipher,
    readonly report: (state: SyncState) => void,
    readonly editorIsBusy: () => boolean = () => false
  ) {}

  stop() { this.#abort.abort(); return this.#busy; }

  #table(identity: Identity) {
    if (!diaryTables(this.raw).some(table => table.name === identity.table)) throw new Error("同步记录的类型无效。");
    return this.raw.table<SealedRow, Identity["key"]>(identity.table);
  }

  #inspect(record: RemoteRecord) {
    const info = this.cipher.inspect(record);
    const table = this.#table(info);
    const compound = table.core.schema.primaryKey.compound;
    if (compound ? !Array.isArray(info.key) || !info.key.every(key => typeof key === "string") : typeof info.key !== "string") {
      throw new Error("同步记录标识无效。");
    }
    return info;
  }

  async #download(record: RemoteRecord, cached?: StoredPayload): Promise<StoredPayload> {
    const attachments = [];
    for (const id of record.files) {
      const known = cached?.attachments.find(file => file.id === id);
      if (known) { attachments.push(known); continue; }
      const response = await vaultFetch(`files/${id}`, { signal: this.#abort.signal }, this.cipher.vaultId);
      if (!response.ok) throw await vaultError(response);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (!this.cipher.acceptsFile(id, bytes)) throw new Error("服务器附件校验失败。");
      attachments.push({ id, bytes });
    }
    return { ...record, attachments };
  }

  async #apply(record: RemoteRecord) {
    const identity = this.#inspect(record);
    const table = this.#table(identity);
    const meta = this.raw.vaultMeta;
    const slot = baseKey(record.id);
    const [cached, previous] = await Promise.all([table.get(identity.key), meta.get(slot)]);
    const wireIsDeletion = identity.json === "null";
    const shouldDownload = record.revision > (previous?.baseline?.revision ?? 0) &&
      !wireIsDeletion && cached?._vault.stamp !== record.stamp;
    const incoming = shouldDownload ? await this.#download(record, cached?._vault) : null;
    const opened = incoming ? this.cipher.unpack(incoming) : null;
    const replacement = opened?.data && incoming ? rowWithIndexes(table.core.schema, opened.data, incoming) : null;
    if (replacement && JSON.stringify(table.core.schema.primaryKey.extractKey?.(replacement)) !== JSON.stringify(identity.key)) {
      throw new Error("同步记录与其标识不匹配。");
    }
    this.#abort.signal.throwIfAborted();
    return this.raw.transaction("rw", table, meta, async () => {
      const current = await table.get(identity.key);
      const base = (await meta.get(slot))?.baseline;
      const stamp = current?._vault.stamp ?? null;
      let changed = false;
      if (record.revision > (base?.revision ?? 0)) {
        const incomingStamp = wireIsDeletion ? null : record.stamp;
        const pending = stamp !== (base?.stamp ?? null) || Boolean(await meta.get(deletionKey(record.id)));
        if (stamp === incomingStamp || !pending) {
          if (stamp !== incomingStamp) {
            if (this.editorIsBusy()) return null;
            if (wireIsDeletion) await table.delete(identity.key);
            else {
              if (!replacement) throw new Error("同步版本变化，请重试。");
              await table.put(replacement);
            }
            changed = true;
          }
          await meta.delete(deletionKey(record.id));
          await meta.put({ id: slot, baseline: { table: identity.table, key: identity.key, revision: record.revision, stamp: incomingStamp } });
        } else {
          await meta.put({
            id: slot,
            baseline: { table: identity.table, key: identity.key, revision: base?.revision ?? 0, stamp: base?.stamp ?? null, conflict: record }
          });
        }
      }
      const cursor = (await meta.get("cursor"))?.cursor ?? 0;
      if (record.revision > cursor) await meta.put({ id: "cursor", cursor: record.revision });
      return changed;
    });
  }

  async #pull() {
    let after = (await this.raw.vaultMeta.get("cursor"))?.cursor ?? 0;
    let changed = false;
    try {
      for (;;) {
        const batch = await vaultJson<{ head: number; records: RemoteRecord[] }>(`changes?after=${after}`, { signal: this.#abort.signal }, this.cipher.vaultId);
        for (const record of batch.records) {
          if (record.revision <= after) throw new Error("服务器返回了无效的同步顺序。");
          const applied = await this.#apply(record);
          if (applied === null) return false;
          if (applied) changed = true;
          after = record.revision;
        }
        if (after >= batch.head) return true;
        if (!batch.records.length) throw new Error("服务器返回了不完整的同步结果。");
      }
    } finally {
      if (changed && !this.#abort.signal.aborted) {
        window.dispatchEvent(new Event("diary-data-changed"));
        window.dispatchEvent(new Event(remoteCommitEvent));
      }
    }
  }

  async #pushRecord(record: StoredPayload, identity: Identity, base: Baseline | undefined) {
    const { signal } = this.#abort;
    for (const file of record.attachments) {
      const head = await vaultFetch(`files/${file.id}`, { method: "HEAD", signal }, this.cipher.vaultId);
      if (head.ok) continue;
      if (head.status !== 404) throw await vaultError(head);
      const upload = await vaultFetch(`files/${file.id}`, {
        method: "PUT", headers: { "Content-Type": "application/octet-stream" },
        body: Uint8Array.from(file.bytes), signal
      }, this.cipher.vaultId);
      if (!upload.ok) throw await vaultError(upload);
    }
    const response = await vaultFetch(`records/${record.id}`, {
      ...jsonRequest("PUT", { base: base?.revision ?? 0, stamp: record.stamp, cipher: record.cipher, files: record.files }), signal
    }, this.cipher.vaultId);
    if (response.status === 409) {
      const result = await response.json() as UpdateResult;
      if (result.conflict) return false;
      throw new SyncHttpError(409, "服务器同步历史与本机不一致，请核对备份。");
    }
    if (!response.ok) throw await vaultError(response);
    const { revision } = await response.json() as UpdateResult;
    if (revision === undefined) throw new Error("服务器未确认保存结果。");
    signal.throwIfAborted();
    const meta = this.raw.vaultMeta;
    await this.raw.transaction("rw", meta, async () => {
      await meta.put({
        id: baseKey(record.id),
        baseline: { ...identity, revision, stamp: this.cipher.inspect(record).json === "null" ? null : record.stamp }
      });
      const pending = (await meta.get(deletionKey(record.id)))?.deletion;
      if (pending?.record.stamp === record.stamp) await meta.delete(deletionKey(record.id));
    });
    return true;
  }

  async #push() {
    const tables = diaryTables(this.raw);
    const { rows, bases, deletions } = await this.raw.transaction("r", [...tables, this.raw.vaultMeta], async () => ({
      rows: (await Promise.all(tables.map(table => table.toArray() as Promise<SealedRow[]>))).flat(),
      bases: await this.raw.vaultMeta.where("id").startsWith("base:").toArray(),
      deletions: await this.raw.vaultMeta.where("id").startsWith("delete:").toArray()
    }));
    const byId = new Map(bases.map(entry => [entry.id.slice(5), entry.baseline!]));
    let raced = false;
    for (const { _vault } of rows) {
      const base = byId.get(_vault.id);
      if (base?.conflict || base?.stamp === _vault.stamp) continue;
      const { table, key } = this.cipher.inspect(_vault);
      if (!await this.#pushRecord(_vault, { table, key }, base)) raced = true;
    }
    for (const item of deletions) {
      const { identity, record } = item.deletion!;
      const base = byId.get(record.id);
      if (base?.conflict) continue;
      if (!await this.#pushRecord(record, identity, base)) raced = true;
    }
    return raced;
  }

  async #conflicts() {
    const bases = await this.raw.vaultMeta.where("id").startsWith("base:").toArray();
    return bases.flatMap(row => row.baseline?.conflict ? [row.baseline.conflict] : []);
  }

  async #run() {
    const conflicts = () => this.#conflicts();
    if (this.#abort.signal.aborted) return;
    this.report({ phase: "syncing", message: "正在同步…", conflicts: await conflicts() });
    try {
      let caughtUp = await this.#pull();
      if (!this.#abort.signal.aborted) allowPrivateBackupImport(caughtUp);
      const raced = await this.#push();
      if (raced || !caughtUp) caughtUp = await this.#pull();
      if (!this.#abort.signal.aborted) {
        const items = await conflicts();
        const message = items.length ? "有同步冲突待处理" : caughtUp ? "已同步到服务器" : "其他设备的更新会在结束编辑后应用";
        this.report({ phase: "ready", message, conflicts: items });
      }
    } catch (error) {
      if (this.#abort.signal.aborted) return;
      const phase = error instanceof SyncHttpError && error.status === 401 ? "login" : error instanceof TypeError ? "offline" : "error";
      const message = phase === "offline" ? "离线或服务器不可达，修改保存在本机" : error instanceof Error ? error.message : "同步暂时失败。";
      this.report({ phase, message, conflicts: await conflicts() });
    }
  }

  async #withLock<T>(run: () => Promise<T>): Promise<T> {
    if (navigator.locks) return await navigator.locks.request(`lifediary-sync-${this.cipher.vaultId}`, { signal: this.#abort.signal }, run);
    return await run();
  }

  run() {
    if (this.#abort.signal.aborted) return;
    if (this.#busy) { this.#again = true; return this.#busy; }
    this.#busy = this.#withLock(() => this.#run()).catch(error => {
      if (!this.#abort.signal.aborted) this.report({ phase: "error", message: error instanceof Error ? error.message : "同步失败。", conflicts: [] });
    }).finally(() => {
      this.#busy = null;
      if (this.#again) { this.#again = false; void this.run(); }
    });
    return this.#busy;
  }

  async preview(record: RemoteRecord) {
    const identity = this.#inspect(record);
    const local = await this.#table(identity).get(identity.key);
    return {
      table: identity.table,
      localStamp: local?._vault.stamp ?? null,
      local: local ? JSON.parse(this.cipher.inspect(local._vault).json) as unknown : null,
      remote: JSON.parse(identity.json) as unknown
    };
  }

  async resolve(record: RemoteRecord, choice: "local" | "remote", localStamp: string | null) {
    await this.#withLock(async () => {
      const identity = this.#inspect(record);
      const table = this.#table(identity);
      const meta = this.raw.vaultMeta;
      const slot = baseKey(record.id);
      const current = await table.get(identity.key);
      if ((current?._vault.stamp ?? null) !== localStamp) throw new Error("本机版本已更新，请重新查看冲突。");
      const deletion = identity.json === "null";
      const body = choice === "remote" && !deletion ? await this.#download(record, current?._vault) : null;
      const data = body && this.cipher.unpack(body).data;
      const tombstone = choice === "local" && !current && !deletion ? await this.cipher.pack(identity, null) : null;
      if (data && JSON.stringify(table.core.schema.primaryKey.extractKey?.(data)) !== JSON.stringify(identity.key)) {
        throw new Error("同步记录与其标识不匹配。");
      }
      await this.raw.transaction("rw", table, meta, async () => {
        const base = (await meta.get(slot))?.baseline;
        if (base?.conflict?.revision !== record.revision ||
          (await table.get(identity.key))?._vault.stamp !== current?._vault.stamp) {
          throw new Error("记录刚刚发生变化，请重新查看冲突。");
        }
        if (choice === "remote") {
          if (body && data) await table.put(rowWithIndexes(table.core.schema, data, body));
          else await table.delete(identity.key);
          await meta.delete(deletionKey(record.id));
        } else if (tombstone) {
          await meta.put({ id: deletionKey(record.id), deletion: { identity, record: tombstone } });
        }
        await meta.put({ id: slot, baseline: { table: identity.table, key: identity.key, revision: record.revision, stamp: deletion ? null : record.stamp } });
      });
      if (choice === "remote") {
        window.dispatchEvent(new Event("diary-data-changed"));
        window.dispatchEvent(new Event(remoteCommitEvent));
      }
    });
    this.run();
  }
}
