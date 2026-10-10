import { useEffect, useRef, useState } from "react";
import { BackupPanel } from "./BackupPanel";
import { createBackupPayload, restoreBackupPayload } from "../lib/db";
import { isoDate } from "../lib/date";

export function DataBackup({ onRestored }: { onRestored?: () => void | Promise<void> }) {
  const [status, setStatus] = useState("备份全部日记与股票记录");
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [restoring, setRestoring] = useState(false);
  const exportBackup = async () => {
    setStatus("正在导出…");
    try {
      const payload = await createBackupPayload();
      const url = URL.createObjectURL(new Blob([JSON.stringify(payload)], { type: "application/json" }));
      const link = document.createElement("a"); link.href = url; link.download = `riji-backup-${isoDate(new Date())}.json`;
      document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 0);
      setStatus("全部数据已导出");
    } catch { setStatus("导出失败，请重试"); }
  };
  const importBackup = async (file: File) => {
    if (document.querySelector(".stock-editor")) { setStatus("请先关闭正在编辑的股票记录，再导入备份。"); return; }
    setPendingFile(file);
  };
  const restore = async () => {
    if (!pendingFile) return;
    setRestoring(true);
    setStatus("正在校验并导入…");
    window.dispatchEvent(new Event("diary-data-restoring"));
    try {
      await restoreBackupPayload(JSON.parse(await pendingFile.text()));
      setPendingFile(null);
      window.dispatchEvent(new Event("diary-data-restored"));
      await onRestored?.(); setStatus("全部数据已恢复");
    } catch (error) {
      window.dispatchEvent(new Event("diary-data-restore-failed"));
      setPendingFile(null); setStatus(error instanceof Error ? `导入失败：${error.message}；原数据已保留` : "导入失败，原数据已保留");
    } finally { setRestoring(false); }
  };
  return <><BackupPanel status={status} onExport={exportBackup} onImport={importBackup} />
    {pendingFile ? <ImportConfirmation fileName={pendingFile.name} busy={restoring} onCancel={() => setPendingFile(null)} onConfirm={() => void restore()} /> : null}
  </>;
}

function ImportConfirmation({ fileName, busy, onCancel, onConfirm }: { fileName: string; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const node = dialog.current!; node.showModal(); return () => node.close(); }, []);
  return <dialog className="backup-confirm-dialog" ref={dialog} aria-labelledby="backup-confirm-title" onCancel={event => { event.preventDefault(); if (!busy) onCancel(); }}>
    <h2 id="backup-confirm-title">恢复全部数据</h2><p>备份文件：{fileName}</p>
    <p>导入会覆盖当前浏览器里的日记、图片、计划、月总结、生日与股票备忘录，包括草稿、历史版本和回收站。</p>
    <p>旧备份没有的模块会被清空。建议先导出当前数据。</p>
    <div className="stock-actions"><button className="icon-text-button" type="button" disabled={busy} onClick={onCancel} autoFocus>取消</button><button className="primary icon-text-button" type="button" disabled={busy} onClick={onConfirm}>{busy ? "正在恢复…" : "确认覆盖并恢复"}</button></div>
  </dialog>;
}
