import type { WireStatus } from "../types";

interface Props {
  status: WireStatus;
  disabled: boolean;
  /** Current session's first user message, used before falling back to the id. */
  sessionFallback?: string | null;
  onOpenSessions: () => void;
  onNewSession: () => void;
}

/**
 * Top bar for the session controls (plan M3.2–M3.6).
 * The model, thinking-level and compaction controls live in the composer/footer.
 */
export function Toolbar({
  status,
  disabled,
  sessionFallback,
  onOpenSessions,
  onNewSession,
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
        title={status.sessionName?.trim() || sessionFallback?.trim() || status.sessionFile || "打开会话选择器"}
      >
        <span className="toolbar-session-mark" aria-hidden="true" />
        <span className="toolbar-session-label">{sessionLabel}</span>
      </button>
      <div className="toolbar-spacer" />
      <button type="button" className="toolbar-button toolbar-new" onClick={onNewSession} disabled={disabled} title="开始新会话">
        <span className="toolbar-new-icon" aria-hidden="true">＋</span>
        <span>新建</span>
      </button>
    </header>
  );
}
