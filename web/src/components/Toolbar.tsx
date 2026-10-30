import type { WireStatus } from "../types";

interface Props {
  status: WireStatus;
  disabled: boolean;
  modelCount: number;
  /** Current session's first user message, used before falling back to the id. */
  sessionFallback?: string | null;
  onOpenSessions: () => void;
  onOpenModels: () => void;
  onOpenThinking: () => void;
  onNewSession: () => void;
  onCompact: () => void;
  onToggleAutoCompaction: () => void;
}

function shortSessionId(id: string | null | undefined): string {
  if (!id) return "session";
  return id.length > 10 ? `${id.slice(0, 8)}…` : id;
}

/**
 * Top bar for the M3 session/model/thinking/compaction controls (plan M3.2–M3.6).
 * The footer keeps the TUI-style stats; this bar holds the actions.
 */
export function Toolbar({
  status,
  disabled,
  modelCount,
  sessionFallback,
  onOpenSessions,
  onOpenModels,
  onOpenThinking,
  onNewSession,
  onCompact,
  onToggleAutoCompaction,
}: Props): JSX.Element {
  const sessionLabel = status.sessionName?.trim() || sessionFallback?.trim() || shortSessionId(status.sessionId);
  const modelLabel = status.model ? `${status.provider ? `${status.provider}/` : ""}${status.model}` : "model";
  const thinkingVisible = status.reasoning !== false && status.thinkingLevel !== null && status.thinkingLevel !== undefined;
  const auto = status.autoCompaction !== false;

  return (
    <header className="toolbar">
      <button
        type="button"
        className="toolbar-button toolbar-session"
        onClick={onOpenSessions}
        disabled={disabled}
        title={status.sessionFile ?? "Open the session picker"}
      >
        {sessionLabel}
      </button>
      <button
        type="button"
        className="toolbar-button"
        onClick={onOpenModels}
        disabled={disabled}
        title={modelCount > 0 ? `${modelCount} available models` : "Open the model picker"}
      >
        {modelLabel} ▾
      </button>
      {thinkingVisible && (
        <button type="button" className="toolbar-button" onClick={onOpenThinking} disabled={disabled} title="Thinking level">
          {status.thinkingLevel} ▾
        </button>
      )}
      <div className="toolbar-spacer" />
      <button
        type="button"
        className="toolbar-button"
        onClick={onCompact}
        disabled={disabled || status.isStreaming || status.isCompacting}
        title="Compact the conversation context"
      >
        {status.isCompacting ? "compacting…" : "Compact"}
      </button>
      <button
        type="button"
        className={`toolbar-button ${auto ? "toolbar-button-on" : ""}`}
        onClick={onToggleAutoCompaction}
        disabled={disabled}
        title="Automatic compaction when the context window fills up"
        aria-pressed={auto}
      >
        auto-compact
      </button>
      <button type="button" className="toolbar-button" onClick={onNewSession} disabled={disabled} title="Start a new session">
        New
      </button>
    </header>
  );
}
