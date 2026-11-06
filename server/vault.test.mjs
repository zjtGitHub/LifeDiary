import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { test } from "node:test";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { configureOwner, createAuth, totpCode } from "./auth.mjs";
import { createVaultServer } from "./index.mjs";
import { openStore } from "./store.mjs";

test("private API rejects anonymous, cross-origin and replayed logins and persists opaque versions", async () => {
  process.umask(0o077);
  const directory = mkdtempSync(join(tmpdir(), "lifediary-api-test-"));
  const store = openStore(directory, { initialize: true });
  const origin = "https://129.211.50.155:8080";
  const seed = Buffer.from("12345678901234567890");
  const password = "test password only abcdef";
  const now = Date.UTC(2026, 10, 4, 12, 0);
  const server = createVaultServer({ store, origin, clock: () => now });
  let endpoint;
  let cookie = "";
  let vaultId;
  const call = (route, options = {}, requestOrigin = origin) => fetch(`${endpoint}/api/vault/${route}`, {
    ...options,
    headers: { Origin: requestOrigin, Cookie: cookie, ...(vaultId ? { "X-LifeDiary-Vault": vaultId } : {}), ...options.headers }
  });
  const json = (method, body) => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const login = { username: "owner", password, otp: totpCode(seed, Math.floor(now / 30_000)) };
  try {
    await configureOwner(store, "owner", password, false, seed);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    endpoint = `http://127.0.0.1:${server.address().port}`;
    assert.equal((await call("changes")).status, 401);
    assert.equal((await call("login", json("POST", login), "https://other.example")).status, 403);
    assert.equal((await call("login", json("POST", { ...login, password: "bad password" }))).status, 401);
    const response = await call("login", json("POST", login));
    assert.equal(response.status, 200);
    const header = response.headers.get("set-cookie");
    assert.match(header, /^__Host-lifediary=.*HttpOnly; SameSite=Strict; Max-Age=28800; Secure$/);
    assert.equal(response.headers.get("cache-control"), "no-store");
    cookie = header.split(";")[0];
    assert.equal((await call("login", json("POST", login))).status, 401);
    vaultId = randomUUID();
    const envelope = { version: 1, id: vaultId, salt: randomBytes(16).toString("base64url"),
      passphrase: randomBytes(72).toString("base64url"), recovery: randomBytes(72).toString("base64url") };
    assert.equal((await call("setup", json("POST", envelope))).status, 201);
    assert.equal((await call("setup", json("POST", envelope))).status, 409);

    const cipher = randomBytes(90).toString("base64url");
    const bytes = randomBytes(400);
    const file = createHash("sha256").update(bytes).digest("hex");
    const id = randomBytes(32).toString("hex");
    const row = { base: 0, stamp: randomUUID(), cipher, files: [file] };
    assert.equal((await call(`records/${id}`, json("PUT", row))).status, 422);
    const filePut = body => ({ method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body });
    assert.equal((await call(`files/${file}`, filePut(randomBytes(400)))).status, 400);
    assert.equal((await call(`files/${file}`, filePut(bytes))).status, 204);
    assert.deepEqual(readFileSync(join(directory, "files", file)), bytes);
    const inserted = await (await call(`records/${id}`, json("PUT", row))).json();
    assert.equal(inserted.revision, 1);
    assert.deepEqual(await (await call(`records/${id}`, json("PUT", row))).json(), inserted);
    const conflict = await call(`records/${id}`, json("PUT", { ...row, stamp: randomUUID() }));
    assert.equal(conflict.status, 409);
    assert.equal((await conflict.json()).conflict.stamp, row.stamp);
    const pull = await (await call("changes?after=0")).json();
    assert.equal(pull.records[0].cipher, cipher);
    assert.deepEqual(Buffer.from(await (await call(`files/${file}`)).arrayBuffer()), bytes);
    assert.equal((await call("logout", { method: "POST" })).status, 204);
    assert.equal((await call(`files/${file}`)).status, 401);

    const snapshot = join(directory, "test-backup");
    execFileSync(process.execPath, [fileURLToPath(new URL("./backup.mjs", import.meta.url)), snapshot], {
      env: { ...process.env, LIFEDIARY_DATA_DIR: directory }, stdio: "pipe"
    });
    copyFileSync(store.keyPath, join(snapshot, "auth.key"));
    const restored = openStore(snapshot);
    try {
      assert.equal(restored.currentVault().id, vaultId);
      assert.equal(restored.changes(0).records[0].cipher, cipher);
      assert.deepEqual(readFileSync(restored.filePath(file)), bytes);
      assert.equal(restored.db.prepare("SELECT count(*) AS count FROM sessions").get().count, 0);
    } finally { restored.db.close(); }
  } finally {
    if (server.listening) await new Promise(resolve => server.close(resolve));
    store.db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the production entry point starts when invoked through a release symlink", async () => {
  process.umask(0o077);
  const directory = mkdtempSync(join(tmpdir(), "lifediary-entry-test-"));
  const store = openStore(directory, { initialize: true });
  const entry = join(directory, "entry.mjs");
  symlinkSync(fileURLToPath(new URL("./index.mjs", import.meta.url)), entry);
  let child;
  try {
    await configureOwner(store, "owner", "test-only-owner-password");
    store.db.close();
    child = spawn(process.execPath, [entry], {
      env: { ...process.env, LIFEDIARY_DATA_DIR: directory, LIFEDIARY_ORIGIN: "https://129.211.50.155:8080", LIFEDIARY_PORT: "0" },
      stdio: ["ignore", "pipe", "pipe"]
    });
    const port = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("The symlinked API did not start.")), 5000);
      child.once("error", error => { clearTimeout(timer); reject(error); });
      child.once("exit", code => { clearTimeout(timer); reject(new Error(`API exited before listening: ${code}`)); });
      child.stdout.on("data", chunk => {
        const match = /listening on 127\.0\.0\.1:(\d+)/.exec(chunk.toString());
        if (match) { clearTimeout(timer); resolve(Number(match[1])); }
      });
    });
    const response = await fetch(`http://127.0.0.1:${port}/api/vault/session`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { authenticated: false, envelope: null });
  } finally {
    if (child && child.exitCode === null) { child.kill(); await once(child, "exit"); }
    try { store.db.close(); } catch {}
    rmSync(directory, { recursive: true, force: true });
  }
});

test("renaming via the admin CLI keeps authentication secrets and vault data and revokes sessions", async () => {
  process.umask(0o077);
  const directory = mkdtempSync(join(tmpdir(), "lifediary-rename-test-"));
  const store = openStore(directory, { initialize: true });
  const seed = Buffer.from("12345678901234567890");
  const password = "test-only-owner-password";
  let now = Date.UTC(2026, 10, 6);
  const auth = createAuth(store, true, () => now);
  try {
    await configureOwner(store, "owner", password, false, seed);
    const cookie = await auth.login({ headers: {} }, {
      username: "owner", password, otp: totpCode(seed, Math.floor(now / 30_000))
    }, "test");
    const envelope = {
      version: 1, id: randomUUID(), salt: randomBytes(16).toString("base64url"),
      passphrase: randomBytes(72).toString("base64url"), recovery: randomBytes(72).toString("base64url")
    };
    store.initVault(envelope);
    const recordId = randomBytes(32).toString("hex");
    store.putRecord(recordId, { base: 0, stamp: randomUUID(), cipher: randomBytes(90).toString("base64url"), files: [] });
    const recordsBefore = store.changes(0);
    const before = store.db.prepare("SELECT * FROM owner").get();
    const oldSession = { headers: { cookie: cookie.split(";")[0] } };
    assert.ok(auth.session(oldSession));
    execFileSync(process.execPath, [fileURLToPath(new URL("./owner.mjs", import.meta.url)), "rename", "my-account"], {
      env: { ...process.env, LIFEDIARY_DATA_DIR: directory }, stdio: "pipe"
    });
    const after = store.db.prepare("SELECT * FROM owner").get();
    assert.deepEqual({ ...after, username: before.username }, { ...before });
    assert.equal(after.username, "my-account");
    assert.deepEqual(store.currentVault(), envelope);
    assert.deepEqual(store.changes(0), recordsBefore);
    assert.equal(auth.session(oldSession), undefined);
    now += 30_000;
    const input = { username: "my-account", password, otp: totpCode(seed, Math.floor(now / 30_000)) };
    const freshCookie = await auth.login({ headers: {} }, input, "test");
    assert.ok(auth.session({ headers: { cookie: freshCookie.split(";")[0] } }));
    await assert.rejects(auth.login({ headers: {} }, { ...input, username: "owner" }, "test"));
    assert.throws(() => execFileSync(process.execPath, [
      fileURLToPath(new URL("./owner.mjs", import.meta.url)), "rename", "a"
    ], { env: { ...process.env, LIFEDIARY_DATA_DIR: directory }, stdio: "pipe" }));
    assert.equal(store.db.prepare("SELECT username FROM owner").get().username, "my-account");
  } finally {
    store.db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
