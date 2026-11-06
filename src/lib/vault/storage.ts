import Dexie, { type DBCore, type DBCoreCursor, type DBCoreTableSchema } from "dexie";
import type { Envelope, Identity, RemoteRecord, SealedRow, StoredPayload, VaultCipher } from "./crypto";

export const privateMode = import.meta.env.VITE_PRIVATE_SYNC === "1";
export const vaultDatabaseName = "riji-private-v1";
export const vaultMetaName = "vaultMeta";
export const deletionKey = (id: string) => `delete:${id}`;
export const localCommitEvent = "diary-vault-local-commit";

export interface Baseline extends Identity {
  revision: number;
  stamp: string | null;
  conflict?: RemoteRecord;
}
export interface VaultMeta {
  id: string;
  envelope?: Envelope;
  cursor?: number;
  baseline?: Baseline;
  deletion?: { identity: Identity; record: StoredPayload };
}

let active: VaultCipher | null = null;
export let canImportPrivateBackup = false;
export function allowPrivateBackupImport(allowed: boolean) { canImportPrivateBackup = allowed; }
export function setVaultCipher(cipher: VaultCipher | null) { active = cipher; }
export function currentCipher() {
  if (!active) throw new Error("日记资料库已锁定。");
  return active;
}

export function rowWithIndexes(schema: DBCoreTableSchema, data: Record<string, unknown>, payload: StoredPayload): SealedRow {
  const row: SealedRow = { _vault: payload };
  for (const index of [schema.primaryKey, ...schema.indexes]) {
    for (const path of Array.isArray(index.keyPath) ? index.keyPath : index.keyPath ? [index.keyPath] : []) {
      if (data[path] !== undefined) row[path] = data[path];
    }
  }
  return row;
}

function decryptRow(row: SealedRow | undefined, table: string, schema: DBCoreTableSchema) {
  if (!row) return undefined;
  const decoded = currentCipher().unpack(row._vault);
  if (!decoded.data || decoded.table !== table ||
      JSON.stringify(decoded.key) !== JSON.stringify(schema.primaryKey.extractKey?.(row)) ||
      JSON.stringify(decoded.key) !== JSON.stringify(schema.primaryKey.extractKey?.(decoded.data))) {
    throw new Error("本机资料库记录校验失败。");
  }
  return decoded.data;
}

function withDecodedCursor(cursor: DBCoreCursor, decode: (value: SealedRow) => unknown): DBCoreCursor {
  return new Proxy(cursor, {
    get(target, property) {
      if (property === "value") return target.value === undefined ? undefined : decode(target.value);
      if (property === "next") return () => target.next().then(next => next ? withDecodedCursor(next, decode) : next);
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
}

export function encryptedStorage() {
  const watched = new WeakSet<IDBTransaction>();
  return {
    stack: "dbcore" as const,
    name: "lifediary-encrypted-rows",
    level: 0,
    create(core: DBCore): DBCore {
      const metadata = core.table(vaultMetaName);
      return {
        ...core,
        transaction(stores, mode, options) {
          const withMetadata = mode === "readwrite" && !stores.includes(vaultMetaName) ? [...stores, vaultMetaName] : stores;
          return core.transaction(withMetadata, mode, options);
        },
        table(name) {
          const table = core.table(name);
          if (name === vaultMetaName) return table;
          const decode = (value: SealedRow | undefined) => decryptRow(value, name, table.schema);
          return {
            ...table,
            get: req => table.get(req).then(decode),
            getMany: req => table.getMany(req).then(rows => rows.map(decode)),
            query: req => table.query(req).then(response => req.values ? { result: response.result.map(decode) } : response),
            openCursor: req => table.openCursor(req).then(cursor => cursor && req.values ? withDecodedCursor(cursor, decode) : cursor),
            async mutate(req) {
              const cipher = currentCipher();
              const trans = req.trans as IDBTransaction;
              if (!watched.has(trans)) {
                watched.add(trans);
                trans.addEventListener("complete", () => window.dispatchEvent(new Event(localCommitEvent)), { once: true });
              }
              if (req.type === "put" || req.type === "add") {
                if (!req.values.length) return table.mutate(req);
                const values = await Dexie.waitFor(Promise.all(req.values.map(async value => {
                  const key = table.schema.primaryKey.extractKey?.(value);
                  const payload = await cipher.pack({ table: name, key }, value);
                  if (currentCipher() !== cipher) throw new Error("日记资料库已锁定。");
                  return rowWithIndexes(table.schema, value, payload);
                })));
                const result = await table.mutate({ ...req, values });
                const keys = values.flatMap((value, index) => result.failures[index] ? [] : [deletionKey(value._vault.id)]);
                if (keys.length) {
                  const cleared = await metadata.mutate({ type: "delete", keys, trans });
                  if (cleared.numFailures) {
                    trans.abort();
                    throw new Error("无法保存记录的同步状态。");
                  }
                }
                return result;
              }
              const keys = req.type === "delete" ? req.keys : (await table.query({
                trans, values: false, query: { index: table.schema.primaryKey, range: req.range }
              })).result;
              const previous: (SealedRow | undefined)[] = keys.length ? await table.getMany({ trans, keys }) : [];
              const result = await table.mutate(req);
              if (req.type === "deleteRange" && result.numFailures) return result;
              const removed = previous.flatMap((row, index) => {
                if (!row || result.failures[index]) return [];
                return [{ table: name, key: keys[index] } as Identity];
              });
              if (!removed.length) return result;
              const deletions = await Dexie.waitFor(Promise.all(removed.map(identity =>
                cipher.pack(identity, null).then(record => ({ id: deletionKey(record.id), deletion: { identity, record } }))
              )));
              if (deletions.length) {
                const written = await metadata.mutate({ type: "put", values: deletions, trans });
                if (written.numFailures) {
                  trans.abort();
                  throw new Error("无法保存删除记录的同步状态。");
                }
              }
              return result;
            }
          };
        }
      };
    }
  };
}
