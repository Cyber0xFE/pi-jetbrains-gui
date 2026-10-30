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
      cacheHitRate={null}
      extensionStatuses={{}}
      onSend={() => undefined}
      onAbort={() => undefined}
      canSend={true}
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
    expect(screen.getByText("35.9%/524k (auto)")).toBeDefined();
    expect(screen.getByText(/\(agent-plan\) deepseek-v4\.1-flash • high/)).toBeDefined();
  });

  it("shows an unknown context share with the model context window", () => {
    render(footer({ phase: "running", message: "ready", model: "m", contextWindow: 524_000, context: null }));

    expect(screen.getByText("?/524k (auto)")).toBeDefined();
  });

  it("warns and errors based on context usage, and hides (auto) when disabled", () => {
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
    expect(screen.queryByText(/\(auto\)/)).toBeNull();
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

  it("hosts the send action in the footer", () => {
    const onSend = vi.fn();
    render(footer({ phase: "running", message: "ready", model: "m" }, { onSend }));

    const button = screen.getByRole("button", { name: "Send" });
    expect((button as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(button);
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it("disables Send when there is nothing to send and swaps it for Stop while busy", () => {
    const { rerender } = render(
      footer({ phase: "running", message: "ready", model: "m" }, { canSend: false }),
    );
    expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(true);

    const onAbort = vi.fn();
    rerender(footer({ phase: "running", message: "ready", model: "m" }, { busy: true, onAbort }));
    const stop = screen.getByRole("button", { name: "Stop" });
    fireEvent.click(stop);
    expect(onAbort).toHaveBeenCalledTimes(1);
  });
});
