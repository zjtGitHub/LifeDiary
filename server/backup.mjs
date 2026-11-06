import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { isFileId, openStore } from "./store.mjs";

process.umask(0o077);
const source = process.env.LIFEDIARY_DATA_DIR;
const target = process.argv[2];
if (!source || !target) throw new Error("Set LIFEDIARY_DATA_DIR and provide a new backup directory.");
const directory = resolve(target);
mkdirSync(directory, { mode: 0o700 });
const live = openStore(source);
const database = join(directory, "lifediary.sqlite");
try { await backup(live.db, database); }
finally { live.db.close(); }
const snapshot = new DatabaseSync(database);
try {
  snapshot.exec("DELETE FROM sessions; DELETE FROM login_attempts; PRAGMA journal_mode = DELETE;");
  const files = join(directory, "files");
  mkdirSync(files, { mode: 0o700 });
  const ids = snapshot.prepare("SELECT DISTINCT value AS id FROM revisions, json_each(revisions.files)").all();
  for (const { id } of ids) {
    if (!isFileId(id)) throw new Error("Invalid attachment ID in the backup.");
    const destination = join(files, id);
    copyFileSync(join(live.files, id), destination);
    if (createHash("sha256").update(readFileSync(destination)).digest("hex") !== id) throw new Error("Backup attachment verification failed.");
  }
  snapshot.exec("DELETE FROM attachments WHERE id NOT IN (SELECT value FROM revisions, json_each(revisions.files));");
  if (snapshot.prepare("PRAGMA integrity_check").get().integrity_check !== "ok") throw new Error("Backup database verification failed.");
  console.log(`Verified SQLite snapshot and ${ids.length} encrypted attachments in ${directory}. Store auth.key separately.`);
} finally { snapshot.close(); }
