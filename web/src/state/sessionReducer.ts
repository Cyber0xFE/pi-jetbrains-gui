import { toolResultParts } from "../tools/result";
import type {
  AssistantDelta,
  Inbound,
  ModelInfo,
  NoticeLevel,
  SessionSummary,
  SlashCommand,
  TreeEntry,
  WireContent,
  WireImageContent,
  WireMessage,
  WireRecord,
  WireStatus,
  WireTextContent,
  WireThinkingContent,
  WireToolCallContent,
} from "../types";

export interface TextBlock {
  kind: "text";
  text: string;
}

export interface ThinkingBlock {
  kind: "thinking";
  text: string;
  redacted?: boolean;
}

export interface ToolBlock {
  kind: "tool";
  callId: string;
  name: string;
}

export interface ImageBlock {
  kind: "image";
  data: string;
  mimeType: string;
}

export type Block = TextBlock | ThinkingBlock | ToolBlock | ImageBlock;

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  blocks: Block[];
  timestamp: number;
  streaming: boolean;
  stopReason?: string;
  errorMessage?: string;
  model?: string;
}

export type ToolStatus = "running" | "done" | "error";

export interface ToolState {
  callId: string;
  name: string;
  status: ToolStatus;
  args?: unknown;
  output?: string;
  /** Structured `result.details`; `edit` keeps its display diff here. */
  details?: Record<string, unknown>;
  /** `details.fullOutputPath` when the tool truncated its output (plan M2.7). */
  fullOutputPath?: string;
  /** Set for calls a tool made through `ctx.executeTool()` (plan M2.6). */
  parentCallId?: string;
  isError?: boolean;
  durationMs?: number;
}

export interface Notice {
  id: string;
  level: NoticeLevel;
  message: string;
}

export interface ChatState {
  messages: ChatMessage[];
  tools: Record<string, ToolState>;
  streamingMessageId: string | null;
  busy: boolean;
  sending: boolean;
  status: WireStatus;
  notices: Notice[];
  noticeSeq: number;
  historyLoading: boolean;
  /** `extension_ui_request` / `setHiddenThinkingLabel`; null means the default label. */
  thinkingLabel: string | null;
  /** Cache-read share of the latest assistant prompt (`CH` in the TUI footer). */
  cacheHitRate: number | null;
  /** `ctx.ui.setStatus()` texts, keyed by extension key. */
  extensionStatuses: Record<string, string>;
  /** M3: project sessions, session tree, model + thinking pickers and slash commands. */
  sessions: SessionSummary[];
  sessionsLoading: boolean;
  tree: TreeEntry[];
  treeLeafId: string | null;
  models: ModelInfo[];
  thinkingLevels: string[];
  commands: SlashCommand[];
}

export const initialState: ChatState = {
  messages: [],
  tools: {},
  streamingMessageId: null,
  busy: false,
  sending: false,
  status: { phase: "stopped", message: "not started" },
  notices: [],
  noticeSeq: 0,
  historyLoading: true,
  thinkingLabel: null,
  cacheHitRate: null,
  extensionStatuses: {},
  sessions: [],
  sessionsLoading: true,
  tree: [],
  treeLeafId: null,
  models: [],
  thinkingLevels: [],
  commands: [],
};

export type Action =
  | { kind: "submit" }
  | { kind: "inbound"; message: Inbound }
  | { kind: "dismissNotice"; id: string };

/**
 * Single source of truth for the transcript.
 *
 * `message_update` deltas only carry `contentIndex` + `delta` (pi strips the cumulative snapshot),
 * so blocks are rebuilt by index here, and `message_end` overwrites the whole message with the
 * authoritative payload (plan 5.4).
 */
export function reduce(state: ChatState, action: Action): ChatState {
  switch (action.kind) {
    case "submit":
      return { ...state, sending: true };
    case "dismissNotice":
      return { ...state, notices: state.notices.filter((notice) => notice.id !== action.id) };
    case "inbound":
      return applyInbound(state, action.message);
  }
}

function applyInbound(state: ChatState, message: Inbound): ChatState {
  switch (message.type) {
    case "status":
      return { ...state, status: message.status };
    case "records":
      return message.records.reduce(applyRecord, state);
    case "history":
      return applyHistory(state, message.messages, message.final);
    case "notice":
      return withNotice(state, message.level, message.message);
    case "sessions":
      return { ...state, sessions: message.sessions, sessionsLoading: false };
    case "session_tree":
      return { ...state, tree: message.entries, treeLeafId: message.leafId };
    case "models":
      return { ...state, models: message.models };
    case "thinking_levels":
      return { ...state, thinkingLevels: message.levels };
    case "commands":
      return { ...state, commands: message.commands };
    case "reset":
      return resetTranscript(state);
    case "prefill":
      // The composer lives in App state, not the transcript reducer.
      return state;
  }
}

/** A session switch started: drop everything that belonged to the previous transcript. */
function resetTranscript(state: ChatState): ChatState {
  return {
    ...state,
    messages: [],
    tools: {},
    streamingMessageId: null,
    busy: false,
    sending: false,
    historyLoading: true,
    cacheHitRate: null,
  };
}

function applyRecord(state: ChatState, record: WireRecord): ChatState {
  switch (record.type) {
    case "message_start":
      return onMessageStart(state, record.message);
    case "message_update":
      return onMessageUpdate(state, record.assistantMessageEvent);
    case "message_end":
      return onMessageEnd(state, record.message);
    case "tool_execution_start":
      return onToolStart(state, record);
    case "tool_execution_update":
      return onToolUpdate(state, record);
    case "tool_execution_end":
      return onToolEnd(state, record);
    case "bash_execution_update":
      return onBashUpdate(state, record);
    case "extension_ui_request":
      return onExtensionUiRequest(state, record);
    case "agent_start":
      return { ...state, busy: true, sending: false };
    case "agent_settled":
      return { ...state, busy: false, sending: false, streamingMessageId: null };
    case "compaction_end":
      return onCompactionEnd(state, record);
    case "response":
      return onResponse(state, record);
    default:
      return state;
  }
}

function onMessageStart(state: ChatState, message: WireMessage | undefined): ChatState {
  if (!message) return state;
  if (message.role === "toolResult") return attachToolResult(state, message);

  const id = messageId(message);
  if (state.messages.some((existing) => existing.id === id)) return state;

  const role = toRole(message.role);
  const entry: ChatMessage = {
    id,
    role,
    blocks: blocksFromMessage(message),
    timestamp: message.timestamp ?? Date.now(),
    streaming: role === "assistant",
    stopReason: message.stopReason,
    errorMessage: message.errorMessage,
    model: message.model,
  };
  return {
    ...state,
    messages: [...state.messages, entry],
    streamingMessageId: role === "assistant" ? id : state.streamingMessageId,
  };
}

function onMessageUpdate(state: ChatState, delta: AssistantDelta | undefined): ChatState {
  if (!delta) return state;

  let base = state;
  if (!base.streamingMessageId) {
    // A delta may arrive before `message_start` (plan 9.2); create the message it belongs to.
    const syntheticId = `assistant:stream:${Date.now()}`;
    base = {
      ...base,
      messages: [
        ...base.messages,
        { id: syntheticId, role: "assistant", blocks: [], timestamp: Date.now(), streaming: true },
      ],
      streamingMessageId: syntheticId,
    };
  }

  const streamingId = base.streamingMessageId as string;
  let tools = base.tools;
  if (delta.type === "toolcall_end" && delta.toolCall) {
    const call = delta.toolCall;
    const previous = tools[call.id];
    tools = {
      ...tools,
      [call.id]: {
        ...(previous ?? { callId: call.id, name: call.name, status: "running" as ToolStatus }),
        name: call.name,
        args: call.arguments ?? previous?.args,
      },
    };
  }

  return {
    ...base,
    tools,
    messages: base.messages.map((message) => (message.id === streamingId ? patchBlocks(message, delta) : message)),
  };
}

function patchBlocks(message: ChatMessage, delta: AssistantDelta): ChatMessage {
  const index = delta.contentIndex ?? message.blocks.length;
  const blocks = message.blocks.slice();

  const ensure = (kind: "text" | "thinking"): void => {
    const current = blocks[index];
    if (!current || current.kind !== kind) {
      blocks[index] = kind === "text" ? { kind: "text", text: "" } : { kind: "thinking", text: "" };
    }
  };

  switch (delta.type) {
    case "text_start":
      blocks[index] = { kind: "text", text: "" };
      break;
    case "text_delta": {
      ensure("text");
      const block = blocks[index] as TextBlock;
      blocks[index] = { kind: "text", text: block.text + (delta.delta ?? "") };
      break;
    }
    case "text_end":
      if (delta.content !== undefined) blocks[index] = { kind: "text", text: delta.content };
      break;
    case "thinking_start":
      blocks[index] = { kind: "thinking", text: "" };
      break;
    case "thinking_delta": {
      ensure("thinking");
      const block = blocks[index] as ThinkingBlock;
      blocks[index] = { kind: "thinking", text: block.text + (delta.delta ?? "") };
      break;
    }
    case "thinking_end":
      if (delta.content !== undefined) blocks[index] = { kind: "thinking", text: delta.content };
      break;
    case "toolcall_start":
      blocks[index] = { kind: "tool", callId: delta.id ?? "", name: delta.toolName ?? "tool" };
      break;
    case "toolcall_end":
      if (delta.toolCall) blocks[index] = { kind: "tool", callId: delta.toolCall.id, name: delta.toolCall.name };
      break;
    case "done":
      return { ...message, blocks, stopReason: delta.reason ?? message.stopReason };
    case "error":
      return { ...message, blocks, stopReason: "error", errorMessage: describeError(delta.error) };
    default:
      return message;
  }
  return { ...message, blocks };
}

function onMessageEnd(state: ChatState, message: WireMessage | undefined): ChatState {
  if (!message) return state;
  if (message.role === "toolResult") return attachToolResult(state, message);

  const id = messageId(message);
  const existing = state.messages.find((candidate) => candidate.id === id) ?? findStreaming(state);
  const role = toRole(message.role);
  const rebuilt: ChatMessage = {
    id: existing?.id ?? id,
    role,
    blocks: blocksFromMessage(message),
    timestamp: message.timestamp ?? existing?.timestamp ?? Date.now(),
    streaming: false,
    stopReason: message.stopReason,
    errorMessage: message.errorMessage,
    model: message.model,
  };

  const messages = existing
    ? state.messages.map((candidate) => (candidate.id === existing.id ? rebuilt : candidate))
    : [...state.messages, rebuilt];

  return withCacheHitRate(
    seedToolCalls(
      {
        ...state,
        messages,
        streamingMessageId: state.streamingMessageId === rebuilt.id ? null : state.streamingMessageId,
      },
      message,
      "running",
    ),
    message,
  );
}

/**
 * History only replays `toolCall` content blocks, not `tool_execution_start`, so the card's
 * arguments are recovered from the assistant message itself. Without this, a reopened transcript
 * would render every `read`/`edit`/`bash` card without its path, command or diff preview.
 */
function seedToolCalls(state: ChatState, message: WireMessage, fallbackStatus: ToolStatus): ChatState {
  if (message.role !== "assistant" || !Array.isArray(message.content)) return state;
  let tools = state.tools;
  for (const content of message.content) {
    if (content.type !== "toolCall") continue;
    const call = content as WireToolCallContent;
    if (typeof call.id !== "string" || call.id.length === 0) continue;
    const previous = tools[call.id];
    tools = {
      ...tools,
      [call.id]: {
        ...(previous ?? { callId: call.id, name: call.name, status: fallbackStatus }),
        name: call.name,
        args: call.arguments ?? previous?.args,
      },
    };
  }
  return tools === state.tools ? state : { ...state, tools };
}

function onToolStart(state: ChatState, record: WireRecord): ChatState {
  const callId = record.toolCallId;
  if (!callId) return state;
  return {
    ...state,
    tools: {
      ...state.tools,
      [callId]: {
        callId,
        name: record.toolName ?? "tool",
        status: "running",
        args: record.args,
        parentCallId: record.parentToolCallId,
      },
    },
  };
}

/** `tool_execution_update.partialResult` is a snapshot of the output so far, not a delta. */
function onToolUpdate(state: ChatState, record: WireRecord): ChatState {
  const callId = record.toolCallId;
  const previous = callId ? state.tools[callId] : undefined;
  if (!callId || !previous) return state;
  const parts = toolResultParts(record.partialResult);
  return {
    ...state,
    tools: {
      ...state.tools,
      [callId]: {
        ...previous,
        output: parts.text ?? previous.output,
        details: parts.details ?? previous.details,
        fullOutputPath: parts.fullOutputPath ?? previous.fullOutputPath,
      },
    },
  };
}

function onToolEnd(state: ChatState, record: WireRecord): ChatState {
  const callId = record.toolCallId;
  if (!callId) return state;
  const previous = state.tools[callId];
  const isError = record.isError === true;
  const parts = toolResultParts(record.result);
  return {
    ...state,
    tools: {
      ...state.tools,
      [callId]: {
        callId,
        name: record.toolName ?? previous?.name ?? "tool",
        status: isError ? "error" : "done",
        args: previous?.args,
        output: parts.text ?? previous?.output,
        details: parts.details ?? previous?.details,
        fullOutputPath: parts.fullOutputPath ?? previous?.fullOutputPath,
        parentCallId: record.parentToolCallId ?? previous?.parentCallId,
        isError,
        durationMs: typeof record.durationMs === "number" ? record.durationMs : previous?.durationMs,
      },
    },
  };
}

/**
 * `bash_execution_update` is emitted by `executeBash` (the `bash` command), keyed by request id,
 * and only carries deltas. Tool-issued `bash` calls stream through `tool_execution_update`
 * snapshots instead, so both paths end up on the same card shape.
 */
function onBashUpdate(state: ChatState, record: WireRecord): ChatState {
  const callId = record.id;
  const previous = callId ? state.tools[callId] : undefined;
  if (!callId || !previous || typeof record.delta !== "string") return state;
  return {
    ...state,
    tools: {
      ...state.tools,
      [callId]: { ...previous, output: (previous.output ?? "") + record.delta },
    },
  };
}

function onExtensionUiRequest(state: ChatState, record: WireRecord): ChatState {
  switch (record.method) {
    case "setHiddenThinkingLabel": {
      const label = typeof record.label === "string" && record.label.length > 0 ? record.label : null;
      return { ...state, thinkingLabel: label };
    }
    case "setStatus": {
      const key = typeof record.statusKey === "string" ? record.statusKey : undefined;
      if (key === undefined) return state;
      const text = typeof record.statusText === "string" ? record.statusText : undefined;
      const extensionStatuses = { ...state.extensionStatuses };
      if (text === undefined) delete extensionStatuses[key];
      else extensionStatuses[key] = text;
      return { ...state, extensionStatuses };
    }
    default:
      return state;
  }
}

/**
 * Mirrors the TUI's `latestCacheHitRate`: cache reads over the whole prompt of the most recent
 * assistant message (input + cacheRead + cacheWrite). Undefined until a message reports cache use.
 */
function withCacheHitRate(state: ChatState, message: WireMessage): ChatState {
  if (message.role !== "assistant") return state;
  const usage = message.usage;
  if (!usage) return state;
  const read = usage.cacheRead ?? 0;
  const write = usage.cacheWrite ?? 0;
  if (read <= 0 && write <= 0) return state;
  const prompt = (usage.input ?? 0) + read + write;
  if (prompt <= 0) return state;
  return { ...state, cacheHitRate: (read / prompt) * 100 };
}

function attachToolResult(state: ChatState, message: WireMessage): ChatState {
  const callId = message.toolCallId;
  if (!callId) return state;
  const previous = state.tools[callId];
  const parts = toolResultParts({ content: message.content, details: message.details });
  return {
    ...state,
    tools: {
      ...state.tools,
      [callId]: {
        callId,
        name: message.toolName ?? previous?.name ?? "tool",
        status: message.isError ? "error" : "done",
        args: previous?.args,
        output: parts.text ?? previous?.output,
        details: parts.details ?? previous?.details,
        fullOutputPath: parts.fullOutputPath ?? previous?.fullOutputPath,
        parentCallId: previous?.parentCallId,
        isError: message.isError,
        durationMs: message.durationMs ?? previous?.durationMs,
      },
    },
  };
}

/** `compaction_end` carries the token delta; surface it as a short notice (plan M3.6). */
function onCompactionEnd(state: ChatState, record: WireRecord): ChatState {
  if (record.aborted === true) {
    return withNotice(state, "error", "compaction was aborted");
  }
  const error = typeof record.errorMessage === "string" ? record.errorMessage : undefined;
  if (error) return withNotice(state, "error", `compaction failed: ${error}`);
  const result = record.result as Record<string, unknown> | undefined;
  const before = typeof result?.tokensBefore === "number" ? result.tokensBefore : undefined;
  const after = typeof result?.estimatedTokensAfter === "number" ? result.estimatedTokensAfter : undefined;
  const detail =
    before !== undefined && after !== undefined
      ? `${Math.round(before / 1000)}k → ${Math.round(after / 1000)}k tokens`
      : "context compacted";
  return withNotice(state, "info", detail);
}

function onResponse(state: ChatState, record: WireRecord): ChatState {
  const command = typeof record.command === "string" ? record.command : "";
  const cleared = command === "prompt" ? { ...state, sending: false } : state;

  if (record.success === false) {
    return withNotice(cleared, "error", `${command || "command"} failed: ${record.error ?? "unknown error"}`);
  }
  if (command === "abort") {
    return { ...cleared, busy: false, sending: false, streamingMessageId: null };
  }
  return cleared;
}

function applyHistory(state: ChatState, messages: WireMessage[], final: boolean): ChatState {
  let next = state;
  for (const message of messages) {
    if (message.role === "toolResult") {
      next = attachToolResult(next, message);
      continue;
    }
    const id = messageId(message);
    if (next.messages.some((existing) => existing.id === id)) continue;
    next = {
      ...next,
      messages: [
        ...next.messages,
        {
          id,
          role: toRole(message.role),
          blocks: blocksFromMessage(message),
          timestamp: message.timestamp ?? Date.now(),
          streaming: false,
          stopReason: message.stopReason,
          errorMessage: message.errorMessage,
          model: message.model,
        },
      ],
    };
    next = seedToolCalls(next, message, "done");
    next = withCacheHitRate(next, message);
  }
  return { ...next, historyLoading: !final };
}

function withNotice(state: ChatState, level: NoticeLevel, message: string): ChatState {
  const seq = state.noticeSeq + 1;
  return {
    ...state,
    noticeSeq: seq,
    notices: [...state.notices, { id: `notice-${seq}`, level, message }].slice(-3),
  };
}

function findStreaming(state: ChatState): ChatMessage | undefined {
  if (!state.streamingMessageId) return undefined;
  return state.messages.find((message) => message.id === state.streamingMessageId);
}

function messageId(message: WireMessage): string {
  return `${message.role}:${message.timestamp ?? "unknown"}`;
}

function toRole(role: string): ChatMessage["role"] {
  if (role === "user") return "user";
  if (role === "assistant") return "assistant";
  return "system";
}

export function blocksFromMessage(message: WireMessage): Block[] {
  const content = message.content;
  if (content === undefined) return [];
  if (typeof content === "string") return content.length > 0 ? [{ kind: "text", text: content }] : [];
  return content.map(blockFromContent).filter((block): block is Block => block !== null);
}

function blockFromContent(content: WireContent): Block | null {
  switch (content.type) {
    case "text":
      return { kind: "text", text: (content as WireTextContent).text ?? "" };
    case "thinking": {
      const thinking = content as WireThinkingContent;
      return { kind: "thinking", text: thinking.thinking ?? "", redacted: thinking.redacted };
    }
    case "toolCall": {
      const call = content as WireToolCallContent;
      return { kind: "tool", callId: call.id, name: call.name };
    }
    case "image": {
      const image = content as WireImageContent;
      return { kind: "image", data: image.data, mimeType: image.mimeType };
    }
    default:
      return null;
  }
}

function describeError(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const message = (error as Record<string, unknown>).message;
    if (typeof message === "string") return message;
  }
  return "unknown error";
}
