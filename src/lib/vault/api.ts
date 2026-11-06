import type { Envelope } from "./crypto";

export class SyncHttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export async function vaultFetch(path: string, options: RequestInit = {}, vaultId?: string) {
  const headers = new Headers(options.headers);
  if (vaultId) headers.set("X-LifeDiary-Vault", vaultId);
  return fetch(`/api/vault/${path}`, { ...options, headers, cache: "no-store", credentials: "same-origin", redirect: "error" });
}

export async function vaultError(response: Response) {
  const payload = await response.json().catch(() => null);
  return new SyncHttpError(response.status, payload?.error ?? "无法连接同步服务。");
}

export async function vaultJson<T>(path: string, options: RequestInit = {}, vaultId?: string): Promise<T> {
  const response = await vaultFetch(path, options, vaultId);
  if (!response.ok) throw await vaultError(response);
  return response.json();
}

export const jsonRequest = (method: "PUT" | "POST", value: unknown): RequestInit => ({
  method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(value)
});

export interface SessionInfo { authenticated: boolean; envelope: Envelope | null }
