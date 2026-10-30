import { describe, expect, it } from "vitest";
import type { WireMessage, WireRecord } from "../types";
import { initialState, reduce, type Action, type ChatState } from "./sessionReducer";

function apply(state: ChatState, ...actions: Action[]): ChatState {
  return actions.reduce(reduce, state);
}

function records(...items: WireRecord[]): Action {
  return { kind: "inbound", message: { type: "records", records: items } };
}

function update(event: WireRecord["assistantMessageEvent"]): WireRecord {
  return { type: "message_update", assistantMessageEvent: event };
}

function assistantStart(timestamp = 1): WireRecord {
  return { type: "message_start", message: { role: "assistant", content: [], timestamp, stopReason: "pending" } };
}

describe("sessionReducer", () => {
  it("accumulates text deltas and lets message_end win", () => {
    const state = apply(
      initialState,
      records(
        assistantStart(),
        update({ type: "text_start", contentIndex: 0 }),
        update({ type: "text_delta", contentIndex: 0, delta: "hel" }),
        update({ type: "text_delta", contentIndex: 0, delta: "lo" }),
        update({ type: "text_end", contentIndex: 0, content: "hello" }),
        {
          type: "message_end",
          message: { role: "assistant", content: [{ type: "text", text: "hello world" }], timestamp: 1, stopReason: "stop" },
        },
      ),
    );

    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]?.blocks).toEqual([{ kind: "text", text: "hello world" }]);
    expect(state.messages[0]?.streaming).toBe(false);
    expect(state.streamingMessageId).toBeNull();
  });

  it("recovers when a delta arrives before message_start", () => {
    const state = apply(
      initialState,
      records(
        update({ type: "text_delta", contentIndex: 0, delta: "early" }),
        update({ type: "text_end", contentIndex: 0, content: "early" }),
        { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "early" }], timestamp: 7 } },
      ),
    );

    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]?.blocks).toEqual([{ kind: "text", text: "early" }]);
  });

  it("accepts a message_end without a prior message_start", () => {
    const state = apply(initialState, records({
      type: "message_end",
      message: { role: "assistant", content: [{ type: "text", text: "only end" }], timestamp: 3 },
    }));

    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]?.blocks).toEqual([{ kind: "text", text: "only end" }]);
  });

  it("surfaces an error stop reason on the message", () => {
    const state = apply(
      initialState,
      records(
        assistantStart(4),
        update({ type: "error", reason: "error", error: { message: "provider exploded" } }),
        {
          type: "message_end",
          message: {
            role: "assistant",
            content: [],
            timestamp: 4,
            stopReason: "error",
            errorMessage: "provider exploded",
          },
        },
      ),
    );

    expect(state.messages[0]?.stopReason).toBe("error");
    expect(state.messages[0]?.errorMessage).toBe("provider exploded");
  });

  it("keeps a finished tool result when toolcall_end arrives afterwards", () => {
    const state = apply(
      initialState,
      records(
        assistantStart(),
        update({ type: "toolcall_start", contentIndex: 0, id: "call-1", toolName: "bash" }),
        { type: "tool_execution_end", toolCallId: "call-1", toolName: "bash", result: { output: "done" }, isError: false },
        update({ type: "toolcall_end", contentIndex: 0, toolCall: { type: "toolCall", id: "call-1", name: "bash", arguments: { command: "ls" } } }),
      ),
    );

    expect(state.tools["call-1"]?.status).toBe("done");
    expect(state.tools["call-1"]?.output).toBe("done");
    expect(state.tools["call-1"]?.args).toEqual({ command: "ls" });
  });

  it("attaches toolResult messages to the tool card instead of the transcript", () => {
    const assistant: WireMessage = {
      role: "assistant",
      content: [
        { type: "text", text: "reading" },
        { type: "toolCall", id: "call-2", name: "read", arguments: { path: "a.ts" } },
      ],
      timestamp: 2,
      stopReason: "toolUse",
    };
    const result: WireMessage = {
      role: "toolResult",
      toolCallId: "call-2",
      toolName: "read",
      content: [{ type: "text", text: "file body" }],
      isError: false,
      timestamp: 3,
    };

    const state = apply(
      initialState,
      records(
        { type: "message_start", message: { ...assistant, content: [] } },
        { type: "message_end", message: assistant },
        { type: "message_start", message: result },
        { type: "message_end", message: result },
      ),
    );

    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]?.blocks).toEqual([
      { kind: "text", text: "reading" },
      { kind: "tool", callId: "call-2", name: "read" },
    ]);
    expect(state.tools["call-2"]?.output).toBe("file body");
  });

  it("tracks busy/sending state across agent lifecycle and prompt responses", () => {
    const sent = apply(initialState, { kind: "submit" });
    expect(sent.sending).toBe(true);

    const accepted = apply(sent, records({ type: "agent_start" }, { type: "response", command: "prompt", success: true }));
    expect(accepted.busy).toBe(true);
    expect(accepted.sending).toBe(false);

    const settled = apply(accepted, records({ type: "agent_settled", aborted: false }));
    expect(settled.busy).toBe(false);
  });

  it("turns failed responses into notices", () => {
    const state = apply(initialState, records({ type: "response", command: "prompt", success: false, error: "model overloaded" }));

    expect(state.notices).toHaveLength(1);
    expect(state.notices[0]?.level).toBe("error");
    expect(state.notices[0]?.message).toContain("model overloaded");
  });

  it("appends history chunks and clears the loading flag on the last one", () => {
    const first = apply(initialState, {
      kind: "inbound",
      message: {
        type: "history",
        final: false,
        messages: [
          { role: "user", content: "hi", timestamp: 10 },
          { role: "assistant", content: [{ type: "text", text: "hello" }], timestamp: 11 },
        ],
      },
    });
    expect(first.historyLoading).toBe(true);
    expect(first.messages).toHaveLength(2);

    const second = apply(first, {
      kind: "inbound",
      message: { type: "history", final: true, messages: [{ role: "user", content: "again", timestamp: 12 }] },
    });
    expect(second.historyLoading).toBe(false);
    expect(second.messages).toHaveLength(3);
    expect(second.messages[0]?.blocks).toEqual([{ kind: "text", text: "hi" }]);
  });

  it("drops duplicate messages replayed by history and live events", () => {
    const message: WireMessage = { role: "user", content: "hi", timestamp: 10 };
    const state = apply(
      initialState,
      { kind: "inbound", message: { type: "history", final: true, messages: [message] } },
      records({ type: "message_start", message }, { type: "message_end", message }),
    );

    expect(state.messages).toHaveLength(1);
  });

  it("keeps thinking blocks separate from answer text", () => {
    const state = apply(
      initialState,
      records(
        assistantStart(),
        update({ type: "thinking_start", contentIndex: 0 }),
        update({ type: "thinking_delta", contentIndex: 0, delta: "pondering" }),
        update({ type: "text_start", contentIndex: 1 }),
        update({ type: "text_delta", contentIndex: 1, delta: "answer" }),
      ),
    );

    expect(state.messages[0]?.blocks).toEqual([
      { kind: "thinking", text: "pondering" },
      { kind: "text", text: "answer" },
    ]);
  });

  it("keeps tool details and the full-output path from the result", () => {
    const state = apply(
      initialState,
      records({
        type: "tool_execution_end",
        toolCallId: "call-bash",
        toolName: "bash",
        result: {
          content: [{ type: "text", text: "tail of output" }],
          details: { fullOutputPath: "/tmp/out.log", truncation: { truncated: true } },
        },
        isError: false,
      }),
    );

    expect(state.tools["call-bash"]?.output).toBe("tail of output");
    expect(state.tools["call-bash"]?.fullOutputPath).toBe("/tmp/out.log");
    expect(state.tools["call-bash"]?.details).toMatchObject({ truncation: { truncated: true } });
  });

  it("remembers parentToolCallId for nested calls", () => {
    const state = apply(
      initialState,
      records(
        {
          type: "tool_execution_start",
          toolCallId: "parent",
          toolName: "task",
          args: { goal: "x" },
        },
        {
          type: "tool_execution_start",
          toolCallId: "parent/1",
          toolName: "read",
          args: { path: "a.ts" },
          parentToolCallId: "parent",
        },
      ),
    );

    expect(state.tools["parent/1"]?.parentCallId).toBe("parent");
  });

  it("appends bash_execution_update deltas to the matching card", () => {
    const started = apply(
      initialState,
      records({ type: "tool_execution_start", toolCallId: "req-7", toolName: "bash", args: { command: "ls" } }),
    );
    const appended = apply(
      started,
      records(
        { type: "bash_execution_update", id: "req-7", delta: "one\n" },
        { type: "bash_execution_update", id: "req-7", delta: "two\n" },
      ),
    );

    expect(appended.tools["req-7"]?.output).toBe("one\ntwo\n");
  });

  it("honours an extension-provided hidden thinking label", () => {
    const labelled = apply(
      initialState,
      records({ type: "extension_ui_request", method: "setHiddenThinkingLabel", label: "reasoning" }),
    );
    expect(labelled.thinkingLabel).toBe("reasoning");

    const cleared = apply(
      labelled,
      records({ type: "extension_ui_request", method: "setHiddenThinkingLabel" }),
    );
    expect(cleared.thinkingLabel).toBeNull();
  });

  it("recovers tool arguments from assistant history blocks", () => {
    const state = apply(initialState, {
      kind: "inbound",
      message: {
        type: "history",
        final: true,
        messages: [
          {
            role: "assistant",
            timestamp: 20,
            stopReason: "toolUse",
            content: [
              { type: "toolCall", id: "call-h", name: "edit", arguments: { path: "src/h.ts", edits: [] } },
            ],
          },
          {
            role: "toolResult",
            toolCallId: "call-h",
            toolName: "edit",
            content: [{ type: "text", text: "edited" }],
            details: { diff: "+1 changed", firstChangedLine: 1 },
            timestamp: 21,
          },
        ],
      },
    });

    expect(state.tools["call-h"]?.args).toEqual({ path: "src/h.ts", edits: [] });
    expect(state.tools["call-h"]?.details).toEqual({ diff: "+1 changed", firstChangedLine: 1 });
    expect(state.tools["call-h"]?.status).toBe("done");
  });

  it("clears the transcript when the session changes", () => {
    const populated = apply(
      initialState,
      records(
        assistantStart(),
        { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "old" }], timestamp: 1 } },
        { type: "tool_execution_start", toolCallId: "c1", toolName: "read", args: {} },
        { type: "agent_start" },
      ),
    );
    expect(populated.messages).toHaveLength(1);
    expect(populated.busy).toBe(true);

    const state = apply(populated, { kind: "inbound", message: { type: "reset", reason: "switch" } });

    expect(state.messages).toEqual([]);
    expect(state.tools).toEqual({});
    expect(state.busy).toBe(false);
    expect(state.streamingMessageId).toBeNull();
    expect(state.historyLoading).toBe(true);
  });

  it("stores sessions, tree, models, thinking levels and commands", () => {
    const state = apply(
      initialState,
      {
        kind: "inbound",
        message: {
          type: "sessions",
          sessions: [{ path: "/p/a.jsonl", id: "a", messageCount: 1, modified: 1, current: true }],
        },
      },
      {
        kind: "inbound",
        message: {
          type: "session_tree",
          leafId: "e2",
          sessionId: "a",
          entries: [
            { id: "e1", type: "message", role: "user", text: "user: hi", depth: 0, forkable: true, active: true },
            { id: "e2", type: "message", role: "assistant", text: "assistant: hello", depth: 1, forkable: false, active: true },
          ],
        },
      },
      {
        kind: "inbound",
        message: {
          type: "models",
          currentProvider: "p",
          currentModel: "m1",
          models: [{ id: "m1", provider: "p", reasoning: true }],
        },
      },
      { kind: "inbound", message: { type: "thinking_levels", levels: ["off", "low"], current: "low" } },
      {
        kind: "inbound",
        message: { type: "commands", commands: [{ name: "review", description: "Review", source: "prompt" }] },
      },
    );

    expect(state.sessions).toHaveLength(1);
    expect(state.sessionsLoading).toBe(false);
    expect(state.tree.map((entry) => entry.id)).toEqual(["e1", "e2"]);
    expect(state.treeLeafId).toBe("e2");
    expect(state.models[0]?.id).toBe("m1");
    expect(state.thinkingLevels).toEqual(["off", "low"]);
    expect(state.commands[0]?.name).toBe("review");
  });

  it("reports compaction results as a notice", () => {
    const state = apply(initialState, records({
      type: "compaction_end",
      reason: "manual",
      aborted: false,
      willRetry: false,
      result: { summary: "s", firstKeptEntryId: "e1", tokensBefore: 150_000, estimatedTokensAfter: 32_000 },
    }));

    expect(state.notices[0]?.level).toBe("info");
    expect(state.notices[0]?.message).toContain("150k → 32k");
  });
});
