import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../../App";
import { db } from "../../lib/db";
import { addStock, createStockDraft, publishStockNote, saveStockDraft } from "../../lib/stocks";

vi.mock("../../lib/stock-images", async importOriginal => {
  const actual = await importOriginal<typeof import("../../lib/stock-images")>();
  return { ...actual, storeStockImages: async (files: File[]) => {
    const images = files.map((file, index) => ({ id: `ui-image-${index}`, name: file.name, blob: file, thumbnail: file, createdAt: new Date().toISOString() }));
    await db.stockImages.bulkPut(images); return images;
  } };
});

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  window.scrollTo = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});
beforeEach(async () => {
  await db.delete(); await db.open(); window.history.replaceState(null, "", "/stocks");
  vi.setSystemTime(new Date("2026-10-09T10:30:00"));
});

describe("stock workspace routes and user flows", () => {
  it("adds a stock and preserves an immediately edited draft across route changes", async () => {
    render(<App />);
    const library = within(screen.getByRole("complementary", { name: "股票列表" }));
    fireEvent.click(library.getByRole("button", { name: "添加股票" }));
    fireEvent.change(library.getByLabelText("股票名称"), { target: { value: "测试股票" } });
    fireEvent.change(library.getByLabelText("股票代码（选填）"), { target: { value: "600001" } });
    fireEvent.click(library.getByRole("button", { name: "保存股票" }));
    await screen.findByRole("heading", { name: "测试股票" });
    expect(window.location.pathname).toMatch(/^\/stocks\//);
    fireEvent.click(screen.getByRole("button", { name: "＋ 新增记录" }));
    const editor = within(await screen.findByRole("region", { name: "股票记录编辑器" }));
    fireEvent.change(editor.getByLabelText("当下的理解"), { target: { value: "切换后仍然保留的想法" } });
    fireEvent.click(within(screen.getByRole("navigation", { name: "主导航" })).getByRole("link", { name: "股票备忘录" }));
    await waitFor(() => expect(window.location.pathname).toBe("/stocks"));
    fireEvent.click(await library.findByRole("link", { name: /测试股票/ }));
    fireEvent.click(await screen.findByText("继续草稿 · 1 条"));
    fireEvent.click(await screen.findByRole("button", { name: /切换后仍然保留的想法/ }));
    expect(within(screen.getByRole("region", { name: "股票记录编辑器" })).getByLabelText("当下的理解")).toHaveValue("切换后仍然保留的想法");
    fireEvent.click(screen.getByRole("button", { name: "加入时间轴" }));
    expect(await screen.findByRole("article", { name: "切换后仍然保留的想法" })).toBeInTheDocument();
  });

  it("adds multiple stocks without a code and displays only their market", async () => {
    render(<App />);
    const library = within(screen.getByRole("complementary", { name: "股票列表" }));
    for (const name of ["无代码甲", "无代码乙"]) {
      fireEvent.click(library.getByRole("button", { name: "添加股票" }));
      expect(library.getByLabelText("股票代码（选填）")).not.toBeRequired();
      fireEvent.change(library.getByLabelText("股票名称"), { target: { value: name } });
      fireEvent.click(library.getByRole("button", { name: "保存股票" }));
      await screen.findByRole("heading", { name });
      const link = await library.findByRole("link", { name: new RegExp(name) });
      expect(within(link).getByText("SH")).toBeInTheDocument();
    }
    expect(await db.stocks.count()).toBe(2);
    expect(screen.queryByText(/undefined/)).not.toBeInTheDocument();
  });

  it("uploads multiple images, opens the gallery, edits a note and keeps its old version", async () => {
    const { stock } = await addStock("图片股票", "US", "IMG"); window.history.replaceState(null, "", `/stocks/${stock.id}`);
    render(<App />); fireEvent.click(await screen.findByRole("button", { name: "＋ 新增记录" }));
    let editor = within(await screen.findByRole("region", { name: "股票记录编辑器" }));
    fireEvent.change(editor.getByLabelText("标题"), { target: { value: "有依据的判断" } });
    fireEvent.change(editor.getByLabelText("当下的理解"), { target: { value: "原来的理解" } });
    fireEvent.change(editor.getByLabelText("添加图片"), { target: { files: [new File(["a"], "a.png", { type: "image/png" }), new File(["b"], "b.png", { type: "image/png" })] } });
    await editor.findByLabelText("图片说明：a.png");
    fireEvent.change(editor.getByLabelText("图片说明：a.png"), { target: { value: "原来的说明" } });
    fireEvent.click(editor.getByRole("button", { name: "加入时间轴" }));
    let card = within(await screen.findByRole("article", { name: "有依据的判断" }));
    fireEvent.click(card.getByRole("button", { name: "展开想法与图片" }));
    fireEvent.click(await card.findByRole("button", { name: "查看图片：a.png" }));
    const viewer = within(screen.getByRole("dialog", { name: "图片大图预览" }));
    fireEvent.click(viewer.getByRole("button", { name: "下一张" })); expect(viewer.getByText("2 / 2 · b.png")).toBeInTheDocument();
    fireEvent.click(viewer.getByRole("button", { name: "关闭图片" }));
    fireEvent.click(card.getByRole("button", { name: "编辑记录" }));
    editor = within(await screen.findByRole("region", { name: "股票记录编辑器" }));
    fireEvent.change(editor.getByLabelText("当下的理解"), { target: { value: "后来的理解" } });
    fireEvent.click(editor.getByRole("button", { name: "加入时间轴" }));
    card = within(await screen.findByRole("article", { name: "有依据的判断" }));
    await card.findByText("后来的理解"); fireEvent.click(card.getByRole("button", { name: "历史版本" }));
    const history = within(await card.findByRole("region", { name: "历史版本" }));
    expect(await history.findByText("原来的理解")).toBeInTheDocument();
  });

  it("filters historical views, creates linked reviews, recycles and restores records", async () => {
    const { stock } = await addStock("历史股票", "US", "HIST");
    vi.setSystemTime(new Date("2026-03-12T09:30:00"));
    const note = await createStockDraft(stock.id); await saveStockDraft(note.id, { ...note.draft!, title: "最初的想法", text: "当时理解", isKeyNode: true }); await publishStockNote(note.id);
    vi.setSystemTime(new Date("2026-10-09T10:30:00"));
    const later = await createStockDraft(stock.id); await saveStockDraft(later.id, { ...later.draft!, title: "后补记录", text: "后来补记", occurredAt: new Date("2026-03-10T10:00:00").toISOString() }); await publishStockNote(later.id);
    window.history.replaceState(null, "", `/stocks/${stock.id}`); render(<App />);
    await screen.findByRole("article", { name: "最初的想法" });
    fireEvent.change(screen.getByLabelText("回看截至"), { target: { value: "2026-03-15" } });
    fireEvent.click(screen.getByLabelText("只看当时已保存"));
    await waitFor(() => expect(screen.queryByRole("article", { name: "后补记录" })).not.toBeInTheDocument());
    expect(screen.getByRole("article", { name: "最初的想法" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "清除筛选" }));
    const original = within(await screen.findByRole("article", { name: "最初的想法" }));
    await waitFor(() => expect(original.getByRole("button", { name: "追加复盘" })).toBeEnabled());
    fireEvent.click(original.getByRole("button", { name: "追加复盘" }));
    const editor = within(await screen.findByRole("region", { name: "股票记录编辑器" }));
    fireEvent.change(editor.getByLabelText("当下的理解"), { target: { value: "复盘结论" } }); fireEvent.click(editor.getByRole("button", { name: "加入时间轴" }));
    const review = within(await screen.findByRole("article", { name: "复盘结论" }));
    expect(review.getByRole("button", { name: "↳ 查看复盘的原记录" })).toBeInTheDocument();
    fireEvent.click(original.getByRole("button", { name: "移入回收站" }));
    await waitFor(() => expect(screen.queryByRole("article", { name: "最初的想法" })).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "回收站" }));
    fireEvent.click(await screen.findByRole("button", { name: "恢复记录" }));
    fireEvent.click(screen.getByRole("button", { name: "返回全部记录" }));
    expect(await screen.findByRole("article", { name: "最初的想法" })).toBeInTheDocument();
  });

  it("supports browser navigation and a missing stock deep link", async () => {
    window.history.replaceState(null, "", "/stocks/missing"); render(<App />);
    expect(await screen.findByRole("heading", { name: "这只股票不存在" })).toBeInTheDocument();
    window.history.pushState(null, "", "/"); fireEvent.popState(window);
    expect(screen.getByRole("heading", { name: "日记" })).toBeVisible();
    window.history.pushState(null, "", "/stocks"); fireEvent.popState(window);
    expect(screen.getByRole("heading", { name: "股票备忘录" })).toBeVisible();
  });
});
