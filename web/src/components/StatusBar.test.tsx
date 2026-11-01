import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WireStatus } from "../types";
import { StatusBar } from "./StatusBar";

afterEach(cleanup);

function footer(status: WireStatus, overrides: Partial<Parameters<typeof StatusBar>[0]> = {}): JSX.Element {
  return (
    <StatusBar
      status={status}
      busy={false}
      disabled={false}
      modelCount={0}
      cacheHitRate={null}
      extensionStatuses={{}}
      onOpenModels={() => undefined}
      onOpenThinking={() => undefined}
      onToggleAutoCompaction={() => undefined}
      {...overrides}
    />
  );
}

describe("StatusBar", () => {
  it("renders the TUI footer fields: location, usage, context and model", () => {
    render(
      footer(
        {
          phase: "running",
          message: "ready",
          model: "deepseek-v4.1-flash",
          provider: "agent-plan",
          reasoning: true,
          thinkingLevel: "high",
          autoCompaction: true,
          usage: { input: 197_000, output: 119_000, cacheRead: 13_000_000, cacheWrite: 2_500, cost: 0.043 },
          context: { tokens: 188_000, contextWindow: 524_000, percent: 35.9 },
        },
        { cacheHitRate: 99.4 },
      ),
    );

    expect(screen.getByText("↑197k")).toBeDefined();
    expect(screen.getByText("↓119k")).toBeDefined();
    expect(screen.getByText("R13M")).toBeDefined();
    expect(screen.getByText("W2.5k")).toBeDefined();
    expect(screen.getByText("CH99.4%")).toBeDefined();
    expect(screen.getByText("$0.043")).toBeDefined();
    expect(screen.getByText("35.9%/524k")).toBeDefined();
    expect(screen.getByRole("button", { name: "自动压缩开启" })).toBeDefined();
    expect(screen.getByText(/agent-plan\/deepseek-v4\.1-flash ▾/)).toBeDefined();
    expect(screen.getByRole("button", { name: "high ▾" })).toBeDefined();
  });

  it("opens the model picker from the footer model entry", () => {
    const onOpenModels = vi.fn();
    render(footer({ phase: "running", message: "ready", model: "m", provider: "p" }, { modelCount: 3, onOpenModels }));

    const modelButton = screen.getByRole("button", { name: /p\/m ▾/ });
    expect(modelButton.getAttribute("title")).toBe("3 available models");
    fireEvent.click(modelButton);
    expect(onOpenModels).toHaveBeenCalledTimes(1);
  });

  it("opens the thinking picker from the footer thinking entry", () => {
    const onOpenThinking = vi.fn();
    render(
      footer(
        { phase: "running", message: "ready", model: "m", reasoning: true, thinkingLevel: "high" },
        { onOpenThinking },
      ),
    );

    const thinkingButton = screen.getByRole("button", { name: "high ▾" });
    expect(thinkingButton.getAttribute("title")).toBe("Thinking level");
    fireEvent.click(thinkingButton);
    expect(onOpenThinking).toHaveBeenCalledTimes(1);
  });

  it("hides the thinking entry when reasoning is off or no level exists", () => {
    const { rerender } = render(
      footer({ phase: "running", message: "ready", model: "m", reasoning: false, thinkingLevel: "high" }),
    );
    expect(screen.queryByRole("button", { name: "high ▾" })).toBeNull();

    rerender(footer({ phase: "running", message: "ready", model: "m", reasoning: true, thinkingLevel: null }));
    expect(screen.queryByTitle("Thinking level")).toBeNull();
  });

  it("shows an unknown context share with the model context window", () => {
    render(footer({ phase: "running", message: "ready", model: "m", contextWindow: 524_000, context: null }));

    expect(screen.getByText("?/524k")).toBeDefined();
    expect(screen.getByRole("button", { name: "自动压缩开启" })).toBeDefined();
  });

  it("warns and errors based on context usage, and labels automatic compaction when off", () => {
    const { container } = render(
      footer({
        phase: "running",
        message: "ready",
        model: "m",
        autoCompaction: false,
        context: { tokens: 1, contextWindow: 1000, percent: 95 },
      }),
    );

    expect(screen.getByText("95.0%/1.0k")).toBeDefined();
    expect(container.querySelector(".status-context-critical")).not.toBeNull();
    const autoButton = screen.getByRole("button", { name: "自动压缩关闭" });
    expect(autoButton.getAttribute("aria-pressed")).toBe("false");
  });

  it("toggles auto-compaction from the footer icon", () => {
    const onToggleAutoCompaction = vi.fn();
    render(
      footer(
        { phase: "running", message: "ready", model: "m", autoCompaction: true },
        { onToggleAutoCompaction },
      ),
    );

    const autoButton = screen.getByRole("button", { name: "自动压缩开启" });
    expect(autoButton.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(autoButton);
    expect(onToggleAutoCompaction).toHaveBeenCalledTimes(1);
  });

  it.each([true, false])("shows the current compaction state on hover and focus (enabled: %s)", (autoCompaction) => {
    const label = autoCompaction ? "自动压缩开启" : "自动压缩关闭";
    const { rerender } = render(footer({ phase: "running", message: "ready", autoCompaction }));
    const autoButton = screen.getByRole("button", { name: label });
    expect(screen.queryByRole("tooltip")).toBeNull();

    fireEvent.mouseEnter(autoButton);
    expect(screen.getByRole("tooltip").textContent).toBe(label);
    expect(autoButton.getAttribute("aria-describedby")).toBe(screen.getByRole("tooltip").id);

    rerender(footer({ phase: "running", message: "ready", autoCompaction: !autoCompaction }));
    expect(screen.getByRole("tooltip").textContent).toBe(autoCompaction ? "自动压缩关闭" : "自动压缩开启");

    fireEvent.mouseLeave(autoButton);
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.focus(autoButton);
    expect(screen.getByRole("tooltip")).toBeDefined();
    fireEvent.blur(autoButton);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("renders extension statuses sorted by key", () => {
    render(
      footer(
        { phase: "running", message: "ready", model: "m" },
        { extensionStatuses: { lint: "2 warnings", git: "clean" } },
      ),
    );

    expect(screen.getByText("clean 2 warnings")).toBeDefined();
  });

  it("surfaces the failure message for stopped or failed processes", () => {
    render(footer({ phase: "failed", message: "pi exited unexpectedly (code=1)" }));

    expect(screen.getByText("pi exited unexpectedly (code=1)")).toBeDefined();
  });
});
