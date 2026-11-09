import { toolResultParts, truncateToolValue } from "../tools/result";
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
  WireTheme,
} from "../types";

export interface TextBlock {
  kind: "text";
  text: string;
}

export interface ThinkingBlock {
  kind: "thinking";
  text: string;
  redacted?: boolean;
  /** Set when the provider has finished emitting this reasoning block. */
  completed?: boolean;
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
  durationMs?: number;
  /** Local start time used when the provider does not include a response duration. */
  startedAtMs?: number;
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
  /** The host replaced an oversized result with a summary to keep JCEF responsive. */
  outputTruncated?: boolean;
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

/** One `/btw` side question; never enters the main transcript. */
export interface BtwState {
  question: string;
  answer: string | null;
  error: string | null;
  pending: boolean;
}

export interface ChatState {
  messages: ChatMessage[];
  tools: Record<string, ToolState>;
  streamingMessageId: string | null;
  busy: boolean;
  sending: boolean;
  status: WireStatus;
  theme: WireTheme | null;
  notices: Notice[];
  noticeSeq: number;
  historyLoading: boolean;
  /** Changes on reset even when reset and history arrive in the same render batch. */
  transcriptGeneration: number;
  /** `extension_ui_request` / `setHiddenThinkingLabel`; null means the default label. */
  thinkingLabel: string | null;
  /** Cache-read share of the latest assistant prompt (`CH` in the TUI footer). */
  cacheHitRate: number | null;
  /** `ctx.ui.setStatus()` texts, keyed by extension key. */
  extensionStatuses: Record<string, string>;
  widgets: Record<string, { lines: string[]; placement: "aboveEditor" | "belowEditor" }>;
  /** M3: project sessions, session tree, model + thinking pickers and slash commands. */
  sessions: SessionSummary[];
  sessionsLoading: boolean;
  tree: TreeEntry[];
  treeLeafId: string | null;
  models: ModelInfo[];
  defaultModelProvider: string | null;
  defaultModel: string | null;
  thinkingLevels: string[];
  commands: SlashCommand[];
  files: string[];
  /** Most recent `/btw` side question; null until one is asked. */
  btw: BtwState | null;
  /** Pending steering messages from `queue_update` (pi delivers them mid-run). */
  steeringQueue: string[];
  /** Pending follow-up messages from `queue_update` (pi delivers them after the run). */
  followUpQueue: string[];
}

export const initialState: ChatState = {
  messages: [],
  tools: {},
  streamingMessageId: null,
  busy: false,
  sending: false,
  status: { phase: "stopped", message: "not started" },
  theme: null,
  notices: [],
  noticeSeq: 0,
  historyLoading: true,
  transcriptGeneration: 0,
  thinkingLabel: null,
  cacheHitRate: null,
  extensionStatuses: {},
  widgets: {},
  sessions: [],
  sessionsLoading: true,
  tree: [],
  treeLeafId: null,
  models: [],
  defaultModelProvider: null,
  defaultModel: null,
  thinkingLevels: [],
  commands: [],
  files: [],
  btw: null,
  steeringQueue: [],
  followUpQueue: [],
};

export type Action =
  | { kind: "submit" }
  | { kind: "inbound"; message: Inbound }
  | { kind: "btwSend"; question: string }
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
    case "btwSend":
      // Optimistic pending state while the host runs the print-mode side question.
      return { ...state, btw: { question: action.question, answer: null, error: null, pending: true } };
    case "dismissNotice":
      return { ...state, notices: state.notices.filter((notice) => notice.id !== action.id) };
    case "inbound":
      return applyInbound(state, action.message);
  }
}

function applyInbound(state: ChatState, message: Inbound): ChatState {
  switch (message.type) {
    case "theme":
      return { ...state, theme: message.theme };
    case "status":
      return { ...state, status: message.status };
    case "records":
      return applyRecords(state, message.records);
    case "history":
      return applyHistory(state, message.messages, message.final);
    case "notice":
      return withNotice(state, message.level, message.message);
    case "sessions":
      return { ...state, sessions: message.sessions, sessionsLoading: false };
    case "session_tree":
      return { ...state, tree: message.entries, treeLeafId: message.leafId };
    case "models":
      return {
        ...state,
        models: message.models,
        defaultModelProvider: message.defaultProvider ?? null,
        defaultModel: message.defaultModel ?? null,
      };
    case "thinking_levels":
      return { ...state, thinkingLevels: message.levels };
    case "commands":
      return { ...state, commands: message.commands };
    case "files":
      return { ...state, files: message.files };
    case "btw":
      if (message.state === "delta") {
        const current = state.btw;
        if (current?.question !== message.question) {
          // Deltas for a question we did not seed locally (host restarted, etc.): start fresh.
          return { ...state, btw: { question: message.question, answer: message.delta ?? "", error: null, pending: true } };
        }
        return {
          ...state,
          btw: { question: message.question, answer: (current.answer ?? "") + (message.delta ?? ""), error: null, pending: true },
        };
      }
      if (message.state === "answer") {
        return {
          ...state,
          btw: { question: message.question, answer: message.answer ?? null, error: null, pending: false },
        };
      }
      return {
        ...state,
        btw: {
          question: message.question,
          answer: state.btw?.question === message.question ? state.btw.answer : null,
          error: message.error ?? "/btw failed",
          pending: false,
        },
      };
    case "reset":
      return resetTranscript(state);
    case "prefill":
    case "dequeue":
      // The composer lives in App state, not the transcript reducer.
      return state;
    case "focus_composer":
      return state;
    case "scroll_to_latest":
      return state;
    case "scroll_to_first":
      return state;
    case "scroll_to_user_message":
      return state;
    case "extension_status": {
      const extensionStatuses = { ...state.extensionStatuses };
      if (message.text == null || message.text.trim().length === 0) delete extensionStatuses[message.key];
      else extensionStatuses[message.key] = message.text;
      return { ...state, extensionStatuses };
    }
    case "widget": {
      const widgets = { ...state.widgets };
      if (message.lines.length === 0) delete widgets[message.key];
      else widgets[message.key] = { lines: message.lines, placement: message.placement };
      return { ...state, widgets };
    }
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
    transcriptGeneration: state.transcriptGeneration + 1,
    cacheHitRate: null,
    steeringQueue: [],
    followUpQueue: [],
  };
}

function applyRecord(state: ChatState, record: WireRecord): ChatState {
  switch (record.type) {
    case "message_start":
      return onMessageStart(state, record.message);
    case "message_update":
      return onMessageUpdate(state, record.assistantMessageEvent);
    case "message_end":
      return onMessageEnd(state, record.message, record.durationMs);
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
    case "queue_update":
      return onQueueUpdate(state, record);
    case "response":
      return onResponse(state, record);
    default:
      return state;
  }
}

/** Apply consecutive stream deltas with one messages-array copy per inbound batch. */
function applyRecords(state: ChatState, records: WireRecord[]): ChatState {
  let next = state;
  let deltas: AssistantDelta[] = [];
  const flushDeltas = (): void => {
    if (deltas.length === 0) return;
    next = applyMessageUpdates(next, deltas);
    deltas = [];
  };

  for (const record of records) {
    if (record.type === "message_update" && record.assistantMessageEvent) {
      deltas.push(record.assistantMessageEvent);
      continue;
    }
    flushDeltas();
    next = applyRecord(next, record);
  }
  flushDeltas();
  return next;
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
    durationMs: message.durationMs,
    startedAtMs: Date.now(),
  };
  return {
    ...state,
    messages: [...state.messages, entry],
    streamingMessageId: role === "assistant" ? id : state.streamingMessageId,
  };
}

function onMessageUpdate(state: ChatState, delta: AssistantDelta | undefined): ChatState {
  return delta ? applyMessageUpdates(state, [delta]) : state;
}

function applyMessageUpdates(state: ChatState, deltas: AssistantDelta[]): ChatState {
  if (deltas.length === 0) return state;

  let base = state;
  if (!base.streamingMessageId) {
    // A delta may arrive before `message_start` (plan 9.2); create the message it belongs to.
    const syntheticId = `assistant:stream:${Date.now()}`;
    base = {
      ...base,
      messages: [
        ...base.messages,
        {
          id: syntheticId,
          role: "assistant",
          blocks: [],
          timestamp: Date.now(),
          streaming: true,
          startedAtMs: Date.now(),
        },
      ],
      streamingMessageId: syntheticId,
    };
  }

  const streamingId = base.streamingMessageId as string;
  let tools = base.tools;
  let message = base.messages.find((candidate) => candidate.id === streamingId);
  if (!message) return base;
  for (const delta of deltas) {
    if (delta.type === "toolcall_end" && delta.toolCall) {
      const call = delta.toolCall;
      const previous = tools[call.id];
      tools = {
        ...tools,
        [call.id]: {
          ...(previous ?? { callId: call.id, name: call.name, status: "running" as ToolStatus }),
          name: call.name,
          args: call.arguments === undefined ? previous?.args : truncateToolValue(call.arguments),
        },
      };
    }
    message = patchBlocks(message, delta);
  }

  const messageIndex = base.messages.findIndex((candidate) => candidate.id === streamingId);
  if (messageIndex < 0) return base;
  const messages = base.messages.slice();
  messages[messageIndex] = message;

  return {
    ...base,
    tools,
    messages,
  };
}

function patchBlocks(message: ChatMessage, delta: AssistantDelta): ChatMessage {
  const index = delta.contentIndex ?? message.blocks.length;
  const blocks = message.blocks.slice();

  // Some providers switch straight to answer/tool output without a thinking_end event.
  if (delta.type.startsWith("text_") || delta.type.startsWith("toolcall_")) {
    for (let previous = 0; previous < index; previous += 1) {
      const block = blocks[previous];
      if (block?.kind === "thinking" && !block.completed) {
        blocks[previous] = { ...block, completed: true };
      }
    }
  }

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
      blocks[index] = { kind: "thinking", text: stripThinkingTags(block.text + (delta.delta ?? "")) };
      break;
    }
    case "thinking_end":
      if (delta.content !== undefined) {
        blocks[index] = { kind: "thinking", text: stripThinkingTags(delta.content), completed: true };
      } else if (blocks[index]?.kind === "thinking") {
        blocks[index] = { ...blocks[index], completed: true };
      }
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

function onMessageEnd(state: ChatState, message: WireMessage | undefined, recordDurationMs?: number): ChatState {
  if (!message) return state;
  if (message.role === "toolResult") return attachToolResult(state, message);

  const id = messageId(message);
  // The streaming fallback only belongs to assistant messages: a user `message_end` without a
  // matching `message_start` must not overwrite the reply that is still streaming.
  const existing = state.messages.find((candidate) => candidate.id === id)
    ?? (message.role === "assistant" ? findStreaming(state) : undefined);
  const role = toRole(message.role);
  const rebuilt: ChatMessage = {
    id: existing?.id ?? id,
    role,
    blocks: withImageData(blocksFromMessage(message), existing),
    timestamp: message.timestamp ?? existing?.timestamp ?? Date.now(),
    streaming: false,
    stopReason: message.stopReason,
    errorMessage: message.errorMessage,
    model: message.model,
    durationMs: message.durationMs
      ?? (typeof recordDurationMs === "number" ? recordDurationMs : undefined)
      ?? existing?.durationMs
      ?? (existing?.startedAtMs === undefined ? undefined : Math.max(0, Date.now() - existing.startedAtMs)),
    startedAtMs: existing?.startedAtMs,
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
        args: call.arguments === undefined ? previous?.args : truncateToolValue(call.arguments),
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
        args: truncateToolValue(record.args),
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
        outputTruncated: parts.outputTruncated ?? previous.outputTruncated,
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
        outputTruncated: parts.outputTruncated ?? previous?.outputTruncated,
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
    case "setWidget": {
      const key = typeof record.widgetKey === "string" ? record.widgetKey : undefined;
      if (key === undefined) return state;
      const rawLines = record.widgetLines;
      const lines = Array.isArray(rawLines) ? rawLines.filter((line): line is string => typeof line === "string") : [];
      const widgets = { ...state.widgets };
      if (lines.length === 0) delete widgets[key];
      else widgets[key] = {
        lines,
        placement: record.widgetPlacement === "belowEditor" ? "belowEditor" : "aboveEditor",
      };
      return { ...state, widgets };
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
        outputTruncated: parts.outputTruncated ?? previous?.outputTruncated,
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

/** `queue_update` replaces both pending queues; missing fields keep the previous ones. */
function onQueueUpdate(state: ChatState, record: WireRecord): ChatState {
  const steering = toStringArray(record.steering) ?? state.steeringQueue;
  const followUp = toStringArray(record.followUp) ?? state.followUpQueue;
  if (steering === state.steeringQueue && followUp === state.followUpQueue) return state;
  return { ...state, steeringQueue: steering, followUpQueue: followUp };
}

function toStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter((item): item is string => typeof item === "string");
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
  const existingIds = new Set(state.messages.map((message) => message.id));
  const appended: ChatMessage[] = [];
  for (const message of messages) {
    if (message.role === "toolResult") {
      next = attachToolResult(next, message);
      continue;
    }
    const id = messageId(message);
    if (existingIds.has(id)) continue;
    existingIds.add(id);
    appended.push({
      id,
      role: toRole(message.role),
      blocks: blocksFromMessage(message),
      timestamp: message.timestamp ?? Date.now(),
      streaming: false,
      stopReason: message.stopReason,
      errorMessage: message.errorMessage,
      model: message.model,
      durationMs: message.durationMs,
    });
    next = seedToolCalls(next, message, "done");
    next = withCacheHitRate(next, message);
  }
  return {
    ...next,
    messages: appended.length === 0 ? next.messages : [...next.messages, ...appended],
    historyLoading: !final,
  };
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
  const base = `${message.role}:${message.timestamp ?? "unknown"}`;
  // pi stamps queued user prompts with `Date.now()` when they are enqueued, so two messages sent
  // in the same millisecond (a queue edit that re-posts several follow-ups, for example) share
  // the timestamp. Their content still differs, and `message_start`/`message_end` of the same
  // message carry identical content, so the content hash keeps them apart without breaking pairing.
  if (message.role === "user") {
    const fingerprint = contentFingerprint(message.content);
    if (fingerprint !== null) return `${base}:${fingerprint}`;
  }
  return base;
}

/**
 * Stable digest of a user message payload. Text is normalized so a plain string and the matching
 * text block produce the same value (live events and hydrated history use both shapes).
 */
function contentFingerprint(content: WireMessage["content"]): string | null {
  const text = typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.map((block) => (block.type === "text" ? (block as WireTextContent).text ?? "" : "\u0000image")).join("\u0001")
      : "";
  if (text.length === 0) return null;
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${text.length}-${(hash >>> 0).toString(36)}`;
}

function toRole(role: string): ChatMessage["role"] {
  if (role === "user") return "user";
  if (role === "assistant") return "assistant";
  return "system";
}

/**
 * Ranges of the text that are markdown code (fenced blocks or inline code spans).
 * A literal `<thinking>` tag inside code is quoted content, not a block boundary.
 */
function codeRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  // Fenced code blocks; an unterminated fence runs to the end of the text.
  const fencePattern = /(?:^|\n)[ \t]*(?:```|~~~)/g;
  let open: RegExpExecArray | null = null;
  let match: RegExpExecArray | null;
  while ((match = fencePattern.exec(text)) !== null) {
    if (open === null) {
      open = match;
    } else {
      ranges.push([open.index, match.index + match[0].length]);
      open = null;
    }
  }
  if (open !== null) ranges.push([open.index, text.length]);

  // Inline code spans outside fences.
  const inlinePattern = /`[^`\n]*`/g;
  while ((match = inlinePattern.exec(text)) !== null) {
    const found = match;
    if (!ranges.some(([start, end]) => found.index >= start && found.index < end)) {
      ranges.push([found.index, found.index + found[0].length]);
    }
  }
  return ranges;
}

function inCodeRange(ranges: Array<[number, number]>, index: number): boolean {
  return ranges.some(([start, end]) => index >= start && index < end);
}

/** Removes thinking tags outside markdown code regions, keeping quoted literal tags intact. */
function removeThinkingTags(text: string): string {
  const tagPattern = /<\/?thinking\b[^>]*>/gi;
  const code = codeRanges(text);
  let result = "";
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = tagPattern.exec(text)) !== null) {
    if (inCodeRange(code, match.index)) continue;
    result += text.slice(cursor, match.index);
    cursor = match.index + match[0].length;
  }
  return result + text.slice(cursor);
}

export function stripThinkingTags(text: string): string {
  return removeThinkingTags(text);
}

/** Converts provider-emitted XML thinking tags into the same blocks as native reasoning output. */
export function normalizeTaggedBlocks(blocks: Block[]): Block[] {
  return blocks.flatMap((block) => {
    if (block.kind !== "text") return [block];
    return splitTaggedText(block.text);
  });
}

function splitTaggedText(text: string): Block[] {
  const tagPattern = /<thinking\b[^>]*>|<\/thinking\s*>/gi;
  const code = codeRanges(text);
  const blocks: Block[] = [];
  let cursor = 0;
  let thinking = false;
  let match: RegExpExecArray | null;

  while ((match = tagPattern.exec(text)) !== null) {
    if (inCodeRange(code, match.index)) continue;
    const segment = text.slice(cursor, match.index);
    if (segment.length > 0) {
      blocks.push(thinking ? { kind: "thinking", text: segment, completed: true } : { kind: "text", text: segment });
    }
    thinking = !thinking;
    cursor = match.index + match[0].length;
  }

  const remainder = text.slice(cursor);
  if (remainder.length > 0) {
    blocks.push(thinking ? { kind: "thinking", text: remainder } : { kind: "text", text: remainder });
  }
  return blocks.length > 0 ? blocks : [{ kind: "text", text: stripThinkingTags(text) }];
}

export function blocksFromMessage(message: WireMessage): Block[] {
  const content = message.content;
  if (content === undefined) return [];
  if (typeof content === "string") {
    return content.length > 0 ? normalizeTaggedBlocks([{ kind: "text", text: content }]) : [];
  }
  return normalizeTaggedBlocks(content.map(blockFromContent).filter((block): block is Block => block !== null));
}

/**
 * The host strips image payloads from `message_end` (message_start already delivered them),
 * so refill the empty data from the blocks that are currently rendered.
 */
function withImageData(blocks: Block[], existing: ChatMessage | undefined): Block[] {
  if (!existing) return blocks;
  return blocks.map((block, index) => {
    if (block.kind !== "image" || block.data) return block;
    const previous = existing.blocks[index];
    return previous && previous.kind === "image" && previous.mimeType === block.mimeType
      ? { ...block, data: previous.data }
      : block;
  });
}

function blockFromContent(content: WireContent): Block | null {
  switch (content.type) {
    case "text":
      return { kind: "text", text: (content as WireTextContent).text ?? "" };
    case "thinking": {
      const thinking = content as WireThinkingContent;
      return { kind: "thinking", text: stripThinkingTags(thinking.thinking ?? ""), redacted: thinking.redacted };
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
