import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { createChecklistItem, updateChecklistItem } from "../lib/checklists";
import { db, listTodosByDate } from "../lib/db";

beforeEach(async () => {
  window.history.replaceState(null, "", "/list");
  vi.setSystemTime(new Date("2026-10-14T08:00:00"));
  await db.delete(); await db.open();
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
});

describe("checklist scheduling flow", () => {
  it("saves a weekly time range and completes only one occurrence in the calendar", async () => {
    const item = await createChecklistItem("", "上肢训练");
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "查看任务：上肢训练" }));
    fireEvent.click(screen.getByRole("button", { name: "设置日期和重复" }));
    const dialog = within(screen.getByRole("dialog", { name: "安排时间" }));
    fireEvent.input(dialog.getByLabelText("计划日期"), { target: { value: "2026-10-12" } });
    fireEvent.change(dialog.getByLabelText("重复规则"), { target: { value: "weekly" } });
    fireEvent.click(dialog.getByRole("button", { name: "每周三" }));
    fireEvent.click(dialog.getByRole("button", { name: "每周五" }));
    fireEvent.click(dialog.getByLabelText("全天"));
    fireEvent.input(dialog.getByLabelText("开始时间"), { target: { value: "18:30" } });
    fireEvent.click(dialog.getByLabelText("设置时间段"));
    fireEvent.input(dialog.getByLabelText("结束时间"), { target: { value: "19:30" } });
    fireEvent.click(dialog.getByLabelText("设置重复结束日期"));
    fireEvent.input(dialog.getByLabelText("重复结束日期"), { target: { value: "2026-10-23" } });
    fireEvent.click(dialog.getByRole("button", { name: "确定" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await act(async () => { expect((await db.checklistItems.get(item.id))?.schedule).toEqual({ date: "2026-10-12", repeat: "weekly", weekdays: [1, 3, 5], time: "18:30", endTime: "19:30", until: "2026-10-23" }); });
    expect(screen.getByLabelText("任务名称")).toHaveValue("上肢训练");
    fireEvent.click(within(screen.getByRole("navigation", { name: "主导航" })).getByRole("link", { name: "日历" }));
    const day = within(await screen.findByRole("gridcell", { name: "2026年10月14日，1项计划" }));
    expect(day.getByText(/18:30/)).toBeInTheDocument();
    fireEvent.click(day.getByRole("button", { name: "完成计划：上肢训练" }));
    await day.findByRole("button", { name: "标记未完成：上肢训练" });
    await act(async () => { expect((await listTodosByDate("2026-10-16"))[0].completed).toBe(false); });
    fireEvent.click(within(screen.getByRole("navigation", { name: "主导航" })).getByRole("link", { name: "日记" }));
    const dailyPlans = within(screen.getByRole("region", { name: "当天计划" }));
    expect(dailyPlans.getByRole("checkbox")).toBeChecked();
    expect(dailyPlans.getByText("18:30–19:30 · 上肢训练")).toBeInTheDocument();
  });

  it("cancels drafts, prevents invalid ranges, and clears an existing schedule without deleting the task", async () => {
    const item = await createChecklistItem("", "信用卡还款");
    await updateChecklistItem(item.id, { schedule: { date: "2026-10-20", repeat: "monthly" } });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "查看任务：信用卡还款" }));
    fireEvent.click(screen.getByRole("button", { name: "设置日期和重复" }));
    fireEvent.click(screen.getByLabelText("全天"));
    fireEvent.input(screen.getByLabelText("开始时间"), { target: { value: "18:30" } });
    fireEvent.click(screen.getByLabelText("设置时间段"));
    expect(screen.getByRole("button", { name: "确定" })).toBeDisabled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await act(async () => { expect((await db.checklistItems.get(item.id))?.schedule?.time).toBeUndefined(); });
    fireEvent.click(screen.getByRole("button", { name: "设置日期和重复" }));
    expect(screen.getByLabelText("全天")).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "清除" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await act(async () => {
      expect((await db.checklistItems.get(item.id))?.schedule).toBeNull();
      expect(await listTodosByDate("2026-10-20")).toEqual([]);
    });
    expect(screen.getByRole("button", { name: "查看任务：信用卡还款" })).toBeInTheDocument();
  });
});
