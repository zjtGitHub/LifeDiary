import { HardDrive, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { DataBackup } from "./DataBackup";

export function BackupMenu() {
  const [open, setOpen] = useState(false);
  return <>
    <button className="app-backup-button" type="button" aria-haspopup="dialog" onClick={() => setOpen(true)}><HardDrive size={16} aria-hidden="true" />数据备份</button>
    {open ? <BackupDialog onClose={() => setOpen(false)} /> : null}
  </>;
}

function BackupDialog({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current!;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    element.showModal();
    return () => { element.close(); document.body.style.overflow = previousOverflow; };
  }, []);
  return <dialog ref={dialog} className="backup-settings-dialog" aria-labelledby="backup-settings-title" onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className="backup-settings-heading"><h2 id="backup-settings-title">备份与恢复</h2><button className="icon-button subtle" type="button" aria-label="关闭数据备份" onClick={onClose} autoFocus><X size={19} /></button></div>
    <p className="backup-settings-description">日记、健康记录、图片、计划、清单、月总结、生日和股票备忘录统一备份，方便迁移到其他设备。</p>
    <DataBackup compact />
  </dialog>;
}
