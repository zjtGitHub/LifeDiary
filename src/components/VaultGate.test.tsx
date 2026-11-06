import { webcrypto } from "node:crypto";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DiaryDatabase } from "../lib/db";
import { createEnvelope } from "../lib/vault/crypto";
import { setVaultCipher, vaultDatabaseName } from "../lib/vault/storage";
import { VaultGate } from "./VaultGate";

afterEach(async () => {
  setVaultCipher(null);
  await new DiaryDatabase(vaultDatabaseName).delete();
  Reflect.deleteProperty(navigator, "locks");
  vi.unstubAllGlobals();
});

it("requires both server login and local unlock before mounting the diary, then locks it again", async () => {
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("isSecureContext", true);
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: { request: (_name: string, _options: unknown, action: (lock: object) => unknown) => Promise.resolve(action({})) }
  });
  const passphrase = "browser test long vault phrase";
  const { envelope } = await createEnvelope(passphrase);
  const requests = vi.fn(async (path: string, options?: RequestInit) => {
    if (path.endsWith("/session")) return Response.json({ authenticated: false, envelope: null });
    if (path.endsWith("/login")) {
      expect(JSON.parse(options?.body as string)).toEqual({ username: "owner", password: "long-test-password", otp: "123456" });
      return Response.json({ authenticated: true, envelope });
    }
    if (path.includes("/changes")) return Response.json({ head: 0, records: [] });
    throw new Error("Unexpected request");
  });
  vi.stubGlobal("fetch", requests);
  const view = render(<VaultGate><p>Private diary contents</p></VaultGate>);
  await screen.findByRole("heading", { name: "登录时光日记" });
  expect(screen.queryByText("Private diary contents")).toBeNull();
  fireEvent.change(screen.getByLabelText("账号"), { target: { value: "owner" } });
  fireEvent.change(screen.getByLabelText("账号密码"), { target: { value: "long-test-password" } });
  fireEvent.change(screen.getByLabelText("验证器动态码"), { target: { value: "123456" } });
  fireEvent.click(screen.getByRole("button", { name: "登录" }));
  await screen.findByRole("heading", { name: "解锁日记" });
  expect(screen.queryByText("Private diary contents")).toBeNull();
  fireEvent.change(screen.getByLabelText("日记解锁口令"), { target: { value: passphrase } });
  fireEvent.click(screen.getByRole("button", { name: "解锁" }));
  await screen.findByText("Private diary contents");
  await screen.findByText("已同步到服务器");
  expect(JSON.stringify(requests.mock.calls)).not.toContain(passphrase);
  fireEvent.click(screen.getByRole("button", { name: "锁定" }));
  await waitFor(() => expect(screen.queryByText("Private diary contents")).toBeNull());
  view.unmount();
});
