import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SearchBar } from "./SearchBar";

afterEach(() => {
  cleanup();
});

const base = {
  query: "build",
  caseSensitive: false,
  wholeWord: false,
  regex: false,
  error: null as string | null,
  count: 5,
  index: 2,
  focusRequest: 0,
  onChange: vi.fn(),
  onToggle: vi.fn(),
  onPrevious: vi.fn(),
  onNext: vi.fn(),
  onClose: vi.fn(),
};

it("shows the 1-based match counter and renders the current query", () => {
  const view = render(<SearchBar {...base} />);
  const input = view.getByRole("textbox", { name: "搜索消息" }) as HTMLInputElement;
  expect(input.value).toBe("build");
  expect(view.getByText("2/5")).toBeDefined();
});

it("shows an error instead of the counter when the query is invalid", () => {
  const view = render(<SearchBar {...base} error="无效的正则表达式" count={0} index={0} />);
  expect(view.getByText("无效的正则表达式")).toBeDefined();
});

it("shows 无结果 when there are no matches", () => {
  const view = render(<SearchBar {...base} count={0} index={0} />);
  expect(view.getByText("无结果")).toBeDefined();
});

it("toggles the three match options", () => {
  const onToggle = vi.fn();
  const view = render(<SearchBar {...base} onToggle={onToggle} />);
  fireEvent.click(view.getByRole("button", { name: "区分大小写" }));
  fireEvent.click(view.getByRole("button", { name: "全字匹配" }));
  fireEvent.click(view.getByRole("button", { name: "正则表达式" }));
  expect(onToggle).toHaveBeenNthCalledWith(1, "caseSensitive");
  expect(onToggle).toHaveBeenNthCalledWith(2, "wholeWord");
  expect(onToggle).toHaveBeenNthCalledWith(3, "regex");
  expect(view.getByRole("button", { name: "区分大小写" }).getAttribute("aria-pressed")).toBe("false");
  view.rerender(<SearchBar {...base} caseSensitive wholeWord regex />);
  expect(view.getByRole("button", { name: "区分大小写" }).getAttribute("aria-pressed")).toBe("true");
  expect(view.getByRole("button", { name: "全字匹配" }).getAttribute("aria-pressed")).toBe("true");
  expect(view.getByRole("button", { name: "正则表达式" }).getAttribute("aria-pressed")).toBe("true");
});

it("reports typed text through onChange", () => {
  const onChange = vi.fn();
  const view = render(<SearchBar {...base} onChange={onChange} />);
  fireEvent.change(view.getByRole("textbox", { name: "搜索消息" }), { target: { value: "pi" } });
  expect(onChange).toHaveBeenCalledWith("pi");
});

it("navigates with Enter / Shift+Enter and closes on Escape", () => {
  const onNext = vi.fn();
  const onPrevious = vi.fn();
  const onClose = vi.fn();
  const view = render(<SearchBar {...base} onNext={onNext} onPrevious={onPrevious} onClose={onClose} />);
  const input = view.getByRole("textbox", { name: "搜索消息" });
  fireEvent.keyDown(input, { key: "Enter" });
  fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
  fireEvent.keyDown(input, { key: "Escape" });
  expect(onNext).toHaveBeenCalledTimes(1);
  expect(onPrevious).toHaveBeenCalledTimes(1);
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("drives prev/next/close from the toolbar buttons", () => {
  const onNext = vi.fn();
  const onPrevious = vi.fn();
  const onClose = vi.fn();
  const view = render(<SearchBar {...base} onNext={onNext} onPrevious={onPrevious} onClose={onClose} />);
  fireEvent.click(view.getByRole("button", { name: "上一个匹配" }));
  fireEvent.click(view.getByRole("button", { name: "下一个匹配" }));
  fireEvent.click(view.getByRole("button", { name: "关闭搜索" }));
  expect(onPrevious).toHaveBeenCalledTimes(1);
  expect(onNext).toHaveBeenCalledTimes(1);
  expect(onClose).toHaveBeenCalledTimes(1);
});
