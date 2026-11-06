import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BtwState } from "../state/sessionReducer";
import { BtwOverlay } from "./BtwOverlay";

afterEach(cleanup);

type Props = Parameters<typeof BtwOverlay>[0];

function overlay(btw: BtwState | null, overrides: Partial<Props> = {}): JSX.Element {
  return (
    <BtwOverlay
      btw={btw}
      collapsed={false}
      onCollapse={(): void => undefined}
      onExpand={(): void => undefined}
      onClose={(): void => undefined}
      {...overrides}
    />
  );
}

const answered: BtwState = { question: "what config file was that?", answer: "It is **app.json**.", error: null, pending: false };

describe("BtwOverlay", () => {
  it("shows a usage hint when no side question was asked yet", () => {
    render(overlay(null));

    expect(screen.getByRole("dialog", { name: "Side question" })).toBeDefined();
    expect(screen.getByText(/Type/)).toBeDefined();
  });

  it("shows the pending state while the host is answering", () => {
    render(overlay({ question: "what config file was that?", answer: null, error: null, pending: true }));

    expect(screen.getByText("what config file was that?")).toBeDefined();
    expect(screen.getByText("正在思考")).toBeDefined();
  });

  it("renders the answer as markdown once it arrives", () => {
    render(overlay(answered));

    expect(screen.getByText("app.json")).toBeDefined();
    expect(screen.queryByText("正在思考")).toBeNull();
  });

  it("streams the answer as markdown while deltas arrive", () => {
    render(overlay({ question: "what config file was that?", answer: "It is **app**.", error: null, pending: true }));

    expect(screen.getByText("app")).toBeDefined();
    expect(screen.queryByText("正在思考")).toBeNull();
  });

  it("shows the error message", () => {
    render(overlay({ question: "why?", answer: null, error: "pi is not running", pending: false }));

    expect(screen.getByText("pi is not running")).toBeDefined();
  });

  it("closes via the dismiss button and Escape", () => {
    const onCollapse = vi.fn();
    const onExpand = vi.fn();
    const onClose = vi.fn();
    const { baseElement } = render(overlay(answered, { onCollapse, onExpand, onClose }));

    fireEvent.click(screen.getByRole("button", { name: "Dismiss side question" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(baseElement.ownerDocument.body, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onExpand).not.toHaveBeenCalled();
  });

  it("collapses via the chevron and expands via the right-edge tab", () => {
    const onCollapse = vi.fn();
    render(overlay(answered, { onCollapse }));

    fireEvent.click(screen.getByRole("button", { name: "Collapse side question" }));
    expect(onCollapse).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Expand side question" })).toBeNull();
  });

  it("shows the expand tab only when collapsed; Escape expands before closing", () => {
    const onExpand = vi.fn();
    const onClose = vi.fn();
    const { baseElement } = render(overlay(answered, { collapsed: true, onExpand, onClose }));

    const tab = screen.getByRole("button", { name: "Expand side question" });
    expect(tab.textContent).toBe("/btw");
    expect(screen.queryByRole("dialog", { name: "Side question" })).toBeNull();

    fireEvent.click(tab);
    expect(onExpand).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(baseElement.ownerDocument.body, { key: "Escape" });
    expect(onExpand).toHaveBeenCalledTimes(2);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("marks the collapsed tab while the answer is still streaming", () => {
    render(overlay({ question: "why?", answer: "part", error: null, pending: true }, { collapsed: true }));

    expect(screen.getByRole("button", { name: "Expand side question" }).textContent).toBe("/btw ·…");
  });
});
