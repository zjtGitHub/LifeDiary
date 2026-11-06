import { createHash, randomBytes } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export const MAX_RECORD_BYTES = 1_400_000;
export const MAX_FILE_BYTES = 15 * 1024 * 1024 + 40;
export const isFileId = value => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
export const isUuid = value => typeof value === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value);
const encoded = (value, min, max) => typeof value === "string" && value.length >= min && value.length <= max && /^[A-Za-z0-9_-]+$/.test(value);

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function openStore(directory, { initialize = false, quota = 5 * 1024 ** 3 } = {}) {
  const root = resolve(directory);
  const database = join(root, "lifediary.sqlite");
  const keyPath = join(root, "auth.key");
  const files = join(root, "files");
  if (initialize && !existsSync(database)) {
    mkdirSync(root, { recursive: true, mode: 0o700 });
    if (!existsSync(keyPath)) writeFileSync(keyPath, randomBytes(32), { flag: "wx", mode: 0o600 });
  }
  if (!existsSync(keyPath) || (!initialize && !existsSync(database))) {
    throw new Error("Run the owner setup before starting the service.");
  }
  const authKey = readFileSync(keyPath);
  if (authKey.length !== 32 || (statSync(keyPath).mode & 0o077)) throw new Error("Invalid permissions or length for auth.key");
  mkdirSync(files, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(database);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS owner (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      username TEXT NOT NULL,
      salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      totp TEXT NOT NULL,
      last_counter INTEGER NOT NULL DEFAULT -1
    ) STRICT;
    CREATE TABLE IF NOT EXISTS sessions (
      digest TEXT PRIMARY KEY,
      expires INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS login_attempts (
      scope TEXT PRIMARY KEY,
      since INTEGER NOT NULL,
      count INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS vault (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      envelope TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS attachments (
      id TEXT PRIMARY KEY,
      bytes INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS revisions (
      revision INTEGER PRIMARY KEY AUTOINCREMENT,
      record_id TEXT NOT NULL,
      stamp TEXT NOT NULL,
      cipher TEXT NOT NULL,
      files TEXT NOT NULL,
      UNIQUE (record_id, stamp)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS revisions_record ON revisions (record_id, revision DESC);
  `);
  const transact = action => {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = action();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  };

  const currentVault = () => {
    const row = db.prepare("SELECT envelope FROM vault WHERE singleton = 1").get();
    return row ? JSON.parse(row.envelope) : null;
  };

  const initVault = envelope => {
    if (envelope?.version !== 1 || !isUuid(envelope.id) ||
        !encoded(envelope.salt, 22, 22) || !encoded(envelope.passphrase, 96, 96) ||
        !encoded(envelope.recovery, 96, 96)) throw new HttpError(400, "无效的资料库密钥封套。");
    const fields = { version: 1, id: envelope.id, salt: envelope.salt, passphrase: envelope.passphrase, recovery: envelope.recovery };
    const result = db.prepare("INSERT OR IGNORE INTO vault VALUES (1, ?)").run(JSON.stringify(fields));
    if (!result.changes) throw new HttpError(409, "资料库已经初始化。");
    return fields;
  };

  const filePath = id => join(files, id);
  const hasFile = id => Boolean(db.prepare("SELECT 1 FROM attachments WHERE id = ?").get(id)) && existsSync(filePath(id));
  const putFile = (id, bytes) => {
    if (bytes.length < 40 || bytes.length > MAX_FILE_BYTES ||
        createHash("sha256").update(bytes).digest("hex") !== id) throw new HttpError(400, "附件校验失败。");
    transact(() => {
      if (hasFile(id)) return;
      const existing = db.prepare("SELECT bytes FROM attachments WHERE id = ?").get(id);
      const used = db.prepare("SELECT coalesce(sum(bytes), 0) AS bytes FROM attachments").get().bytes;
      if (used - (existing?.bytes ?? 0) + bytes.length > quota) throw new HttpError(507, "服务器附件空间不足。");
      const temporary = join(files, `.pending-${randomBytes(16).toString("hex")}`);
      try {
        writeFileSync(temporary, bytes, { flag: "wx", mode: 0o600, flush: true });
        renameSync(temporary, filePath(id));
        const directoryFd = openSync(files, "r");
        try { fsyncSync(directoryFd); } finally { closeSync(directoryFd); }
        db.prepare("INSERT OR IGNORE INTO attachments VALUES (?, ?)").run(id, bytes.length);
      } finally {
        rmSync(temporary, { force: true });
      }
    });
  };

  const serialize = row => ({
    id: row.record_id,
    revision: row.revision,
    stamp: row.stamp,
    cipher: row.cipher,
    files: JSON.parse(row.files)
  });
  const latest = id => db.prepare("SELECT * FROM revisions WHERE record_id = ? ORDER BY revision DESC LIMIT 1").get(id);
  const putRecord = (id, input) => {
    if (!isFileId(id) || !isUuid(input?.stamp) || !Number.isSafeInteger(input.base) || input.base < 0 ||
        !encoded(input.cipher, 54, MAX_RECORD_BYTES) || !Array.isArray(input.files) ||
        input.files.length > 40 || !input.files.every(isFileId) || new Set(input.files).size !== input.files.length) {
      throw new HttpError(400, "无效的同步记录。");
    }
    return transact(() => {
      const filesJson = JSON.stringify(input.files);
      const existing = db.prepare("SELECT * FROM revisions WHERE record_id = ? AND stamp = ?").get(id, input.stamp);
      if (existing) {
        if (existing.cipher !== input.cipher || existing.files !== filesJson) throw new HttpError(409, "同步版本标识已使用。");
        return { revision: existing.revision };
      }
      const prior = latest(id);
      if ((prior?.revision ?? 0) !== input.base) return { conflict: prior ? serialize(prior) : null };
      if (!input.files.every(hasFile)) throw new HttpError(422, "附件尚未上传完整。");
      const result = db.prepare("INSERT INTO revisions (record_id, stamp, cipher, files) VALUES (?, ?, ?, ?)").run(id, input.stamp, input.cipher, filesJson);
      return { revision: Number(result.lastInsertRowid) };
    });
  };

  const changes = after => {
    if (!Number.isSafeInteger(after) || after < 0) throw new HttpError(400, "无效的同步位置。");
    const head = db.prepare("SELECT coalesce(max(revision), 0) AS revision FROM revisions").get().revision;
    if (after > head) throw new HttpError(409, "服务器历史已回退，请核对备份后恢复同步。");
    const rows = db.prepare(`
      SELECT r.* FROM revisions r
      WHERE r.revision > ? AND NOT EXISTS (
        SELECT 1 FROM revisions newer WHERE newer.record_id = r.record_id AND newer.revision > r.revision
      )
      ORDER BY r.revision LIMIT 16
    `).all(after);
    return { head, records: rows.map(serialize) };
  };
  return { db, database, authKey, keyPath, files, transact, currentVault, initVault, filePath, hasFile, putFile, putRecord, changes };
}
