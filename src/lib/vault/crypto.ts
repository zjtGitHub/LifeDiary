import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const marker = "__lifediaryAttachment";
const utf8 = new TextEncoder();
const text = new TextDecoder("utf-8", { fatal: true });
const bytes = (value: string) => utf8.encode(value);
const random = (size: number) => crypto.getRandomValues(new Uint8Array(size));
export function readBlob(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === "function") return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

export interface Envelope {
  version: 1;
  id: string;
  salt: string;
  passphrase: string;
  recovery: string;
}
export type RecordKey = string | string[];
export interface Identity { table: string; key: RecordKey }
export interface WireRecord {
  id: string;
  stamp: string;
  cipher: string;
  files: string[];
}
export interface RemoteRecord extends WireRecord { revision: number }
export interface SealedFile { id: string; bytes: Uint8Array }
export interface StoredPayload extends WireRecord { attachments: SealedFile[] }
export interface SealedRow extends Record<string, unknown> { _vault: StoredPayload }
export interface OpenedPayload extends Identity { data: Record<string, unknown> | null }

export function base64(value: Uint8Array) {
  let binary = "";
  for (let offset = 0; offset < value.length; offset += 8192) {
    binary += String.fromCharCode(...value.subarray(offset, offset + 8192));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function unbase64(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("密文编码无效。");
  return Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), character => character.charCodeAt(0));
}

function seal(key: Uint8Array, plaintext: Uint8Array, aad: string) {
  const nonce = random(24);
  const cipher = xchacha20poly1305(key, nonce, bytes(aad)).encrypt(plaintext);
  const result = new Uint8Array(nonce.length + cipher.length);
  result.set(nonce);
  result.set(cipher, nonce.length);
  return result;
}

function open(key: Uint8Array, cipher: Uint8Array, aad: string) {
  if (cipher.length < 40) throw new Error("密文不完整。");
  return xchacha20poly1305(key, cipher.subarray(0, 24), bytes(aad)).decrypt(cipher.subarray(24));
}

async function derivePassphrase(passphrase: string, salt: Uint8Array) {
  const key = await crypto.subtle.importKey("raw", bytes(passphrase), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: Uint8Array.from(salt), iterations: 600_000, hash: "SHA-256" }, key, 256);
  return new Uint8Array(bits);
}

export async function createEnvelope(passphrase: string) {
  if (passphrase.length < 20 || passphrase.length > 256) throw new Error("解锁口令请使用 20 至 256 个字符。");
  const id = crypto.randomUUID();
  const salt = random(16);
  const recovery = random(32);
  const vault = random(32);
  const passKey = await derivePassphrase(passphrase, salt);
  try {
    const envelope: Envelope = {
      version: 1, id, salt: base64(salt),
      passphrase: base64(seal(passKey, vault, `lifediary.wrap.passphrase.v1:${id}`)),
      recovery: base64(seal(recovery, vault, `lifediary.wrap.recovery.v1:${id}`))
    };
    return { envelope, recoveryKey: base64(recovery) };
  } finally { vault.fill(0); recovery.fill(0); passKey.fill(0); }
}

export async function unlockEnvelope(envelope: Envelope, input: string, method: "passphrase" | "recovery") {
  if (envelope.version !== 1 || input.length > 256) throw new Error("资料库格式或口令无效。");
  let wrappingKey: Uint8Array | undefined;
  let raw: Uint8Array | undefined;
  try {
    wrappingKey = method === "passphrase"
      ? await derivePassphrase(input, unbase64(envelope.salt))
      : unbase64(input.trim());
    raw = open(wrappingKey, unbase64(envelope[method]), `lifediary.wrap.${method}.v1:${envelope.id}`);
    return new VaultCipher(envelope.id, raw);
  } catch { throw new Error("无法解锁，请检查口令或恢复密钥。"); }
  finally { wrappingKey?.fill(0); raw?.fill(0); }
}

export class VaultCipher {
  readonly #indexKey: Uint8Array;
  readonly #recordKey: Uint8Array;
  readonly #fileKey: Uint8Array;
  #fileCache = new WeakMap<Blob, SealedFile>();

  constructor(readonly vaultId: string, root: Uint8Array) {
    this.#indexKey = hmac(sha256, root, bytes("lifediary.index.v1"));
    this.#recordKey = hmac(sha256, root, bytes("lifediary.record.v1"));
    this.#fileKey = hmac(sha256, root, bytes("lifediary.file.v1"));
  }

  destroy() {
    this.#indexKey.fill(0);
    this.#recordKey.fill(0);
    this.#fileKey.fill(0);
    this.#fileCache = new WeakMap();
  }

  id({ table, key }: Identity) {
    return bytesToHex(hmac(sha256, this.#indexKey, bytes(JSON.stringify([table, key]))));
  }

  async #sealFile(blob: Blob) {
    const cached = this.#fileCache.get(blob);
    if (cached) return cached;
    if (!blob.size || blob.size > MAX_IMAGE_BYTES) throw new Error("每张图片或缩略图最多 15 MB，且不能为空。");
    const plaintext = new Uint8Array(await readBlob(blob));
    try {
      const cipher = seal(this.#fileKey, plaintext, "lifediary.attachment.v1");
      const file = { id: bytesToHex(sha256(cipher)), bytes: cipher };
      this.#fileCache.set(blob, file);
      return file;
    } finally { plaintext.fill(0); }
  }

  async pack(identity: Identity, data: Record<string, unknown> | null): Promise<StoredPayload> {
    const blobs: Blob[] = [];
    const json = JSON.stringify(data, (_key, value) => {
      if (value instanceof Blob) {
        const index = blobs.length;
        blobs.push(value);
        return { [marker]: index };
      }
      if (value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, marker)) throw new Error("记录包含保留字段。");
      return value;
    });
    if (blobs.length > 40) throw new Error("单条记录的附件数量过多。");
    const attachments: SealedFile[] = [];
    for (const blob of blobs) attachments.push(await this.#sealFile(blob));
    const id = this.id(identity);
    const stamp = crypto.randomUUID();
    const files = [...new Set(attachments.map(file => file.id))];
    const payload = bytes(JSON.stringify({ ...identity, json, refs: attachments.map((file, index) => [file.id, blobs[index].type]) }));
    if (payload.length > 1_000_000) throw new Error("单条记录太大，请分成多条保存。");
    const cipher = base64(seal(this.#recordKey, payload, `lifediary.row.v1:${id}:${stamp}`));
    return { id, stamp, cipher, files, attachments: files.map(fileId => attachments.find(file => file.id === fileId)!) };
  }

  inspect(record: WireRecord) {
    const sealed = open(this.#recordKey, unbase64(record.cipher), `lifediary.row.v1:${record.id}:${record.stamp}`);
    const { table, key, json, refs } = JSON.parse(text.decode(sealed)) as {
      table: string; key: RecordKey; json: string; refs: [string, string][];
    };
    if (this.id({ table, key }) !== record.id || JSON.stringify([...new Set(refs.map(([id]) => id))]) !== JSON.stringify(record.files)) {
      throw new Error("记录完整性检查失败。");
    }
    return { table, key, json, refs };
  }

  unpack(record: StoredPayload): OpenedPayload {
    const { table, key, json, refs } = this.inspect(record);
    const data = JSON.parse(json, (_key, value) => {
      if (!value || typeof value !== "object" || !Object.prototype.hasOwnProperty.call(value, marker)) return value;
      const [id, type] = refs[value[marker]];
      const file = record.attachments.find(item => item.id === id);
      if (!file || bytesToHex(sha256(file.bytes)) !== id) throw new Error("附件完整性检查失败。");
      const raw = open(this.#fileKey, file.bytes, "lifediary.attachment.v1");
      const blob = new Blob([Uint8Array.from(raw)], { type });
      raw.fill(0);
      this.#fileCache.set(blob, file);
      return blob;
    }) as Record<string, unknown> | null;
    return { table, key, data };
  }

  acceptsFile(id: string, file: Uint8Array) {
    return bytesToHex(sha256(file)) === id;
  }
}
