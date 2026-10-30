/** Wire shapes emitted by pi's RPC mode (see pi's docs/json.md and docs/message-types.md). */

export interface WireTextContent {
  type: "text";
  text: string;
}

export interface WireThinkingContent {
  type: "thinking";
  thinking: string;
  redacted?: boolean;
}

export interface WireImageContent {
  type: "image";
  data: string;
  mimeType: string;
}

export interface WireToolCallContent {
  type: "toolCall";
  id: string;
  name: string;
  arguments?: unknown;
  argumentsError?: string;
}

export type WireContent =
  | WireTextContent
  | WireThinkingContent
  | WireImageContent
  | WireToolCallContent
  | { type: string; [key: string]: unknown };

export type WireRole = "user" | "assistant" | "toolResult" | "system";

export interface WireMessage {
  role: WireRole;
  content?: string | WireContent[];
  timestamp?: number;
  stopReason?: string;
  errorMessage?: string;
  model?: string;
  provider?: string;
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
  durationMs?: number;
  usage?: WireUsage;
  details?: unknown;
}

/** Streaming delta carried by `message_update.assistantMessageEvent`. */
export interface AssistantDelta {
  type: string;
  contentIndex?: number;
  delta?: string;
  content?: string;
  id?: string;
  toolName?: string;
  toolCall?: WireToolCallContent;
  reason?: string;
  error?: unknown;
}

export interface WireRecord {
  type?: string;
  message?: WireMessage;
  assistantMessageEvent?: AssistantDelta;
  toolCallId?: string;
  toolName?: string;
  args?: unknown;
  partialResult?: unknown;
  result?: unknown;
  isError?: boolean;
  durationMs?: number;
  command?: string;
  success?: boolean;
  error?: string;
  level?: string;
  /** `tool_execution_*` of a call another tool made (M2 nested cards). */
  parentToolCallId?: string;
  /** `bash_execution_update` correlation id and output delta. */
  id?: string;
  delta?: string;
  /** `extension_ui_request` fields the UI understands. */
  method?: string;
  label?: string;
  statusKey?: string;
  statusText?: string;
  [key: string]: unknown;
}

export interface ContextUsage {
  tokens: number | null;
  contextWindow: number | null;
  percent: number | null;
}

/** Cumulative session usage from `get_session_stats`. */
export interface UsageTotals {
  input?: number | null;
  output?: number | null;
  cacheRead?: number | null;
  cacheWrite?: number | null;
  cost?: number | null;
}

/** Per-message `usage` used to derive the cache hit rate (TUI `CH` stat). */
export interface WireUsage {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  cost?: { total?: number } | number;
}

export type WirePhase = "stopped" | "starting" | "running" | "failed";

export interface WireStatus {
  phase: WirePhase;
  message: string;
  node?: string | null;
  pi?: string | null;
  sessionId?: string | null;
  model?: string | null;
  provider?: string | null;
  reasoning?: boolean | null;
  thinkingLevel?: string | null;
  isStreaming?: boolean;
  isCompacting?: boolean;
  autoCompaction?: boolean;
  usage?: UsageTotals | null;
  contextWindow?: number | null;
  context?: ContextUsage | null;
}

export type NoticeLevel = "info" | "error";

/** Kotlin -> webview. */
export type Inbound =
  | { type: "status"; status: WireStatus }
  | { type: "records"; records: WireRecord[] }
  | { type: "history"; messages: WireMessage[]; final: boolean }
  | { type: "notice"; level: NoticeLevel; message: string };

/** webview -> Kotlin. */
export type Outbound =
  | { type: "ready" }
  | { type: "start" }
  | { type: "prompt"; message: string }
  | { type: "abort" }
  | { type: "request_state" }
  | { type: "open_path"; path: string; line?: number }
  | { type: "open_url"; url: string }
  | { type: "log"; message: string };
