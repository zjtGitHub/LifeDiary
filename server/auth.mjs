import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { HttpError } from "./store.mjs";

const derive = promisify(scrypt);
const hashPassword = async (password, salt) => Buffer.from(await derive(password, salt, 32, {
  N: 2 ** 15, r: 8, p: 3, maxmem: 48 * 1024 ** 2
}));
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const digest = value => createHash("sha256").update(value).digest("hex");

export function base32(bytes) {
  let bits = 0;
  let value = 0;
  let result = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      result += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits) result += alphabet[(value << (5 - bits)) & 31];
  return result;
}

export function totpCode(seed, step) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac("sha1", seed).update(counter).digest();
  const offset = mac[mac.length - 1] & 15;
  return String((mac.readUInt32BE(offset) & 0x7fff_ffff) % 1_000_000).padStart(6, "0");
}

function protectSeed(key, seed) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const bytes = Buffer.concat([cipher.update(seed), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), bytes]).toString("base64url");
}

function readSeed(key, encrypted) {
  const bytes = Buffer.from(encrypted, "base64url");
  const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
  decipher.setAuthTag(bytes.subarray(12, 28));
  return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]);
}

export function renameOwner(store, username) {
  if (typeof username !== "string" || !/^[A-Za-z0-9._-]{3,64}$/.test(username)) {
    throw new Error("账号名需为 3 至 64 位英文字母、数字、点、下划线或短横线。");
  }
  return store.transact(() => {
    const owner = store.db.prepare("SELECT username FROM owner WHERE singleton = 1").get();
    if (!owner) throw new Error("账号尚未初始化。");
    if (owner.username === username) return false;
    store.db.prepare("UPDATE owner SET username = ? WHERE singleton = 1").run(username);
    store.db.prepare("DELETE FROM sessions").run();
    return true;
  });
}

export async function configureOwner(store, username, password, replace = false, seed = randomBytes(20)) {
  if (typeof username !== "string" || !/^[A-Za-z0-9._-]{3,64}$/.test(username) ||
      typeof password !== "string" || password.length < 16 || Buffer.byteLength(password) > 256) {
    throw new Error("Use a 3–64 character account name and a password of at least 16 characters (maximum 256 bytes).");
  }
  const salt = randomBytes(16);
  const hashed = await hashPassword(password, salt);
  store.transact(() => {
    const exists = store.db.prepare("SELECT 1 FROM owner").get();
    if (exists && !replace) throw new Error("The owner already exists. Use the explicit reset command.");
    if (!exists && replace) throw new Error("No owner is configured.");
    store.db.prepare("INSERT OR REPLACE INTO owner VALUES (1, ?, ?, ?, ?, -1)").run(
      username, salt.toString("hex"), hashed.toString("hex"), protectSeed(store.authKey, seed)
    );
    store.db.prepare("DELETE FROM sessions").run();
    store.db.prepare("DELETE FROM login_attempts").run();
  });
  return base32(seed);
}

export function createAuth(store, secure, clock = Date.now) {
  const { db } = store;
  const cookieName = secure ? "__Host-lifediary" : "lifediary-dev";
  const cookie = (value, seconds) =>
    `${cookieName}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${seconds}${secure ? "; Secure" : ""}`;
  const token = req => {
    const match = (req.headers.cookie ?? "").split(";").map(item => item.trim()).find(item => item.startsWith(`${cookieName}=`));
    const value = match?.slice(cookieName.length + 1);
    return value && /^[A-Za-z0-9_-]{43}$/.test(value) ? digest(value) : null;
  };
  const session = req => {
    const id = token(req);
    return id ? db.prepare("SELECT 1 FROM sessions WHERE digest = ? AND expires > ?").get(id, clock()) : undefined;
  };
  const logout = req => {
    const id = token(req);
    if (id) db.prepare("DELETE FROM sessions WHERE digest = ?").run(id);
    return cookie("", 0);
  };

  // Reserve attempts before the expensive password check. Limits survive restarts.
  const reserve = (ip, now) => store.transact(() => {
    const span = 15 * 60_000;
    db.prepare("DELETE FROM login_attempts WHERE since <= ?").run(now - span);
    const scopes = [[`ip:${ip}`, 8], ["all", 40]];
    const find = db.prepare("SELECT count FROM login_attempts WHERE scope = ?");
    if (scopes.some(([scope, limit]) => (find.get(scope)?.count ?? 0) >= limit)) throw new HttpError(429, "尝试次数过多，请稍后再试。");
    const add = db.prepare("INSERT INTO login_attempts VALUES (?, ?, 1) ON CONFLICT(scope) DO UPDATE SET count = count + 1");
    for (const [scope] of scopes) add.run(scope, now);
  });

  let checks = 0;
  const login = async (req, input, ip) => {
    if (checks >= 2) throw new HttpError(429, "登录繁忙，请稍后再试。");
    const { username, password, otp } = input ?? {};
    if (typeof username !== "string" || username.length > 64 || typeof password !== "string" ||
        Buffer.byteLength(password) > 256 || typeof otp !== "string" || !/^\d{6}$/.test(otp)) {
      throw new HttpError(400, "请填写账号、密码和六位动态码。");
    }
    const now = clock();
    reserve(ip, now);
    const owner = db.prepare("SELECT * FROM owner WHERE singleton = 1").get();
    if (!owner) throw new HttpError(503, "账号尚未在服务器终端初始化。");
    let hashed;
    checks++;
    try { hashed = await hashPassword(password, Buffer.from(owner.salt, "hex")); }
    finally { checks--; }
    const step = Math.floor(clock() / 30_000);
    const seed = readSeed(store.authKey, owner.totp);
    const counter = [step, step - 1, step + 1].find(item => item >= 0 &&
      timingSafeEqual(Buffer.from(totpCode(seed, item)), Buffer.from(otp)));
    if (username !== owner.username || !timingSafeEqual(hashed, Buffer.from(owner.password_hash, "hex")) || counter === undefined) {
      throw new HttpError(401, "账号、密码或动态码不正确。");
    }
    const raw = randomBytes(32).toString("base64url");
    const duration = 8 * 3600;
    store.transact(() => {
      const used = db.prepare("UPDATE owner SET last_counter = ? WHERE singleton = 1 AND last_counter < ? AND password_hash = ? AND totp = ?")
        .run(counter, counter, owner.password_hash, owner.totp);
      if (!used.changes) throw new HttpError(401, "动态码已使用，请等下一组验证码。");
      db.prepare("DELETE FROM sessions WHERE expires <= ? OR digest = ?").run(now, token(req) ?? "");
      db.prepare("INSERT INTO sessions VALUES (?, ?)").run(digest(raw), now + duration * 1000);
      db.prepare("DELETE FROM login_attempts WHERE scope = ?").run(`ip:${ip}`);
      db.prepare("UPDATE login_attempts SET count = max(0, count - 1) WHERE scope = 'all'").run();
    });
    return cookie(raw, duration);
  };
  return { session, login, logout };
}
