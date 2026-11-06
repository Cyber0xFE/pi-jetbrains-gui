import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BtwState } from "../state/sessionReducer";
import { BtwOverlay } from "./BtwOverlay";

afterEach(cleanup);

function overlay(btw: BtwState | null, onClose = (): void => undefined): JSX.Element {
  return <BtwOverlay btw={btw} onClose={onClose} />;
}

describe("BtwOverlay", () => {
  it("shows a usage hint when no side question was asked yet", () => {
    render(overlay(null));

    expect(screen.getByRole("dialog", { name: "Side question" })).toBeDefined();
    expect(screen.getByText(/Type/)).toBeDefined();
  });

  it("shows the pending state while the host is answering", () => {
    render(overlay({ question: "what config file was that?", answer: null, error: null, pending: true }));

    expect(screen.getByText("what config file was that?")).toBeDefined();
    expect(screen.getByText("thinking…")).toBeDefined();
  });

  it("renders the answer as markdown once it arrives", () => {
    render(overlay({ question: "what config file was that?", answer: "It is **app.json**.", error: null, pending: false }));

    expect(screen.getByText("app.json")).toBeDefined();
    expect(screen.queryByText("thinking…")).toBeNull();
  });

  it("shows the error message", () => {
    render(overlay({ question: "why?", answer: null, error: "pi is not running", pending: false }));

    expect(screen.getByText("pi is not running")).toBeDefined();
  });

  it("closes via the dismiss button and Escape", () => {
    const onClose = vi.fn();
    const { baseElement } = render(
      overlay({ question: "q", answer: "a", error: null, pending: false }, onClose),
    );

    fireEvent.click(screen.getByRole("button", { name: "Dismiss side question" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(baseElement.ownerDocument.body, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
