import { Cloud, LockKeyhole, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { db, diaryTables } from "../lib/db";
import { jsonRequest, vaultError, vaultFetch, vaultJson, type SessionInfo } from "../lib/vault/api";
import { createEnvelope, unlockEnvelope, type Envelope, type RemoteRecord, type VaultCipher } from "../lib/vault/crypto";
import { allowPrivateBackupImport, localCommitEvent, setVaultCipher } from "../lib/vault/storage";
import { openRawVault, VaultSync, type SyncState } from "../lib/vault/sync";

const lockedAfter = 15 * 60_000;
const initialSync: SyncState = { phase: "syncing", message: "正在检查同步状态…", conflicts: [] };
const fields = (event: FormEvent<HTMLFormElement>) => {
  event.preventDefault();
  return new FormData(event.currentTarget);
};
const read = (data: FormData, key: string) => String(data.get(key) ?? "");
const errorText = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback;

function VaultScreen({ title, description, children, error }: { title: string; description: string; children?: ReactNode; error: string }) {
  return <main className="vault-screen">
    <section className="panel vault-card">
      <p className="eyebrow"><ShieldCheck size={16} /> 时光日记</p>
      <h1>{title}</h1><p>{description}</p>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {children}
    </section>
  </main>;
}

export function VaultGate({ children }: { children: ReactNode }) {
  const [raw] = useState(openRawVault);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [cached, setCached] = useState<Envelope | null>(null);
  const [offlineUnlock, setOfflineUnlock] = useState(false);
  const [cipher, setCipher] = useState<VaultCipher | null>(null);
  const [prepared, setPrepared] = useState<Awaited<ReturnType<typeof createEnvelope>> | null>(null);
  const [method, setMethod] = useState<"passphrase" | "recovery">("passphrase");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sync, setSync] = useState(initialSync);
  const engine = useRef<VaultSync | null>(null);
  const releaseEditor = useRef<(() => void) | null>(null);
  const lockInProgress = useRef(false);

  useEffect(() => {
    let alive = true;
    const boot = async () => {
      const saved = (await raw.vaultMeta.get("envelope"))?.envelope ?? null;
      if (alive) setCached(saved);
      const info = await vaultJson<SessionInfo>("session");
      if (alive) setSession(info);
    };
    void boot().catch(() => {
      if (alive) {
        setSession({ authenticated: false, envelope: null });
        setError("同步服务暂不可用。此浏览器若已有加密副本，可离线解锁。");
      }
    });
    return () => { alive = false; };
  }, [raw]);

  useEffect(() => {
    if (!cipher) return;
    const worker = new VaultSync(raw, cipher, setSync, () =>
      Boolean(document.activeElement?.matches(".vault-app textarea, .vault-app select, .vault-app input"))
    );
    engine.current = worker;
    let changeTimer = 0;
    let blurTimer = 0;
    const run = () => worker.run();
    const pending = () => {
      setSync(state => ({ ...state, message: "已保存到本机，待同步" }));
      window.clearTimeout(changeTimer);
      changeTimer = window.setTimeout(run, 650);
    };
    const afterEditing = (event: FocusEvent) => {
      if (event.target instanceof Element && event.target.matches(".vault-app textarea, .vault-app select, .vault-app input")) {
        window.clearTimeout(blurTimer);
        blurTimer = window.setTimeout(run, 0);
      }
    };
    window.addEventListener(localCommitEvent, pending);
    document.addEventListener("focusout", afterEditing);
    window.addEventListener("online", run);
    window.addEventListener("focus", run);
    const timer = window.setInterval(run, 15_000);
    run();
    return () => {
      window.clearTimeout(changeTimer);
      window.clearTimeout(blurTimer);
      window.clearInterval(timer);
      document.removeEventListener("focusout", afterEditing);
      window.removeEventListener(localCommitEvent, pending);
      window.removeEventListener("online", run);
      window.removeEventListener("focus", run);
      if (engine.current === worker) engine.current = null;
      void worker.stop();
    };
  }, [cipher, raw]);

  const useEditorLock = async (id: string) => {
    if (!navigator.locks) throw new Error("当前浏览器缺少资料库锁支持，请使用新版浏览器。");
    await new Promise<void>((resolve, reject) => {
      void navigator.locks.request(`lifediary-editor-${id}`, { ifAvailable: true }, lock => {
        if (!lock) { reject(new Error("此浏览器已有一个已解锁的 LifeDiary 标签页，请先锁定它。")); return; }
        return new Promise<void>(release => { releaseEditor.current = release; resolve(); });
      }).catch(reject);
    });
  };

  const open = async (envelope: Envelope, secret: string, unlockMethod: "passphrase" | "recovery") => {
    const prior = (await raw.vaultMeta.get("envelope"))?.envelope;
    if (prior && prior.id !== envelope.id) throw new Error("服务器资料库与此浏览器不匹配。请先核对服务器备份。");
    const opened = await unlockEnvelope(envelope, secret, unlockMethod);
    try {
      await useEditorLock(envelope.id);
      await raw.vaultMeta.put({ id: "envelope", envelope });
      setCached(envelope);
      setVaultCipher(opened);
      setSync(initialSync);
      setCipher(opened);
    } catch (cause) {
      opened.destroy();
      releaseEditor.current?.();
      releaseEditor.current = null;
      throw cause;
    }
  };

  const lock = async (logout = false) => {
    if (!cipher || lockInProgress.current) return;
    lockInProgress.current = true;
    setBusy(true);
    setError("");
    allowPrivateBackupImport(false);
    try {
      await engine.current?.stop();
      // Finish queued IndexedDB writes before dropping the key.
      const tables = diaryTables(db);
      await db.transaction("rw", tables, () => tables[0].count());
    } finally {
      setVaultCipher(null);
      cipher.destroy();
      setCipher(null);
      setOfflineUnlock(false);
      setPrepared(null);
      setMethod("passphrase");
      releaseEditor.current?.();
      releaseEditor.current = null;
      if (logout) {
        try {
          const result = await vaultFetch("logout", { method: "POST" });
          if (!result.ok) throw await vaultError(result);
        } catch { setError("已锁定本机，服务器会话暂时无法退出。"); }
        setSession({ authenticated: false, envelope: null });
      }
      setBusy(false);
      lockInProgress.current = false;
    }
  };

  useEffect(() => {
    if (!cipher) return;
    let lastActivity = Date.now();
    const activity = () => { lastActivity = Date.now(); };
    const check = () => {
      if (Date.now() - lastActivity >= lockedAfter) void lock().catch(() => setError("本机保存失败，请检查最新记录。"));
    };
    window.addEventListener("pointerdown", activity);
    window.addEventListener("keydown", activity);
    window.addEventListener("focus", check);
    const timer = window.setInterval(check, 15_000);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("pointerdown", activity);
      window.removeEventListener("keydown", activity);
      window.removeEventListener("focus", check);
    };
  }, [cipher]);

  const submit = async (action: () => Promise<void>) => {
    setBusy(true); setError("");
    try { await action(); }
    catch (cause) { setError(errorText(cause, "操作失败，请重试。")); }
    finally { setBusy(false); }
  };

  if (!session) return <VaultScreen title="正在连接" description="正在检查私有资料库…" error={error} />;
  if (!window.isSecureContext) return <VaultScreen title="需要 HTTPS" description="请通过受信任的 HTTPS 地址打开私有资料库。" error={error} />;
  if (cipher) return <>
    <aside className="vault-status" aria-label="加密同步">
      <span role="status"><Cloud size={16} />{sync.message}</span>
      <button type="button" disabled={busy} onClick={() => void submit(() => lock())}><LockKeyhole size={14} />锁定</button>
      <button type="button" disabled={busy} onClick={() => void submit(() => lock(true))}>{sync.phase === "login" ? "重新登录" : "退出账号"}</button>
      {error ? <span role="alert">{error}</span> : null}
    </aside>
    {sync.conflicts.length && engine.current ? <ConflictPanel records={sync.conflicts} engine={engine.current} /> : null}
    <fieldset className="vault-app" disabled={busy}>{children}</fieldset>
  </>;

  const envelope = offlineUnlock ? cached : session.authenticated ? session.envelope : null;
  if (envelope) return <VaultScreen title="解锁日记" description="登录验证与内容解锁分开。解锁信息只在此浏览器使用。" error={error}>
    <form onSubmit={event => {
      const form = event.currentTarget;
      const data = fields(event);
      form.reset();
      void submit(() => open(envelope, read(data, "secret"), method));
    }}>
      <label>{method === "passphrase" ? "日记解锁口令" : "日记恢复密钥"}
        <input type="password" autoComplete="off" name="secret" required maxLength={256} />
      </label>
      <button className="primary" disabled={busy}>解锁</button>
      <button type="button" className="secondary" disabled={busy} onClick={() => setMethod(method === "passphrase" ? "recovery" : "passphrase")}>
        {method === "passphrase" ? "使用恢复密钥" : "使用解锁口令"}
      </button>
      {offlineUnlock ? <button type="button" onClick={() => setOfflineUnlock(false)}>返回登录</button> :
        <button type="button" disabled={busy} onClick={() => void submit(async () => {
          const response = await vaultFetch("logout", { method: "POST" });
          if (!response.ok) throw await vaultError(response);
          setSession({ authenticated: false, envelope: null });
        })}>退出账号</button>}
    </form>
  </VaultScreen>;

  if (session.authenticated && cached) return <VaultScreen title="请核对服务器资料库"
    description="服务器没有此浏览器对应的资料库。可先离线打开本机副本，确认服务器备份后再同步。" error={error}>
    <button type="button" className="secondary" onClick={() => setOfflineUnlock(true)}>离线解锁本机副本</button>
  </VaultScreen>;

  if (session.authenticated) return <VaultScreen title="创建加密资料库" description="请设置一个独立、足够长的解锁口令，并离线保管恢复密钥。两者都丢失后，服务器无法恢复日记。" error={error}>
    {prepared ? <form onSubmit={event => {
      const form = event.currentTarget;
      const data = fields(event);
      const confirmation = read(data, "recovery").trim();
      form.reset();
      void submit(async () => {
        if (confirmation !== prepared.recoveryKey) throw new Error("恢复密钥不匹配。");
        const result = await vaultJson<{ envelope: Envelope }>("setup", jsonRequest("POST", prepared.envelope));
        setSession({ authenticated: true, envelope: result.envelope });
        setPrepared(null);
        await open(result.envelope, confirmation, "recovery");
      });
    }}>
      <label>保存这份恢复密钥<input readOnly value={prepared.recoveryKey} onFocus={event => event.currentTarget.select()} /></label>
      <label>粘贴恢复密钥以确认已保存<input type="password" autoComplete="off" name="recovery" required /></label>
      <button className="primary" disabled={busy}>确认并启用</button>
      <button type="button" disabled={busy} onClick={() => setPrepared(null)}>返回设置口令</button>
    </form> : <form onSubmit={event => {
      const form = event.currentTarget;
      const data = fields(event);
      form.reset();
      void submit(async () => {
        const passphrase = read(data, "passphrase");
        if (passphrase !== read(data, "confirmation")) throw new Error("两次输入的口令不一致。");
        setPrepared(await createEnvelope(passphrase));
      });
    }}>
      <label>日记解锁口令<input type="password" name="passphrase" autoComplete="new-password" minLength={20} maxLength={256} required /></label>
      <label>确认解锁口令<input type="password" name="confirmation" autoComplete="new-password" minLength={20} maxLength={256} required /></label>
      <button className="primary" disabled={busy}>生成恢复密钥</button>
    </form>}
  </VaultScreen>;

  return <VaultScreen title="登录时光日记" description="仅限已在服务器登记的账号。请使用账号密码和验证器的六位动态码。" error={error}>
    <form onSubmit={event => {
      const form = event.currentTarget;
      const data = fields(event);
      form.reset();
      void submit(async () => {
        const info = await vaultJson<SessionInfo>("login", jsonRequest("POST", {
          username: read(data, "username"), password: read(data, "password"), otp: read(data, "otp")
        }));
        setOfflineUnlock(false);
        setSession(info);
      });
    }}>
      <label>账号<input name="username" autoComplete="username" maxLength={64} required /></label>
      <label>账号密码<input type="password" name="password" autoComplete="current-password" maxLength={256} required /></label>
      <label>验证器动态码<input name="otp" autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required /></label>
      <button className="primary" disabled={busy}>登录</button>
      {cached ? <button className="secondary" type="button" disabled={busy} onClick={() => { setError(""); setOfflineUnlock(true); }}>离线解锁本机副本</button> : null}
    </form>
  </VaultScreen>;
}

const tableLabels: Record<string, string> = {
  dayEntries: "日记与健康", todos: "日程", checklistGroups: "清单分组",
  checklistItems: "清单", checklistOccurrences: "重复计划", profile: "个人资料",
  monthlyReflections: "月总结", stocks: "股票", stockNotes: "股票笔记",
  stockRevisions: "股票历史", stockImages: "图片", portfolioSnapshots: "投资组合"
};
const display = (value: unknown) => value === null ? "此版本删除了记录" :
  JSON.stringify(value, (_key, item) => item && typeof item === "object" && "__lifediaryAttachment" in item ? "（加密附件）" : item, 2);

function ConflictPanel({ records, engine }: { records: RemoteRecord[]; engine: VaultSync }) {
  const [preview, setPreview] = useState<(Awaited<ReturnType<VaultSync["preview"]>> & { record: RemoteRecord }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const review = async (record: RemoteRecord) => {
    setError("");
    try { setPreview({ ...await engine.preview(record), record }); }
    catch (cause) { setError(errorText(cause, "无法读取冲突记录。")); }
  };
  const choose = async (choice: "local" | "remote") => {
    if (!preview) return;
    setBusy(true); setError("");
    try {
      await engine.resolve(preview.record, choice, preview.localStamp);
      setPreview(null);
    } catch (cause) { setError(errorText(cause, "处理冲突失败。")); }
    finally { setBusy(false); }
  };
  return <section className="panel vault-conflicts" aria-label="同步冲突">
    <h2>{records.length} 条同步冲突</h2>
    <p>本机和另一台设备修改了同一条记录，两个版本均保留，其他记录继续同步。</p>
    <div className="vault-conflict-actions">{records.map((record, index) =>
      <button type="button" className="secondary" key={record.id} disabled={busy} onClick={() => void review(record)}>查看冲突 {index + 1}</button>)}</div>
    {preview ? <>
      <h3>{tableLabels[preview.table] ?? "记录"}</h3>
      <div className="vault-conflict-versions"><div><strong>本机版本</strong><pre>{display(preview.local)}</pre></div>
        <div><strong>服务器版本</strong><pre>{display(preview.remote)}</pre></div></div>
      <div className="vault-conflict-actions">
        <button type="button" className="secondary" disabled={busy} onClick={() => void choose("local")}>保留本机版本</button>
        <button type="button" className="secondary" disabled={busy} onClick={() => void choose("remote")}>采用服务器版本</button>
        <button type="button" disabled={busy} onClick={() => setPreview(null)}>稍后处理</button>
      </div>
    </> : null}
    {error ? <p role="alert" className="form-error">{error}</p> : null}
  </section>;
}
