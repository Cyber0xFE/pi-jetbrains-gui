import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Picker, type PickerItem } from "./Picker";

function items(count: number): PickerItem[] {
  return Array.from({ length: count }, (_, index) => ({ key: `item-${index}`, label: `entry ${index}` }));
}

function installScrollMetrics(list: { scrollHeight: number; clientHeight: number }): void {
  Object.defineProperty(HTMLDivElement.prototype, "scrollHeight", { configurable: true, get: () => list.scrollHeight });
  Object.defineProperty(HTMLDivElement.prototype, "clientHeight", { configurable: true, get: () => list.clientHeight });
}

describe("Picker row metadata", () => {
  afterEach(() => cleanup());

  it("groups badge and detail into the trailing meta block", () => {
    render(
      <Picker
        title="Sessions"
        items={[{ key: "/a", label: "session a", badge: "current", detail: "12 messages · now" }]}
        onSelect={() => {}}
        onClose={() => {}}
      />,
    );

    const row = screen.getByRole("option");
    const meta = row.querySelector(".picker-meta");
    expect(meta?.querySelector(".picker-badge")?.textContent).toBe("current");
    expect(meta?.querySelector(".picker-detail")?.textContent).toBe("12 messages · now");
  });

  it("does not select the row when rename or delete is used", () => {
    const onSelect = vi.fn();
    const onRename = vi.fn();
    const onDelete = vi.fn();
    render(
      <Picker
        title="Sessions"
        items={[{ key: "/a", label: "session a", onRename, onDelete }]}
        onSelect={onSelect}
        onClose={() => {}}
      />,
    );

    fireEvent.click(screen.getByLabelText("Rename"));
    expect(onRename).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText("Delete session"));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe("Picker scroll position", () => {
  const originalScrollHeight = Object.getOwnPropertyDescriptor(HTMLDivElement.prototype, "scrollHeight");
  const originalClientHeight = Object.getOwnPropertyDescriptor(HTMLDivElement.prototype, "clientHeight");

  afterEach(() => {
    cleanup();
    if (originalScrollHeight) Object.defineProperty(HTMLDivElement.prototype, "scrollHeight", originalScrollHeight);
    if (originalClientHeight) Object.defineProperty(HTMLDivElement.prototype, "clientHeight", originalClientHeight);
  });

  it("opens at the top by default", () => {
    installScrollMetrics({ scrollHeight: 1000, clientHeight: 324 });
    render(<Picker title="Sessions" items={items(30)} onSelect={() => {}} onClose={() => {}} />);

    const list = screen.getByRole("listbox") as HTMLDivElement;
    expect(list.scrollTop).toBe(0);
    expect(screen.getAllByRole("option")[0]?.getAttribute("aria-selected")).toBe("true");
  });

  it("scrolls to the bottom when scrollPosition is bottom", () => {
    installScrollMetrics({ scrollHeight: 1000, clientHeight: 324 });
    render(<Picker title="Session tree" items={items(30)} scrollPosition="bottom" onSelect={() => {}} onClose={() => {}} />);

    const list = screen.getByRole("listbox") as HTMLDivElement;
    expect(list.scrollTop).toBe(676);
    const options = screen.getAllByRole("option");
    expect(options[options.length - 1]?.getAttribute("aria-selected")).toBe("true");
  });

  it("keeps filtering at the top even when scrollPosition is bottom", () => {
    installScrollMetrics({ scrollHeight: 1000, clientHeight: 324 });
    render(<Picker title="Session tree" items={items(30)} scrollPosition="bottom" onSelect={() => {}} onClose={() => {}} />);

    const list = screen.getByRole("listbox") as HTMLDivElement;
    expect(list.scrollTop).toBe(676);

    fireEvent.change(screen.getByPlaceholderText("Filter…"), { target: { value: "entry 12" } });
    expect(list.scrollTop).toBe(0);
    expect(screen.getByRole("option", { name: "entry 12" }).getAttribute("aria-selected")).toBe("true");
  });
});
