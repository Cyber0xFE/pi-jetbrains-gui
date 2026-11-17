import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelMenu } from "./ModelMenu";
import type { ModelInfo } from "../types";

afterEach(cleanup);

const MODELS: ModelInfo[] = [
  { id: "DeepSeek-V4.1-Flash", name: "DeepSeek-V4.1-Flash", provider: "deepseek", reasoning: true, contextWindow: 200_000 },
  { id: "DeepSeek-V4-Pro", name: "DeepSeek-V4-Pro", provider: "deepseek" },
  { id: "mimo-v2.6-flash", name: "mimo-v2.6-flash", provider: "mimo" },
  { id: "mimo-v2.6-pro", name: "mimo-v2.6-pro", provider: "mimo" },
  { id: "deepseek-v4.1-flash", provider: "ark" },
];

function menu(overrides: Partial<Parameters<typeof ModelMenu>[0]> = {}): JSX.Element {
  return (
    <ModelMenu
      models={MODELS}
      ready
      activeProvider="mimo"
      activeModel="mimo-v2.6-flash"
      defaultProvider="deepseek"
      defaultModel="DeepSeek-V4.1-Flash"
      onSelect={() => undefined}
      onSetDefault={() => undefined}
      onAddModel={() => undefined}
      {...overrides}
    />
  );
}

describe("ModelMenu", () => {
  it("groups models by provider and marks the active and default rows", () => {
    const { container } = render(menu());

    expect(screen.getByText("deepseek")).toBeDefined();
    expect(screen.getByText("mimo")).toBeDefined();
    expect(screen.getByText("ark")).toBeDefined();
    expect(container.querySelectorAll(".model-menu-group")).toHaveLength(3);

    const activeRow = screen.getByRole("option", { name: /mimo-v2.6-flash/ });
    expect(activeRow.getAttribute("aria-selected")).toBe("true");
    expect(activeRow.querySelector(".model-menu-check")).not.toBeNull();

    expect(screen.getByText("default")).toBeDefined();
    expect(within(activeRow).getByRole("button", { name: "Set as default" })).toBeDefined();
  });

  it("filters by name, id or provider and drops empty groups", () => {
    render(menu());

    const search = screen.getByPlaceholderText("Search models…") as HTMLInputElement;
    fireEvent.change(search, { target: { value: "ark" } });

    expect(screen.getByText("deepseek-v4.1-flash")).toBeDefined();
    expect(screen.queryByText("mimo-v2.6-pro")).toBeNull();
    expect(screen.queryByText("DeepSeek-V4-Pro")).toBeNull();
    expect(screen.getAllByText("ark")).toHaveLength(1);
  });

  it("selects a model on click and reports the default action separately", () => {
    const onSelect = vi.fn();
    const onSetDefault = vi.fn();
    render(menu({ onSelect, onSetDefault }));

    fireEvent.click(screen.getByText("mimo-v2.6-pro"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0]?.[0]).toMatchObject({ id: "mimo-v2.6-pro" });

    const activeRow = screen.getByRole("option", { name: /mimo-v2.6-flash/ });
    fireEvent.click(within(activeRow).getByRole("button", { name: "Set as default" }));
    expect(onSetDefault).toHaveBeenCalledTimes(1);
    expect(onSetDefault.mock.calls[0]?.[0]).toMatchObject({ id: "mimo-v2.6-flash" });
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("selects from the keyboard and opens the add-model dialog", () => {
    const onSelect = vi.fn();
    const onAddModel = vi.fn();
    render(menu({ onSelect, onAddModel }));

    const search = screen.getByPlaceholderText("Search models…");
    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: /Add model/ }));
    expect(onAddModel).toHaveBeenCalledTimes(1);
  });

  it("shows the loading and stopped empty states", () => {
    const { rerender } = render(menu({ models: [] }));
    expect(screen.getByText("loading models…")).toBeDefined();

    rerender(menu({ models: [], ready: false }));
    expect(screen.getByText("pi is not running")).toBeDefined();
  });
});
