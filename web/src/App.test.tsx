import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  vi.restoreAllMocks();
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

    // The first user message doubles as the session label in the toolbar.
    await waitFor(() => expect(screen.getAllByText("explain this repo").length).toBeGreaterThan(0));
    expect(screen.getByRole("complementary", { name: "User message navigation" })).toBeDefined();
    expect(screen.getByRole("button", { name: /Jump to user message 1: explain this repo/ })).toBeDefined();
    expect(screen.getByText("It is a pi checkout.")).toBeDefined();
    expect(screen.getByText("streamed answer")).toBeDefined();
    expect(screen.getByText("file body")).toBeDefined();
    expect(screen.getByText("boom")).toBeDefined();
    expect(screen.getAllByText(/fake-model/).length).toBeGreaterThan(0);
    expect(screen.getByText(/1\.2%\/100k/)).toBeDefined();
    expect(screen.getByRole("button", { name: "自动压缩开启" })).toBeDefined();
    // The TUI-style footer sits below the composer, not above the transcript.
    const app = document.querySelector(".app");
    expect(app?.lastElementChild?.className).toContain("statusbar");
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
    const connectingStatus = screen.getByRole("status", { name: "正在连接服务" });
    expect(connectingStatus.querySelector("animateTransform")).not.toBeNull();
    expect((input as HTMLTextAreaElement).value).toBe("");

    // The toolbar label switches from 未命名会话 to the first message once pi echoes it.
    expect(screen.getByRole("button", { name: "未命名会话" })).toBeDefined();
    deliver({
      type: "records",
      records: [{ type: "message_start", message: { role: "user", content: "hello pi", timestamp: 5 } }],
    });
    expect(await screen.findByRole("button", { name: "hello pi" })).toBeDefined();
  });

  it("lists sessions and switches to another one", async () => {
    render(<App />);
    await waitFor(() => expect(window.__piDeliver).toBeDefined());

    deliver(
      {
        type: "status",
        status: { phase: "running", message: "ready", sessionId: "s1", sessionFile: "/p/s1.jsonl" },
      },
      {
        type: "sessions",
        sessions: [
          { path: "/p/s1.jsonl", id: "s1", messageCount: 2, modified: 1, current: true },
          { path: "/p/s2.jsonl", id: "s2", messageCount: 4, modified: 2, current: false, firstMessage: "older session" },
        ],
      },
    );

    const sessionsButton = (await screen.findByRole("button", { name: "未命名会话" })) as HTMLButtonElement;
    await waitFor(() => expect(sessionsButton.disabled).toBe(false));
    fireEvent.click(sessionsButton);
    expect(await screen.findByRole("dialog", { name: "Sessions" })).toBeDefined();

    fireEvent.click(screen.getByText("older session"));
    await waitFor(() =>
      expect(window.__piSent?.filter((message) => message.type === "switch_session")).toEqual([
        { type: "switch_session", path: "/p/s2.jsonl", sessionId: "s2" },
      ]),
    );
  });

  it.each([false, true])("opens history at the bottom after reading upward (batched reset: %s)", async (batched) => {
    // jsdom has no layout: emulate the browser clamping scrollTop to the bottom.
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(2000);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(400);
    const positions = new WeakMap<HTMLElement, number>();
    vi.spyOn(HTMLElement.prototype, "scrollTop", "get").mockImplementation(function (this: HTMLElement) {
      return positions.get(this) ?? 0;
    });
    vi.spyOn(HTMLElement.prototype, "scrollTop", "set").mockImplementation(function (this: HTMLElement, top: number) {
      positions.set(this, Math.max(0, Math.min(top, this.scrollHeight - this.clientHeight)));
    });
    render(<App />);
    await waitFor(() => expect(window.__piDeliver).toBeDefined());
    deliver({ type: "history", final: true, messages: [{ role: "user", content: "old question", timestamp: 1 }] });
    await screen.findByRole("button", { name: /Jump to user message 1: old question/ });
    const oldLog = screen.getByRole("log");
    expect(oldLog.scrollTop).toBe(1600);
    oldLog.scrollTop = 600;
    fireEvent.scroll(oldLog);
    await screen.findByRole("button", { name: "Back to latest" });

    deliver({ type: "reset", reason: "switch" });
    if (!batched) await screen.findByText("loading transcript");
    deliver({ type: "history", final: false, messages: [{ role: "user", content: "historical question", timestamp: 2 }] });
    await screen.findByRole("button", { name: /Jump to user message 1: historical question/ });
    const log = screen.getByRole("log");
    expect(log).not.toBe(oldLog);
    expect(log.scrollTop).toBe(1600);
    expect(screen.queryByRole("button", { name: "Back to latest" })).toBeNull();

    // A later chunk must remain pinned to the new bottom.
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(3000);
    deliver({ type: "history", final: true, messages: [{ role: "assistant", content: "latest historical answer", timestamp: 3 }] });
    await screen.findByText("latest historical answer");
    expect(log.scrollTop).toBe(2600);
  });

  it("scrolls to the latest message when the host requests it", async () => {
    render(<App />);
    await waitFor(() => expect(window.__piDeliver).toBeDefined());
    const log = screen.getByRole("log");
    Object.defineProperty(log, "scrollHeight", { configurable: true, value: 2000 });
    Object.defineProperty(log, "scrollTop", { configurable: true, writable: true, value: 0 });

    deliver({ type: "scroll_to_latest" });

    await waitFor(() => expect(log.scrollTop).toBe(2000));
  });

  it("jumps between user messages when the host requests navigation", async () => {
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(3000);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(400);
    let top = 2400;
    vi.spyOn(HTMLElement.prototype, "scrollTop", "get").mockImplementation(() => top);
    vi.spyOn(HTMLElement.prototype, "scrollTop", "set").mockImplementation((value: number) => { top = value; });
    HTMLElement.prototype.scrollIntoView = vi.fn();
    render(<App />);
    await waitFor(() => expect(window.__piDeliver).toBeDefined());
    deliver({
      type: "history",
      final: true,
      messages: [
        { role: "user" as const, content: "question-0", timestamp: 0 },
        { role: "assistant" as const, content: "answer-0", timestamp: 1 },
        { role: "user" as const, content: "question-1", timestamp: 2 },
        { role: "assistant" as const, content: "answer-1", timestamp: 3 },
        { role: "user" as const, content: "question-2", timestamp: 4 },
      ],
    });
    await screen.findByText("question-2");
    Array.from(document.querySelectorAll<HTMLElement>(".message-user")).forEach((element, index) => {
      Object.defineProperty(element, "offsetTop", { configurable: true, value: index * 1200 });
    });
    await waitFor(() => expect(screen.getByTitle("question-2").getAttribute("aria-current")).toBe("location"));

    // Rest the viewport on the newest user message (not below it) before stepping up.
    top = 2400;
    deliver({ type: "scroll_to_user_message", direction: "previous" });
    await waitFor(() => expect(screen.getByTitle("question-1").getAttribute("aria-current")).toBe("location"));

    top = 1200;
    deliver({ type: "scroll_to_user_message", direction: "next" });
    await waitFor(() => expect(screen.getByTitle("question-2").getAttribute("aria-current")).toBe("location"));
  });

  it("loads the first message and scrolls to it when the host requests it", async () => {
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(2000);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(400);
    let top = 0;
    vi.spyOn(HTMLElement.prototype, "scrollTop", "get").mockImplementation(() => top);
    vi.spyOn(HTMLElement.prototype, "scrollTop", "set").mockImplementation((value: number) => { top = value; });
    render(<App />);
    await waitFor(() => expect(window.__piDeliver).toBeDefined());
    deliver({
      type: "history",
      final: true,
      messages: Array.from({ length: 61 }, (_, index) => ({
        role: "user" as const,
        content: `question-${index}`,
        timestamp: index,
      })),
    });
    await screen.findByText("question-60");
    expect(document.querySelectorAll(".message")).toHaveLength(60);

    deliver({ type: "scroll_to_first" });

    await waitFor(() => expect(document.querySelectorAll(".message")).toHaveLength(61));
    await waitFor(() => expect(screen.getByRole("log").scrollTop).toBe(0));
  });

  it("renames the current session from the session picker", async () => {
    render(<App />);
    await waitFor(() => expect(window.__piDeliver).toBeDefined());

    deliver(
      {
        type: "status",
        status: { phase: "running", message: "ready", sessionId: "s1", sessionFile: "/p/s1.jsonl" },
      },
      {
        type: "sessions",
        sessions: [{ path: "/p/s1.jsonl", id: "s1", messageCount: 2, modified: 1, current: true }],
      },
    );

    const renameSessionButton = (await screen.findByRole("button", { name: "未命名会话" })) as HTMLButtonElement;
    await waitFor(() => expect(renameSessionButton.disabled).toBe(false));
    fireEvent.click(renameSessionButton);
    fireEvent.click(await screen.findByRole("button", { name: "Rename" }));
    const input = await screen.findByPlaceholderText("Session title");
    fireEvent.change(input, { target: { value: "架构设计讨论" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(window.__piSent?.filter((message) => message.type === "rename_session")).toEqual([
        { type: "rename_session", name: "架构设计讨论" },
      ]),
    );
  });

  it("filters models and sets the selected one", async () => {
    render(<App />);
    await waitFor(() => expect(window.__piDeliver).toBeDefined());

    deliver(
      { type: "status", status: { phase: "running", message: "ready", provider: "openai", model: "gpt-5" } },
      {
        type: "models",
        currentProvider: "openai",
        currentModel: "gpt-5",
        models: [
          { id: "gpt-5", name: "GPT-5", provider: "openai", reasoning: true, contextWindow: 200_000 },
          { id: "claude", name: "Claude", provider: "anthropic", contextWindow: 100_000 },
        ],
      },
    );

    fireEvent.click(await screen.findByRole("button", { name: /openai\/gpt-5/ }));
    const search = await screen.findByPlaceholderText("Filter models by name or provider…");
    fireEvent.change(search, { target: { value: "claude" } });

    expect(screen.queryByText(/GPT-5/)).toBeNull();
    fireEvent.click(screen.getByText("Claude"));

    await waitFor(() =>
      expect(window.__piSent?.filter((message) => message.type === "set_model")).toEqual([
        { type: "set_model", provider: "anthropic", modelId: "claude" },
      ]),
    );
  });

  it("marks the default model and offers a hover action for other models", async () => {
    render(<App />);
    await waitFor(() => expect(window.__piDeliver).toBeDefined());

    deliver(
      { type: "status", status: { phase: "running", message: "ready", provider: "openai", model: "gpt-5" } },
      {
        type: "models",
        currentProvider: "openai",
        currentModel: "gpt-5",
        defaultProvider: "openai",
        defaultModel: "gpt-5",
        models: [
          { id: "gpt-5", name: "GPT-5", provider: "openai" },
          { id: "claude", name: "Claude", provider: "anthropic" },
        ],
      },
    );

    fireEvent.click(await screen.findByRole("button", { name: /openai\/gpt-5/ }));
    expect(await screen.findByText("default")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Set as default" }));

    await waitFor(() =>
      expect(window.__piSent?.filter((message) => message.type === "set_default_model")).toEqual([
        { type: "set_default_model", provider: "anthropic", modelId: "claude" },
      ]),
    );
  });

  it("changes the thinking level and shows retry controls", async () => {
    render(<App />);
    await waitFor(() => expect(window.__piDeliver).toBeDefined());

    deliver(
      {
        type: "status",
        status: {
          phase: "running",
          message: "ready",
          model: "m",
          reasoning: true,
          thinkingLevel: "high",
          retry: { attempt: 1, maxAttempts: 3, delayMs: 2000, errorMessage: "overloaded" },
        },
      },
      { type: "thinking_levels", levels: ["off", "low", "high"], current: "high" },
    );

    expect(await screen.findByText(/retrying \(1\/3\)/)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Abort retry" }));
    await waitFor(() =>
      expect(window.__piSent?.filter((message) => message.type === "abort_retry")).toEqual([{ type: "abort_retry" }]),
    );

    fireEvent.click(screen.getByRole("button", { name: "high ▾" }));
    fireEvent.click(await screen.findByText("low"));
    await waitFor(() =>
      expect(window.__piSent?.filter((message) => message.type === "set_thinking_level")).toEqual([
        { type: "set_thinking_level", level: "low" },
      ]),
    );
  });

  it("completes @ file references and sends them with the prompt", async () => {
    render(<App />);
    await waitFor(() => expect(window.__piDeliver).toBeDefined());

    deliver(
      { type: "status", status: { phase: "running", message: "ready", model: "m" } },
      { type: "files", files: ["src/main.kt", "src/main.test.kt", "docs/JETBRAINS_GUI_PLAN.md"] },
    );

    const input = (await screen.findByPlaceholderText(/Send a message to pi/)) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "Please inspect @plan" } });
    expect(await screen.findByRole("listbox", { name: "Referenced files" })).toBeDefined();
    fireEvent.click(screen.getByRole("option", { name: /docs\/JETBRAINS_GUI_PLAN\.md/ }));
    expect(input.value).toBe("Please inspect @docs/JETBRAINS_GUI_PLAN.md ");

    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() =>
      expect(window.__piSent?.filter((message) => message.type === "prompt")).toEqual([
        { type: "prompt", message: "Please inspect @docs/JETBRAINS_GUI_PLAN.md" },
      ]),
    );
  });

  it("completes a visuals HTML reference after a skill command", async () => {
    render(<App />);
    await waitFor(() => expect(window.__piDeliver).toBeDefined());

    deliver(
      { type: "status", status: { phase: "running", message: "ready", model: "m" } },
      { type: "files", files: ["api/agent.py", "visuals/agent-flow.html"] },
    );

    const input = (await screen.findByPlaceholderText(/Send a message to pi/)) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "/skill:drawio-skill 画一下 @agent" } });
    fireEvent.click(await screen.findByRole("option", { name: /visuals\/agent-flow\.html/ }));
    expect(input.value).toBe("/skill:drawio-skill 画一下 @visuals/agent-flow.html ");

    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() =>
      expect(window.__piSent?.filter((message) => message.type === "prompt")).toEqual([
        { type: "prompt", message: "/skill:drawio-skill 画一下 @visuals/agent-flow.html" },
      ]),
    );
  });

  it("completes a directory reference and sends it with the prompt", async () => {
    render(<App />);
    await waitFor(() => expect(window.__piDeliver).toBeDefined());

    deliver(
      { type: "status", status: { phase: "running", message: "ready", model: "m" } },
      { type: "files", files: ["src", "src/main.kt", "docs"] },
    );
    const input = screen.getByRole("textbox", { name: "Message to pi" }) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "Please inspect @doc" } });
    fireEvent.click(await screen.findByRole("option", { name: /docs/ }));
    expect(input.value).toBe("Please inspect @docs ");

    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() =>
      expect(window.__piSent).toContainEqual({ type: "prompt", message: "Please inspect @docs" }),
    );
  });

  it("steers and queues follow-ups while pi is streaming", async () => {
    render(<App />);
    await waitFor(() => expect(window.__piDeliver).toBeDefined());

    deliver({
      type: "status",
      status: { phase: "running", message: "ready", model: "m", isStreaming: true },
    });

    const input = await screen.findByPlaceholderText(/Enter to steer/);

    // Enter queues the message as steering.
    fireEvent.change(input, { target: { value: "check the failing test" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(window.__piSent?.filter((message) => message.type === "prompt")).toEqual([
        { type: "prompt", message: "check the failing test", streamingBehavior: "steer" },
      ]),
    );
    expect((input as HTMLTextAreaElement).value).toBe("");

    // The host confirms the queued steer immediately; the store coalesces submit + response
    // into one rAF flush, so the composer re-enables without a visible disabled window.
    deliver({
      type: "records",
      records: [{ type: "response", command: "prompt", success: true }],
    });

    // Alt+Enter queues a follow-up instead. Retry the key press while the coalesced flush is
    // still in flight; once it commits, the composer accepts the follow-up.
    fireEvent.change(input, { target: { value: "then run the suite" } });
    await waitFor(() => {
      fireEvent.keyDown(input, { key: "Enter", altKey: true });
      expect(window.__piSent?.filter((message) => message.type === "prompt")).toHaveLength(2);
    });
    const prompts = window.__piSent?.filter((message) => message.type === "prompt") ?? [];
    expect(prompts[1]).toEqual({
      type: "prompt",
      message: "then run the suite",
      streamingBehavior: "followUp",
    });

    // The pending queues render above the composer until pi delivers them.
    deliver({
      type: "records",
      records: [{ type: "queue_update", steering: ["check the failing test"], followUp: ["then run the suite"] }],
    });
    expect(await screen.findByRole("status", { name: "Queued messages" })).toBeDefined();
    expect(screen.getByText("check the failing test")).toBeDefined();
    expect(screen.getByText("then run the suite")).toBeDefined();

    deliver({
      type: "records",
      records: [{ type: "queue_update", steering: [], followUp: [] }],
    });
    await waitFor(() => expect(screen.queryByRole("status", { name: "Queued messages" })).toBeNull());
  });

  it("opens the queue editor with the messages pi hands back after a stop", async () => {
    render(<App />);
    await waitFor(() => expect(window.__piDeliver).toBeDefined());

    deliver(
      { type: "status", status: { phase: "running", message: "ready", model: "m", isStreaming: true } },
      { type: "records", records: [{ type: "queue_update", steering: ["first"], followUp: ["next"] }] },
    );
    const input = (await screen.findByRole("textbox", { name: "Message to pi" })) as HTMLTextAreaElement;
    expect(await screen.findByRole("status", { name: "Queued messages" })).toBeDefined();

    // Stop is handled by the host: it clears the queues first, then aborts.
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    await waitFor(() =>
      expect(window.__piSent?.filter((message) => message.type === "abort")).toEqual([{ type: "abort" }]),
    );

    // The cleared messages come back for editing instead of being dropped.
    deliver({ type: "dequeue", steering: ["first"], followUp: ["next"] });
    expect(await screen.findByRole("dialog", { name: "Edit queued messages" })).toBeDefined();

    // A later empty report (nothing left to clear) must not close the editor.
    deliver({ type: "dequeue", steering: [], followUp: [] });
    expect(screen.getByRole("dialog", { name: "Edit queued messages" })).toBeDefined();

    // Cancel re-queues them so a stop never silently discards pending messages. The host posts
    // them one by one, so the queue kinds travel with the request.
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(window.__piSent?.filter((message) => message.type === "send_queued")).toEqual([
        {
          type: "send_queued",
          queued: [
            { text: "first", kind: "steering" },
            { text: "next", kind: "followUp" },
          ],
        },
      ]),
    );
    expect(input.value).toBe("");
  });

  it("edits queued messages in place and re-posts them one by one", async () => {
    render(<App />);
    await waitFor(() => expect(window.__piDeliver).toBeDefined());

    deliver(
      { type: "status", status: { phase: "running", message: "ready", model: "m", isStreaming: true } },
      {
        type: "records",
        records: [{ type: "queue_update", steering: ["first", "second"], followUp: ["third"] }],
      },
    );
    const input = (await screen.findByRole("textbox", { name: "Message to pi" })) as HTMLTextAreaElement;
    expect(await screen.findByRole("status", { name: "Queued messages" })).toBeDefined();

    // The Edit action clears pi's queues so the messages can be edited individually.
    fireEvent.click(screen.getByRole("button", { name: "✎ Edit" }));
    await waitFor(() =>
      expect(window.__piSent?.filter((message) => message.type === "clear_queue")).toEqual([
        { type: "clear_queue" },
      ]),
    );

    // The host returns the cleared queues: one editor per message, no merging into the draft.
    deliver({ type: "dequeue", steering: ["first", "second"], followUp: ["third"] });
    const editors = await screen.findAllByRole("textbox", { name: /Queued (steering|follow-up) message/ });
    expect(editors.map((editor) => (editor as HTMLTextAreaElement).value)).toEqual(["first", "second", "third"]);
    expect(input.value).toBe("");

    // Editing one message keeps the others intact.
    fireEvent.change(editors[1] as HTMLTextAreaElement, { target: { value: "second (edited)" } });
    fireEvent.click(screen.getByRole("button", { name: "Remove queued follow-up message 3" }));
    expect(screen.getAllByRole("textbox", { name: /Queued (steering|follow-up) message/ })).toHaveLength(2);

    // Send all hands the messages to the host, which posts them one by one so the first starts a
    // run and the rest are queued instead of being merged into it.
    fireEvent.click(screen.getByRole("button", { name: "Send all" }));
    await waitFor(() =>
      expect(window.__piSent?.filter((message) => message.type === "send_queued")).toEqual([
        {
          type: "send_queued",
          queued: [
            { text: "first", kind: "steering" },
            { text: "second (edited)", kind: "steering" },
          ],
        },
      ]),
    );
    expect(screen.queryByRole("dialog", { name: "Edit queued messages" })).toBeNull();

    // Alt+Up on the composer still opens the same editor.
    deliver(
      { type: "records", records: [{ type: "queue_update", steering: ["again"], followUp: [] }] },
    );
    expect(await screen.findByRole("status", { name: "Queued messages" })).toBeDefined();
    fireEvent.keyDown(input, { key: "ArrowUp", altKey: true });
    await waitFor(() =>
      expect(window.__piSent?.filter((message) => message.type === "clear_queue")).toHaveLength(2),
    );
    deliver({ type: "dequeue", steering: ["again"], followUp: [] });
    expect(await screen.findByRole("dialog", { name: "Edit queued messages" })).toBeDefined();

    // Cancel restores the untouched queue through the same host-side path.
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(window.__piSent?.filter((message) => message.type === "send_queued")).toHaveLength(2),
    );
    expect(window.__piSent?.filter((message) => message.type === "send_queued")[1]).toEqual({
      type: "send_queued",
      queued: [{ text: "again", kind: "steering" }],
    });
  });

  it("sends selected editor context when the message is empty", async () => {
    render(<App />);
    await waitFor(() => expect(window.__piDeliver).toBeDefined());

    deliver(
      {
        type: "status",
        status: { phase: "running", message: "ready", model: "m", pendingContext: "src/main.kt:4-6" },
      },
    );

    const input = await screen.findByRole("textbox", { name: "Message to pi" });
    const sendButton = screen.getByRole("button", { name: "Send" });
    await waitFor(() => expect((sendButton as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(sendButton);

    await waitFor(() =>
      expect(window.__piSent?.filter((message) => message.type === "prompt")).toEqual([
        { type: "prompt", message: "" },
      ]),
    );
    expect((input as HTMLTextAreaElement).value).toBe("");
  });

  it("opens the current session tree with /tree", async () => {
    render(<App />);
    await waitFor(() => expect(window.__piDeliver).toBeDefined());

    deliver(
      { type: "status", status: { phase: "running", message: "ready", model: "m" } },
      {
        type: "session_tree",
        entries: [
          { id: "entry-1", type: "message", role: "user", text: "hello", depth: 0, forkable: true, active: true },
          { id: "assistant-1", type: "message", role: "assistant", text: "assistant: hidden", depth: 0, forkable: false, active: true },
          { id: "tool-1", type: "message", role: "toolResult", text: "[bash: hidden]", depth: 0, forkable: false, active: true },
        ],
        leafId: "entry-1",
        sessionId: "session-1",
      },
    );

    const input = (await screen.findByPlaceholderText(/Send a message to pi/)) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "/tree" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(await screen.findByRole("dialog", { name: "Session tree" })).toBeDefined();
    expect(screen.getByText("hello")).toBeDefined();
    expect(screen.queryByText("assistant: hidden")).toBeNull();
    expect(screen.queryByText("[bash: hidden]")).toBeNull();
    expect(input.value).toBe("");
    expect(window.__piSent?.filter((message) => message.type === "prompt")).toEqual([]);
  });

  it("preserves images when forking from an image-bearing user message", async () => {
    render(<App />);
    await waitFor(() => expect(window.__piDeliver).toBeDefined());
    const image = { data: "aGVsbG8=", mimeType: "image/png" };
    deliver(
      { type: "status", status: { phase: "running", message: "ready", model: "m" } },
      {
        type: "session_tree",
        entries: [{ id: "entry-image", type: "message", role: "user", text: "user: inspect", depth: 0, forkable: true, active: true, images: [image] }],
        leafId: "entry-image",
        sessionId: "session-1",
      },
    );

    fireEvent.change(await screen.findByPlaceholderText(/Send a message to pi/), { target: { value: "/tree" } });
    fireEvent.keyDown(await screen.findByPlaceholderText(/Send a message to pi/), { key: "Enter" });
    fireEvent.click(await screen.findByRole("option", { name: /inspect/ }));

    await waitFor(() => expect(window.__piSent?.filter((message) => message.type === "fork")).toEqual([
      { type: "fork", entryId: "entry-image", images: [image] },
    ]));
    deliver({ type: "prefill", text: "inspect", images: [image] });
    expect(await screen.findByRole("img", { name: "Attachment 1" })).toBeDefined();
  });

  it("completes slash commands in the composer", async () => {
    render(<App />);
    await waitFor(() => expect(window.__piDeliver).toBeDefined());

    deliver(
      { type: "status", status: { phase: "running", message: "ready", model: "m" } },
      {
        type: "commands",
        commands: [
          { name: "compact", description: "Compact the context", source: "extension" },
          { name: "review", description: "Review the diff", source: "prompt" },
        ],
      },
    );

    const input = (await screen.findByPlaceholderText(/Send a message to pi/)) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "/co" } });
    expect(await screen.findByRole("listbox", { name: "Slash commands" })).toBeDefined();

    fireEvent.change(input, { target: { value: "/vie" } });
    expect(await screen.findByText("/review")).toBeDefined();

    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(input.value).toBe("/review "));
    expect(window.__piSent?.filter((message) => message.type === "prompt")).toEqual([]);

    fireEvent.change(input, { target: { value: "/compact" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(input.value).toBe("") );
    expect(window.__piSent?.filter((message) => message.type === "compact")).toEqual([{ type: "compact" }]);
  });
});

describe("Ctrl+F search", () => {
  it("seeds the search query from text selected inside a message", async () => {
    render(<App />);
    await waitFor(() => expect(window.__piDeliver).toBeDefined());

    deliver(
      { type: "status", status: { phase: "running", message: "ready", model: "m" } },
      {
        type: "history",
        final: true,
        messages: [
          { role: "user", content: "explain the search feature of this repo", timestamp: 1 },
          { role: "assistant", content: [{ type: "text", text: "It is a pi checkout." }], timestamp: 2 },
        ],
      },
    );
    await waitFor(() => expect(screen.getAllByText(/explain the search feature/).length).toBeGreaterThan(0));

    // Select part of the user message body, then press Ctrl+F.
    const paragraph = document.querySelector('[data-message-id] .markdown p');
    expect(paragraph).not.toBeNull();
    const range = document.createRange();
    range.selectNodeContents(paragraph!);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    fireEvent.keyDown(window, { key: "f", ctrlKey: true });

    const input = screen.getByRole("textbox", { name: "搜索消息" }) as HTMLInputElement;
    expect(input.value).toBe("explain the search feature of this repo");
  });

  it("opens an empty search bar without a message selection", async () => {
    render(<App />);
    await waitFor(() => expect(window.__piDeliver).toBeDefined());

    deliver({ type: "status", status: { phase: "running", message: "ready", model: "m" } });
    await waitFor(() => expect(screen.getByRole("log")).toBeDefined());

    fireEvent.keyDown(window, { key: "f", ctrlKey: true });

    const input = screen.getByRole("textbox", { name: "搜索消息" }) as HTMLInputElement;
    expect(input.value).toBe("");
  });
});
