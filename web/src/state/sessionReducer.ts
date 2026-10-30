import type {
  AssistantDelta,
  Inbound,
  NoticeLevel,
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
  }
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
    case "agent_start":
      return { ...state, busy: true, sending: false };
    case "agent_settled":
      return { ...state, busy: false, sending: false, streamingMessageId: null };
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
        callId: call.id,
        name: call.name,
        status: previous?.status ?? "running",
        args: call.arguments ?? previous?.args,
        output: previous?.output,
        isError: previous?.isError,
        durationMs: previous?.durationMs,
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

  return {
    ...state,
    messages,
    streamingMessageId: state.streamingMessageId === rebuilt.id ? null : state.streamingMessageId,
  };
}

function onToolStart(state: ChatState, record: WireRecord): ChatState {
  const callId = record.toolCallId;
  if (!callId) return state;
  return {
    ...state,
    tools: {
      ...state.tools,
      [callId]: { callId, name: record.toolName ?? "tool", status: "running", args: record.args },
    },
  };
}

function onToolUpdate(state: ChatState, record: WireRecord): ChatState {
  const callId = record.toolCallId;
  const previous = callId ? state.tools[callId] : undefined;
  if (!callId || !previous) return state;
  const output = textOf(record.partialResult);
  if (!output) return state;
  return { ...state, tools: { ...state.tools, [callId]: { ...previous, output } } };
}

function onToolEnd(state: ChatState, record: WireRecord): ChatState {
  const callId = record.toolCallId;
  if (!callId) return state;
  const previous = state.tools[callId];
  const isError = record.isError === true;
  return {
    ...state,
    tools: {
      ...state.tools,
      [callId]: {
        callId,
        name: record.toolName ?? previous?.name ?? "tool",
        status: isError ? "error" : "done",
        args: previous?.args,
        output: textOf(record.result) ?? previous?.output,
        isError,
        durationMs: typeof record.durationMs === "number" ? record.durationMs : previous?.durationMs,
      },
    },
  };
}

function attachToolResult(state: ChatState, message: WireMessage): ChatState {
  const callId = message.toolCallId;
  if (!callId) return state;
  const previous = state.tools[callId];
  return {
    ...state,
    tools: {
      ...state.tools,
      [callId]: {
        callId,
        name: message.toolName ?? previous?.name ?? "tool",
        status: message.isError ? "error" : "done",
        args: previous?.args,
        output: textOf(message.content) ?? previous?.output,
        isError: message.isError,
        durationMs: message.durationMs ?? previous?.durationMs,
      },
    },
  };
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

/** Best-effort text extraction from the loosely typed tool payloads (plan 7.6). */
export function textOf(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return value.length > 0 ? value : undefined;
  if (Array.isArray(value)) {
    const parts = value.map(textOf).filter((part): part is string => Boolean(part));
    return parts.length > 0 ? parts.join("\n") : undefined;
  }
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    if (typeof object.output === "string") return object.output;
    if (Array.isArray(object.content)) {
      const nested = textOf(object.content);
      if (nested) return nested;
    }
    if (typeof object.text === "string") return object.text;
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return undefined;
    }
  }
  return String(value);
}

function describeError(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const message = (error as Record<string, unknown>).message;
    if (typeof message === "string") return message;
  }
  return "unknown error";
}
