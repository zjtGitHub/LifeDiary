import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createBackupPayload, db, getDayEntry, saveDayText } from "../lib/db";
import { DataBackup } from "./DataBackup";

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});
beforeEach(async () => { await db.delete(); await db.open(); });
const fileFor = (text: string) => {
  const file = new File([text], "backup.json", { type: "application/json" }); file.text = async () => text; return file;
};

describe("backup restore confirmation", () => {
  it("does not overwrite existing data when the import is cancelled", async () => {
    await saveDayText("2026-10-09", "当前内容"); render(<DataBackup />);
    fireEvent.change(screen.getByLabelText("导入备份"), { target: { files: [fileFor("{}")] } });
    expect(screen.getByRole("dialog", { name: "恢复全部数据" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect((await getDayEntry("2026-10-09")).text).toBe("当前内容");
  });
  it("restores only after explicit confirmation", async () => {
    await saveDayText("2026-10-09", "备份内容"); const payload = await createBackupPayload();
    await saveDayText("2026-10-09", "当前内容"); render(<DataBackup />);
    fireEvent.change(screen.getByLabelText("导入备份"), { target: { files: [fileFor(JSON.stringify(payload))] } });
    expect((await getDayEntry("2026-10-09")).text).toBe("当前内容");
    fireEvent.click(screen.getByRole("button", { name: "确认覆盖并恢复" }));
    await waitFor(() => expect(screen.getByText("全部数据已恢复")).toBeInTheDocument());
    expect((await getDayEntry("2026-10-09")).text).toBe("备份内容");
  });
  it("preserves the original data after an invalid import", async () => {
    await saveDayText("2026-10-09", "保留内容"); render(<DataBackup />);
    fireEvent.change(screen.getByLabelText("导入备份"), { target: { files: [fileFor("invalid json")] } });
    fireEvent.click(screen.getByRole("button", { name: "确认覆盖并恢复" }));
    await screen.findByText(/原数据已保留/);
    expect((await getDayEntry("2026-10-09")).text).toBe("保留内容");
  });
});
