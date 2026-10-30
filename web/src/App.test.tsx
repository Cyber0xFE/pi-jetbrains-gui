import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "./App";
import type { Inbound, Outbound } from "./types";

declare global {
  interface Window {
    __piSent?: Outbound[];
    __piPush?: (message: Inbound) => void;
  }
}

beforeEach(() => {
  window.__piSent = [];
  window.__piNativePost = (message) => window.__piSent?.push(message);
});

afterEach(() => {
  cleanup();
  delete window.__piNativePost;
  delete window.__piDeliver;
  delete window.__piSent;
  delete window.__piPush;
});

function deliver(...messages: Inbound[]): void {
  for (const message of messages) {
    const push = window.__piDeliver;
    if (!push) throw new Error("the app has not installed its bridge handler yet");
    push(message);
  }
}

describe("App", () => {
  it("announces itself to the host and renders the status bar", async () => {
    render(<App />);

    await waitFor(() => expect(window.__piSent).toEqual([{ type: "ready" }]));
    expect(screen.getAllByText("not started").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Start pi" }));
    await waitFor(() =>
      expect(window.__piSent?.filter((message) => message.type === "start")).toEqual([{ type: "start" }]),
    );
  });

  it("renders history, streamed deltas, tool cards and notices", async () => {
    render(<App />);
    await waitFor(() => expect(window.__piDeliver).toBeDefined());

    deliver(
      {
        type: "status",
        status: {
          phase: "running",
          message: "ready",
          model: "fake-model",
          thinkingLevel: "high",
          isStreaming: true,
          context: { tokens: 1200, contextWindow: 100_000, percent: 1.2 },
        },
      },
      {
        type: "history",
        final: true,
        messages: [
          { role: "user", content: "explain this repo", timestamp: 1 },
          { role: "assistant", content: [{ type: "text", text: "It is a pi checkout." }], timestamp: 2 },
        ],
      },
      {
        type: "records",
        records: [
          { type: "agent_start" },
          { type: "message_start", message: { role: "assistant", content: [], timestamp: 3, stopReason: "pending" } },
          { type: "message_update", assistantMessageEvent: { type: "text_start", contentIndex: 0 } },
          { type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "streamed " } },
          { type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "answer" } },
          { type: "message_update", assistantMessageEvent: { type: "toolcall_start", contentIndex: 1, id: "call-1", toolName: "read" } },
          {
            type: "tool_execution_end",
            toolCallId: "call-1",
            toolName: "read",
            result: { content: [{ type: "text", text: "file body" }] },
            isError: false,
            durationMs: 3,
          },
          {
            type: "message_update",
            assistantMessageEvent: {
              type: "toolcall_end",
              contentIndex: 1,
              toolCall: { type: "toolCall", id: "call-1", name: "read", arguments: { path: "src/index.ts" } },
            },
          },
          { type: "agent_settled", aborted: false },
        ],
      },
      { type: "notice", level: "error", message: "boom" },
    );

    await waitFor(() => expect(screen.getByText("explain this repo")).toBeDefined());
    expect(screen.getByText("It is a pi checkout.")).toBeDefined();
    expect(screen.getByText("streamed answer")).toBeDefined();
    expect(screen.getByText("file body")).toBeDefined();
    expect(screen.getByText("boom")).toBeDefined();
    expect(screen.getByText(/fake-model/)).toBeDefined();
    expect(screen.getByText(/1\.2k \/ 100\.0k/)).toBeDefined();
  });

  it("sends a prompt and clears the composer", async () => {
    render(<App />);
    await waitFor(() => expect(window.__piDeliver).toBeDefined());

    deliver({
      type: "status",
      status: { phase: "running", message: "ready", model: "m" },
    });

    const input = await screen.findByPlaceholderText(/Send a message to pi/);
    await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeDefined());

    fireEvent.change(input, { target: { value: "hello pi" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() =>
      expect(window.__piSent?.filter((message) => message.type === "prompt")).toEqual([
        { type: "prompt", message: "hello pi" },
      ]),
    );
    expect((input as HTMLTextAreaElement).value).toBe("");
  });
});
