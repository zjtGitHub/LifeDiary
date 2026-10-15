import { Download, Upload } from "lucide-react";
import { ChangeEvent } from "react";

interface BackupPanelProps {
  compact?: boolean;
  status: string;
  onExport: () => Promise<void>;
  onImport: (file: File) => Promise<void>;
}

export function BackupPanel({ status, onExport, onImport, compact = false }: BackupPanelProps) {
  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      await onImport(file);
      event.target.value = "";
    }
  };

  return (
    <section className={compact ? "backup-controls" : "panel backup-panel"} aria-label="数据备份">
      {compact ? <p className="backup-status" role="status">{status}</p> : <div className="section-heading compact">
        <div>
          <h2>备份</h2>
          <p>{status}</p>
        </div>
      </div>}

      <div className="backup-actions">
        <button className="secondary icon-text-button" type="button" onClick={onExport}>
          <Download size={17} />
          导出
        </button>
        <label className="secondary icon-text-button import-button">
          <Upload size={17} />
          导入
          <input type="file" accept="application/json,.json" onChange={handleImport} aria-label="导入备份" />
        </label>
      </div>
    </section>
  );
}
