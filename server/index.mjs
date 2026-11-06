import { createReadStream, realpathSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { isIP } from "node:net";
import { pathToFileURL } from "node:url";
import { createAuth } from "./auth.mjs";
import { HttpError, MAX_FILE_BYTES, MAX_RECORD_BYTES, isFileId, openStore } from "./store.mjs";

async function readBody(req, limit) {
  const length = req.headers["content-length"];
  if (length && Number(length) > limit) {
    req.resume();
    throw new HttpError(413, "上传内容太大。");
  }
  let count = 0;
  const chunks = [];
  for await (const chunk of req) {
    count += chunk.length;
    if (count > limit) throw new HttpError(413, "上传内容太大。");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, count);
}

async function readJson(req, limit) {
  if (req.headers["content-type"] !== "application/json") throw new HttpError(415, "无效的请求格式。");
  const bytes = await readBody(req, limit);
  try { return JSON.parse(bytes.toString("utf8")); }
  catch { throw new HttpError(400, "无效的请求内容。"); }
}

function json(res, status, data, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...headers });
  res.end(JSON.stringify(data));
}

export function createVaultServer({ store, origin, clock, trustProxy = false, allowInsecureLocalhost = false }) {
  const parsed = new URL(origin);
  if (origin !== parsed.origin) throw new Error("LIFEDIARY_ORIGIN must be an exact origin including any port");
  const secure = parsed.protocol === "https:";
  if (!secure && !(allowInsecureLocalhost && parsed.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname))) {
    throw new Error("A public LifeDiary vault requires HTTPS");
  }
  const auth = createAuth(store, secure, clock);
  const server = createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    try {
      const url = new URL(req.url, origin);
      const route = url.pathname;
      const method = req.method;
      if (!route.startsWith("/api/vault/") || url.origin !== origin) throw new HttpError(404, "未找到接口。");
      if (req.headers["sec-fetch-site"] === "cross-site" ||
          (method !== "GET" && method !== "HEAD" && req.headers.origin !== origin)) throw new HttpError(403, "请求来源不匹配。");

      if (route === "/api/vault/session" && method === "GET") {
        const authenticated = Boolean(auth.session(req));
        json(res, 200, { authenticated, envelope: authenticated ? store.currentVault() : null });
        return;
      }
      if (route === "/api/vault/login" && method === "POST") {
        const forwarded = req.headers["x-lifediary-client-ip"];
        const ip = trustProxy && typeof forwarded === "string" && isIP(forwarded) ? forwarded : req.socket.remoteAddress ?? "unknown";
        const cookie = await auth.login(req, await readJson(req, 2048), ip);
        json(res, 200, { authenticated: true, envelope: store.currentVault() }, { "Set-Cookie": cookie });
        return;
      }
      if (route === "/api/vault/logout" && method === "POST") {
        res.writeHead(204, { "Set-Cookie": auth.logout(req) }).end();
        return;
      }
      if (!auth.session(req)) throw new HttpError(401, "请重新登录以继续同步。");
      if (route === "/api/vault/setup" && method === "POST") {
        json(res, 201, { envelope: store.initVault(await readJson(req, 4096)) });
        return;
      }
      const envelope = store.currentVault();
      if (!envelope || req.headers["x-lifediary-vault"] !== envelope.id) throw new HttpError(409, "资料库不匹配，请重新解锁。");
      if (route === "/api/vault/changes" && method === "GET") {
        const after = url.searchParams.get("after") ?? "0";
        if (!/^\d+$/.test(after)) throw new HttpError(400, "无效的同步位置。");
        json(res, 200, store.changes(Number(after)));
        return;
      }

      const record = /^\/api\/vault\/records\/([a-f0-9]{64})$/.exec(route);
      if (record && method === "PUT") {
        const result = store.putRecord(record[1], await readJson(req, MAX_RECORD_BYTES + 4096));
        json(res, "conflict" in result ? 409 : 200, result);
        return;
      }
      const prefix = "/api/vault/files/";
      const fileId = route.startsWith(prefix) ? route.slice(prefix.length) : "";
      if (isFileId(fileId) && ["HEAD", "GET", "PUT"].includes(method)) {
        if (method === "PUT") {
          if (req.headers["content-type"] !== "application/octet-stream") throw new HttpError(415, "无效的附件格式。");
          store.putFile(fileId, await readBody(req, MAX_FILE_BYTES));
          res.writeHead(204).end();
        } else {
          if (!store.hasFile(fileId)) throw new HttpError(404, "未找到附件。");
          const path = store.filePath(fileId);
          res.writeHead(200, {
            "Content-Type": "application/octet-stream",
            "Content-Disposition": "attachment",
            "Content-Length": statSync(path).size
          });
          if (method === "HEAD") res.end();
          else createReadStream(path).on("error", () => res.destroy()).pipe(res);
        }
        return;
      }
      throw new HttpError(404, "未找到接口。");
    } catch (error) {
      if (res.headersSent) { res.destroy(); return; }
      if (error instanceof HttpError) json(res, error.status, { error: error.message });
      else {
        console.error("LifeDiary request failed", error?.code ?? error?.name ?? "Error");
        json(res, 500, { error: "同步服务暂时不可用。" });
      }
    }
  });
  server.requestTimeout = 45_000;
  server.headersTimeout = 10_000;
  return server;
}

if (process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url) {
  process.umask(0o077);
  const { LIFEDIARY_DATA_DIR, LIFEDIARY_ORIGIN, LIFEDIARY_PORT = "8787", LIFEDIARY_DEV, LIFEDIARY_TRUST_PROXY } = process.env;
  if (!LIFEDIARY_DATA_DIR || !LIFEDIARY_ORIGIN) throw new Error("Set LIFEDIARY_DATA_DIR and LIFEDIARY_ORIGIN.");
  const store = openStore(LIFEDIARY_DATA_DIR);
  if (!store.db.prepare("SELECT 1 FROM owner").get()) throw new Error("Run the owner setup before starting the service.");
  const server = createVaultServer({ store, origin: LIFEDIARY_ORIGIN, trustProxy: LIFEDIARY_TRUST_PROXY === "1", allowInsecureLocalhost: LIFEDIARY_DEV === "1" });
  server.listen(Number(LIFEDIARY_PORT), "127.0.0.1", () => console.log(`LifeDiary API listening on 127.0.0.1:${server.address().port}`));
}
