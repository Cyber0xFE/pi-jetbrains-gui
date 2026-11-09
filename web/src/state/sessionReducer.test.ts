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


/** `message_start` + `message_end` pair, the way pi replays a queued user prompt. */
function userMessage(text: string, timestamp: number, paired = false): WireRecord[] {
  const message: WireMessage = { role: "user", content: [{ type: "text", text }], timestamp };
  return paired
    ? [{ type: "message_start", message }, { type: "message_end", message }]
    : [{ type: "message_start", message }];
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

  it("keeps image data rendered by message_start when message_end omits it", () => {
    const state = apply(
      initialState,
      records(
        {
          type: "message_start",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "screenshot" }, { type: "image", data: "QUJD", mimeType: "image/png" }],
            timestamp: 1,
          },
        },
        {
          type: "message_end",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "screenshot" }, { type: "image", data: "", mimeType: "image/png" }],
            timestamp: 2,
            stopReason: "stop",
          },
        },
      ),
    );

    expect(state.messages[0]?.blocks[1]).toEqual({ kind: "image", data: "QUJD", mimeType: "image/png" });
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
      { kind: "thinking", text: "pondering", completed: true },
      { kind: "text", text: "answer" },
    ]);
  });

  it("removes literal thinking tags from thinking content", () => {
    const state = apply(
      initialState,
      records(
        assistantStart(),
        update({ type: "thinking_start", contentIndex: 0 }),
        update({ type: "thinking_delta", contentIndex: 0, delta: "<thinking>Building plugin</thinking>" }),
      ),
    );

    expect(state.messages[0]?.blocks).toEqual([{ kind: "thinking", text: "Building plugin" }]);
  });

  it("converts thinking tags embedded in text into a collapsed thinking block", () => {
    const state = apply(initialState, {
      kind: "inbound",
      message: {
        type: "history",
        final: true,
        messages: [
          {
            role: "assistant",
            timestamp: 2,
            content: [{ type: "text", text: "<thinking>Building plugin</thinking>\n\nDone" }],
          },
        ],
      },
    });

    expect(state.messages[0]?.blocks).toEqual([
      { kind: "thinking", text: "Building plugin", completed: true },
      { kind: "text", text: "\n\nDone" },
    ]);
  });

  it("keeps literal thinking tags quoted in inline code as plain text", () => {
    const state = apply(initialState, {
      kind: "inbound",
      message: {
        type: "history",
        final: true,
        messages: [
          {
            role: "assistant",
            timestamp: 2,
            content: [{ type: "text", text: "把 provider 输出的 `<thinking>` 标签文本拆成块。" }],
          },
        ],
      },
    });

    expect(state.messages[0]?.blocks).toEqual([
      { kind: "text", text: "把 provider 输出的 `<thinking>` 标签文本拆成块。" },
    ]);
  });

  it("keeps literal thinking tags inside fenced code as plain text", () => {
    const state = apply(initialState, {
      kind: "inbound",
      message: {
        type: "history",
        final: true,
        messages: [
          {
            role: "assistant",
            timestamp: 2,
            content: [{ type: "text", text: "Example:\n\n```xml\n<thinking>reasoning</thinking>\n```\n\nDone" }],
          },
        ],
      },
    });

    expect(state.messages[0]?.blocks).toEqual([
      { kind: "text", text: "Example:\n\n```xml\n<thinking>reasoning</thinking>\n```\n\nDone" },
    ]);
  });

  it("still splits real thinking tags when quoted tags appear later in the answer", () => {
    const state = apply(initialState, {
      kind: "inbound",
      message: {
        type: "history",
        final: true,
        messages: [
          {
            role: "assistant",
            timestamp: 2,
            content: [{ type: "text", text: "<thinking>Reasoning</thinking>\n\nAnswer with `<thinking>` quote." }],
          },
        ],
      },
    });

    expect(state.messages[0]?.blocks).toEqual([
      { kind: "thinking", text: "Reasoning", completed: true },
      { kind: "text", text: "\n\nAnswer with `<thinking>` quote." },
    ]);
  });

  it("preserves thinking tags quoted in inline code within thinking content", () => {
    const state = apply(
      initialState,
      records(
        assistantStart(),
        update({ type: "thinking_start", contentIndex: 0 }),
        update({ type: "thinking_delta", contentIndex: 0, delta: "Use `<thinking>` wrapper" }),
      ),
    );

    expect(state.messages[0]?.blocks).toEqual([{ kind: "thinking", text: "Use `<thinking>` wrapper" }]);
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
    expect(state.transcriptGeneration).toBe(populated.transcriptGeneration + 1);
    const resetAgain = apply(state, { kind: "inbound", message: { type: "reset", reason: "switch" } });
    expect(resetAgain.transcriptGeneration).toBe(state.transcriptGeneration + 1);
  });

  it("tracks queued steering and follow-up messages from queue_update", () => {
    let state = apply(
      initialState,
      records({ type: "queue_update", steering: ["first look at the tests"], followUp: [] }),
    );
    expect(state.steeringQueue).toEqual(["first look at the tests"]);
    expect(state.followUpQueue).toEqual([]);

    state = apply(
      state,
      records({ type: "queue_update", steering: [], followUp: ["run the full suite"] }),
    );
    expect(state.steeringQueue).toEqual([]);
    expect(state.followUpQueue).toEqual(["run the full suite"]);

    state = apply(
      state,
      records({ type: "queue_update", steering: ["a", "b"], followUp: ["c"] }),
    );
    expect(state.steeringQueue).toEqual(["a", "b"]);
    expect(state.followUpQueue).toEqual(["c"]);
  });

  it("keeps the previous queues when queue_update omits a field", () => {
    const state = apply(
      initialState,
      records({ type: "queue_update", steering: ["kept"], followUp: [] }),
      records({ type: "queue_update" }),
    );
    expect(state.steeringQueue).toEqual(["kept"]);
    expect(state.followUpQueue).toEqual([]);
  });

  it("clears queued steering and follow-up messages when the session changes", () => {
    const populated = apply(
      initialState,
      records({ type: "queue_update", steering: ["old"], followUp: ["old too"] }),
    );

    const state = apply(populated, { kind: "inbound", message: { type: "reset", reason: "switch" } });

    expect(state.steeringQueue).toEqual([]);
    expect(state.followUpQueue).toEqual([]);
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

  it("tracks /btw side questions without touching the transcript", () => {
    const asked = apply(
      initialState,
      records(assistantStart(), update({ type: "text_delta", contentIndex: 0, delta: "main" })),
      { kind: "btwSend", question: "what config file was that?" },
    );

    expect(asked.btw).toEqual({ question: "what config file was that?", answer: null, error: null, pending: true });
    expect(asked.messages).toHaveLength(1);
    expect(asked.sending).toBe(false);

    // Streaming deltas accumulate while pending stays true.
    const streaming = apply(asked, {
      kind: "inbound",
      message: { type: "btw", state: "delta", question: "what config file was that?", delta: "it is " },
    });
    expect(streaming.btw).toEqual({ question: "what config file was that?", answer: "it is ", error: null, pending: true });

    const answered = apply(streaming, {
      kind: "inbound",
      message: { type: "btw", state: "answer", question: "what config file was that?", answer: "**app.json**" },
    });
    expect(answered.btw).toEqual({ question: "what config file was that?", answer: "**app.json**", error: null, pending: false });
    expect(answered.messages).toEqual(asked.messages);
  });

  it("reports /btw errors and keeps the partial streamed answer visible", () => {
    const state = apply(
      initialState,
      { kind: "btwSend", question: "why?" },
      { kind: "inbound", message: { type: "btw", state: "delta", question: "why?", delta: "partial" } },
      { kind: "inbound", message: { type: "btw", state: "error", question: "why?", error: "quota exceeded" } },
    );

    expect(state.btw).toEqual({ question: "why?", answer: "partial", error: "quota exceeded", pending: false });
  });

  it("accepts /btw deltas for a question it did not seed locally", () => {
    const state = apply(
      initialState,
      { kind: "inbound", message: { type: "btw", state: "delta", question: "external", delta: "hi" } },
    );

    expect(state.btw).toEqual({ question: "external", answer: "hi", error: null, pending: true });
  });

  it("fills a missing /btw answer with null and keeps pending until the host replies", () => {
    const state = apply(
      initialState,
      { kind: "btwSend", question: "hm?" },
      { kind: "inbound", message: { type: "btw", state: "answer", question: "hm?" } },
    );

    expect(state.btw).toEqual({ question: "hm?", answer: null, error: null, pending: false });
  });

  it("keeps two user messages that share a timestamp but differ in content", () => {
    const shared = 1794208490561;
    const state = apply(
      initialState,
      records(
        ...userMessage("先不要总结 test1 目录", shared, true),
        ...userMessage("算了，只总结2个就行了", shared, true),
      ),
    );

    expect(state.messages.filter((message) => message.role === "user")).toHaveLength(2);
    expect(state.messages.map((message) => (message.blocks[0] as { text?: string }).text)).toEqual([
      "先不要总结 test1 目录",
      "算了，只总结2个就行了",
    ]);
  });

  it("keeps equal-timestamp user messages replayed by history", () => {
    const shared = 1794208490561;
    const state = apply(
      initialState,
      {
        kind: "inbound",
        message: {
          type: "history",
          final: true,
          messages: [
            { role: "user", content: [{ type: "text", text: "first" }], timestamp: shared },
            { role: "user", content: [{ type: "text", text: "second" }], timestamp: shared },
          ],
        },
      },
    );

    expect(state.messages.map((message) => (message.blocks[0] as { text?: string }).text)).toEqual([
      "first",
      "second",
    ]);
  });

  it("does not replace the streaming assistant with an unmatched user message_end", () => {
    const state = apply(
      initialState,
      records(
        assistantStart(11),
        update({ type: "text_start", contentIndex: 0 }),
        update({ type: "text_delta", contentIndex: 0, delta: "partial answer" }),
        { type: "message_end", message: { role: "user", content: [{ type: "text", text: "steer" }], timestamp: 12 } },
      ),
    );

    const assistant = state.messages.find((message) => message.role === "assistant");
    expect(assistant?.blocks).toEqual([{ kind: "text", text: "partial answer" }]);
    expect(state.messages.filter((message) => message.role === "user")).toHaveLength(1);
  });
});
