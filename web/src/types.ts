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

/** Active automatic retry window (`auto_retry_start` … `auto_retry_end`). */
export interface WireRetry {
  attempt: number;
  maxAttempts: number;
  delayMs: number;
  errorMessage?: string | null;
}

export interface PromptImage {
  data: string;
  mimeType: string;
}

export interface WireTheme {
  background: string;
  foreground: string;
  foregroundDim: string;
  raisedBackground: string;
  border: string;
  accent: string;
  error: string;
  errorBackground: string;
  dark: boolean;
  fontSize: number;
}

export interface WireStatus {
  phase: WirePhase;
  message: string;
  node?: string | null;
  pi?: string | null;
  sessionId?: string | null;
  sessionFile?: string | null;
  sessionName?: string | null;
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
  retry?: WireRetry | null;
  pendingContext?: string | null;
}

/** One row of the session list (plan M3.2). */
export interface SessionSummary {
  path: string;
  id: string;
  name?: string | null;
  cwd?: string | null;
  created?: number | null;
  modified: number;
  messageCount: number;
  firstMessage?: string | null;
  parentSessionPath?: string | null;
  current: boolean;
}

/** One flattened `get_tree` row (plan M3.3). */
export interface TreeEntry {
  id: string;
  parentId?: string | null;
  type: string;
  role?: string | null;
  label?: string | null;
  text: string;
  depth: number;
  forkable: boolean;
  active: boolean;
}

/** One row of the model picker (plan M3.4). */
export interface ModelInfo {
  id: string;
  name?: string | null;
  provider?: string | null;
  reasoning?: boolean | null;
  contextWindow?: number | null;
}

/** Slash command from `get_commands` (plan M3.8). */
export interface SlashCommand {
  name: string;
  description?: string | null;
  source: string;
}

export type NoticeLevel = "info" | "error";

/** Kotlin -> webview. */
export type Inbound =
  | { type: "theme"; theme: WireTheme }
  | { type: "status"; status: WireStatus }
  | { type: "records"; records: WireRecord[] }
  | { type: "history"; messages: WireMessage[]; final: boolean }
  | { type: "notice"; level: NoticeLevel; message: string }
  | { type: "sessions"; sessions: SessionSummary[] }
  | { type: "session_tree"; entries: TreeEntry[]; leafId: string | null; sessionId: string | null }
  | {
      type: "models";
      models: ModelInfo[];
      currentProvider: string | null;
      currentModel: string | null;
      defaultProvider?: string | null;
      defaultModel?: string | null;
    }
  | { type: "thinking_levels"; levels: string[]; current: string | null }
  | { type: "commands"; commands: SlashCommand[] }
  | { type: "files"; files: string[] }
  | { type: "reset"; reason: string }
  | { type: "prefill"; text: string }
  | { type: "focus_composer" }
  | { type: "widget"; key: string; lines: string[]; placement: "aboveEditor" | "belowEditor" }
  | { type: "extension_status"; key: string; text: string | null };

/** webview -> Kotlin. */
export type Outbound =
  | { type: "ready" }
  | { type: "start" }
  | { type: "prompt"; message: string; images?: PromptImage[] }
  | { type: "abort" }
  | { type: "request_state" }
  | { type: "open_path"; path: string; line?: number; endLine?: number }
  | { type: "open_url"; url: string }
  | { type: "log"; message: string }
  // M3: sessions
  | { type: "list_sessions" }
  | { type: "get_tree" }
  | { type: "new_session" }
  | { type: "switch_session"; path: string }
  | { type: "fork"; entryId: string }
  | { type: "rename_session"; name: string; path?: string }
  | { type: "delete_session"; path: string }
  // M3: model / thinking
  | { type: "get_models" }
  | { type: "set_model"; provider: string; modelId: string }
  | { type: "set_default_model"; provider: string; modelId: string }
  | { type: "get_thinking_levels" }
  | { type: "set_thinking_level"; level: string }
  // M3: compaction / retry / slash commands
  | { type: "compact" }
  | { type: "set_auto_compaction"; enabled: boolean }
  | { type: "abort_retry" }
  | { type: "get_commands" }
  | { type: "list_files" }
  | { type: "clear_context" };
