import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { addTodo, db, saveBirthDate, saveDayText } from "./lib/db";

describe("App", () => {
  beforeEach(async () => {
    window.history.replaceState(null, "", "/");
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    vi.setSystemTime(new Date("2026-05-05T08:00:00"));
    await db.delete();
    await db.open();
  });

  it("loads saved diary text and switches when a calendar day is clicked", async () => {
    await saveDayText("2026-05-06", "五月六日的日记");

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /2026-05-06/ }));

    await waitFor(() => expect(screen.getByLabelText("日记正文")).toHaveValue("五月六日的日记"));
  });

  it("autosaves diary text", async () => {
    await saveDayText("2026-05-05", "原有内容");
    render(<App />);

    const textarea = await screen.findByDisplayValue("原有内容");
    fireEvent.change(textarea, { target: { value: "自动保存内容" } });

    await waitFor(
      async () => {
        expect((await db.dayEntries.get("2026-05-05"))?.text).toBe("自动保存内容");
      },
      { timeout: 1200 }
    );
  });

  it("adds and removes image previews", async () => {
    render(<App />);

    const input = screen.getByLabelText("添加图片");
    const file = new File(["image"], "photo.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [file] } });

    expect(await screen.findByAltText("photo.png")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "删除图片：photo.png" }));
    await waitFor(() => expect(screen.queryByAltText("photo.png")).not.toBeInTheDocument());
  });

  it("reviews a life week on its own page and opens a chosen day in the diary", async () => {
    await saveBirthDate("2000-01-01");
    await saveDayText("2000-01-15", "这一周开始的日记");

    render(<App />);

    expect(screen.queryByLabelText("人生表格")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: "人生" }));
    expect(screen.getByRole("link", { name: "人生" })).toHaveAttribute("aria-current", "page");
    expect(document.title).toBe("人生 · 时光日记");
    fireEvent.click(await screen.findByLabelText("0 岁第 3 周，2000-01-15 到 2000-01-21"));

    const summary = await screen.findByLabelText("周回顾");
    expect(window.location.pathname).toBe("/life");
    expect(within(summary).getByText("2000-01-15 到 2000-01-21")).toBeInTheDocument();
    expect(within(summary).getByText("1 天日记")).toBeInTheDocument();
    expect(screen.getByLabelText("日记正文")).toHaveValue("");
    fireEvent.click(within(summary).getByRole("button", { name: "打开 2000-01-15 的日记" }));

    expect(window.location.pathname).toBe("/");
    await waitFor(() => expect(screen.getByText("2000年1月")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByLabelText("日记正文")).toHaveValue("这一周开始的日记"));

    fireEvent.click(screen.getByRole("link", { name: "人生" }));
    fireEvent.click(await screen.findByLabelText("0 岁第 3 周，2000-01-15 到 2000-01-21"));
    expect(within(await screen.findByLabelText("周回顾")).getByText("这一周开始的日记")).toBeInTheDocument();
  }, 15000);

  it("opens the life route directly and saves the birthday across page visits and data restores", async () => {
    window.history.replaceState(null, "", "/life");
    render(<App />);

    expect(screen.getByRole("heading", { name: "人生" })).toBeInTheDocument();
    const birthday = await screen.findByLabelText("生日");
    expect(screen.getByText("保存生日后，这里会显示按 100 岁计算的人生周表格。")).toBeInTheDocument();
    fireEvent.change(birthday, { target: { value: "2000-01-01" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await screen.findByLabelText(/已经历 .* 周，共 .* 周/);
    expect((await db.profile.get("me"))?.birthDate).toBe("2000-01-01");

    fireEvent.click(screen.getByRole("link", { name: "日记" }));
    expect(screen.queryByLabelText("人生表格")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: "人生" }));
    expect(await screen.findByLabelText("生日")).toHaveValue("2000-01-01");

    await saveBirthDate("1990-06-01");
    fireEvent(window, new Event("diary-data-restored"));
    await waitFor(() => expect(screen.getByLabelText("生日")).toHaveValue("1990-06-01"));
  }, 15000);

  it("refreshes a life week after shared diary data changes", async () => {
    await saveBirthDate("2000-01-01");
    window.history.replaceState(null, "", "/life");
    render(<App />);
    fireEvent.click(await screen.findByLabelText("0 岁第 3 周，2000-01-15 到 2000-01-21"));
    expect(within(await screen.findByLabelText("周回顾")).getByText("0 天日记")).toBeInTheDocument();

    await saveDayText("2000-01-17", "更新后的周中记录");
    fireEvent(window, new Event("diary-data-changed"));
    const summary = await screen.findByLabelText("周回顾", {}, { timeout: 5000 });
    expect(within(summary).getByText("更新后的周中记录")).toBeInTheDocument();
    expect(within(summary).getByText("1 天日记")).toBeInTheDocument();
  }, 15000);

  it("opens the enlarged calendar from the small calendar and keeps undated lists separate", async () => {
    const todo = await addTodo("2026-05-06", "当天的计划");
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /2026-05-06/ }));
    fireEvent.click(screen.getByRole("link", { name: "放大日历" }));
    expect(await screen.findByRole("heading", { name: "2026年5月" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "完成计划：当天的计划" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: "返回日记" }));
    expect(await screen.findByRole("heading", { name: "2026年5月6日" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("link", { name: "清单" }));
    expect(await screen.findByRole("heading", { name: "清单" })).toBeInTheDocument();
    expect(screen.queryByText("当天的计划")).not.toBeVisible();
    expect(screen.queryByLabelText("计划日期")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("新分组名称"), { target: { value: "旅行准备" } });
    fireEvent.click(screen.getByRole("button", { name: "创建分组" }));
    expect(await screen.findByRole("heading", { name: "旅行准备" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("添加清单任务"), { target: { value: "带充电宝" } });
    fireEvent.click(screen.getByRole("button", { name: "添加" }));
    await screen.findByRole("button", { name: "查看任务：带充电宝" });
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "完成任务：带充电宝" })).toBeEnabled());
    fireEvent.change(screen.getByLabelText("任务备注"), { target: { value: "出发前充满电" } });
    fireEvent.click(screen.getByRole("button", { name: "保存任务" }));
    await screen.findByText("任务已保存");
    fireEvent.click(screen.getByRole("checkbox", { name: "完成任务：带充电宝" }));
    await waitFor(async () => expect((await db.checklistItems.toArray())[0]).toMatchObject({ title: "带充电宝", notes: "出发前充满电", completed: true }));
    expect((await db.todos.get(todo.id))?.completed).toBe(false);
    scrollTo.mockRestore();
  });
});
