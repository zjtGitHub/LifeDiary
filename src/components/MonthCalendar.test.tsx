import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MonthCalendar } from "./MonthCalendar";
import { addTodo, db, saveDayText } from "../lib/db";
import { parseISODate } from "../lib/date";
import type { ISODate } from "../types";

function CalendarHarness({ initialDate = "2026-05-05" }: { initialDate?: ISODate }) {
  const [date, setDate] = useState<ISODate>(initialDate);
  const [month, setMonth] = useState(parseISODate(initialDate));
  return <MonthCalendar month={month} selectedDate={date} onMonthChange={setMonth} onSelectDate={setDate} />;
}

function changeView(value: "day" | "week" | "month") {
  fireEvent.change(screen.getByRole("combobox", { name: "日历维度" }), { target: { value } });
}

describe("calendar views", () => {
  beforeEach(async () => {
    vi.setSystemTime(new Date("2026-05-05T08:00:00"));
    await db.delete();
    await db.open();
  });

  it("switches between month, week and day with the selected date and full daily contents", async () => {
    for (let index = 1; index <= 6; index++) await addTodo("2026-05-05", `计划${index}`);
    await addTodo("2026-05-06", "周三计划");
    await addTodo("2026-05-20", "其他周计划");
    await saveDayText("2026-05-05", "当天日记\n完整正文");
    render(<CalendarHarness />);
    expect(within(screen.getByRole("grid")).getAllByRole("gridcell")).toHaveLength(42);
    await screen.findByRole("button", { name: "还有 3 项" });
    expect(screen.getAllByRole("button", { name: /^完成计划：计划/ })).toHaveLength(3);

    changeView("week");
    expect(screen.getAllByRole("gridcell")).toHaveLength(7);
    expect(screen.getByRole("heading")).toHaveTextContent("2026年5月3日 — 2026年5月9日");
    expect(await screen.findByRole("button", { name: "完成计划：计划6" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "完成计划：周三计划" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "完成计划：其他周计划" })).not.toBeInTheDocument();

    changeView("day");
    expect(screen.getAllByRole("gridcell")).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "2026年5月5日" })).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: /当天日记\s+完整正文/ })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("button", { name: "完成计划：周三计划" })).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "完成计划：计划6" }));
    expect(await screen.findByRole("button", { name: "标记未完成：计划6" })).toBeInTheDocument();
  });

  it("navigates by the active dimension across year boundaries and adds to the displayed day", async () => {
    render(<CalendarHarness initialDate="2026-12-31" />);
    changeView("day");
    fireEvent.click(screen.getByRole("button", { name: "下一日" }));
    expect(screen.getByRole("heading", { name: "2027年1月1日" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "新增计划" }));
    fireEvent.change(screen.getByLabelText("为 2027年1月1日 添加计划"), { target: { value: "新年计划" } });
    fireEvent.click(screen.getByRole("button", { name: "添加" }));
    await screen.findByRole("button", { name: "完成计划：新年计划" });
    expect((await db.todos.toArray())[0]).toMatchObject({ date: "2027-01-01", title: "新年计划" });
    changeView("week");
    fireEvent.click(screen.getByRole("button", { name: "上一周" }));
    expect(screen.getByRole("heading")).toHaveTextContent("2026年12月20日 — 2026年12月26日");
    changeView("month");
    fireEvent.click(screen.getByRole("button", { name: "下一月" }));
    expect(screen.getByRole("heading", { name: "2027年1月" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "今天" }));
    expect(screen.getByRole("heading", { name: "2026年5月" })).toBeInTheDocument();
    changeView("day");
    expect(screen.getByRole("heading", { name: "2026年5月5日" })).toBeInTheDocument();
  });

  it("expands overflowing month plans into the day view", async () => {
    for (let index = 1; index <= 5; index++) await addTodo("2026-05-06", `任务${index}`);
    render(<CalendarHarness />);
    fireEvent.click(await screen.findByRole("button", { name: "还有 1 项" }));
    expect(screen.getByRole("combobox", { name: "日历维度" })).toHaveValue("day");
    expect(screen.getByRole("heading", { name: "2026年5月6日" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "完成计划：任务5" })).toBeInTheDocument();
  });
});
