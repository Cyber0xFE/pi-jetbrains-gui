import type { WireStatus } from "../types";

interface Props {
  status: WireStatus;
  disabled: boolean;
  /** Current session's first user message, used before falling back to the id. */
  sessionFallback?: string | null;
  onOpenSessions: () => void;
  onNewSession: () => void;
  onCompact: () => void;
}

/**
 * Top bar for the session/compaction controls (plan M3.2–M3.6).
 * The model and thinking-level pickers live in the footer; this bar holds the remaining actions.
 */
export function Toolbar({
  status,
  disabled,
  sessionFallback,
  onOpenSessions,
  onNewSession,
  onCompact,
}: Props): JSX.Element {

  // Unnamed sessions stay "未命名会话" until the first message replaces the label.
  const sessionLabel = status.sessionName?.trim() || sessionFallback?.trim() || "未命名会话";

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
      <button type="button" className="toolbar-button" onClick={onNewSession} disabled={disabled} title="Start a new session">
        New
      </button>
    </header>
  );
}
