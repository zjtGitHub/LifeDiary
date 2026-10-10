import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { db, getYearMonthSummaries, saveDayText, saveMonthlyReflection } from "../lib/db";

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});

describe("monthly summary timeline", () => {
  beforeEach(async () => {
    vi.setSystemTime(new Date("2026-05-05T08:00:00"));
    await db.delete();
    await db.open();
  });

  it("opens twelve months, persists edits across years and reopening, and closes with Escape", async () => {
    await saveMonthlyReflection("2025-05", "去年的五月");
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "月总结" }));
    const timeline = await screen.findByRole("list", { name: "2026 年月总结时间轴" });
    expect(within(timeline).getAllByRole("listitem")).toHaveLength(12);
    const may = within(screen.getByRole("article", { name: "2026-05 月总结" }));
    fireEvent.click(may.getByRole("button", { name: "写总结" }));
    fireEvent.change(may.getByRole("textbox"), { target: { value: "五月的收获" } });
    // Immediately changing the year must not discard the last edit.
    fireEvent.click(screen.getByRole("button", { name: "上一年" }));
    expect(await screen.findByText("去年的五月")).toBeInTheDocument();
    await waitFor(async () => expect((await getYearMonthSummaries(2026))[4].reflection).toBe("五月的收获"));
    fireEvent.click(screen.getByRole("button", { name: "回到今年" }));
    expect(await screen.findByText("五月的收获")).toBeInTheDocument();
    fireEvent(screen.getByRole("dialog"), new Event("cancel", { bubbles: false, cancelable: true }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "月总结" }));
    expect(await screen.findByText("五月的收获")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "关闭月总结" }));
    expect(document.body.style.overflow).toBe("");
  });

  it("opens a recorded day from the monthly summary", async () => {
    await saveDayText("2026-01-31", "一月底的日记");
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "月总结" }));
    const january = within(await screen.findByRole("article", { name: "2026-01 月总结" }));
    fireEvent.click(january.getByText("回看本月记录 · 1 天"));
    fireEvent.click(january.getByRole("button", { name: "01/31" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("日记正文")).toHaveValue("一月底的日记"));
  });
});
