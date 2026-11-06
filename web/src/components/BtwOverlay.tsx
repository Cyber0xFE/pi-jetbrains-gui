import { useEffect } from "react";
import { Markdown } from "./Markdown";
import { AnimatedEllipsis, ThinkingIcon } from "./MessageList";
import type { BtwState } from "../state/sessionReducer";

interface Props {
  /** Most recent side question; null shows the usage hint. */
  btw: BtwState | null;
  /** True when the panel is tucked away behind the right-edge tab. */
  collapsed: boolean;
  onCollapse: () => void;
  onExpand: () => void;
  onClose: () => void;
}

/**
 * Dismissible overlay for `/btw` side questions, mirroring Claude Code: the question and its
 * answer slide in from the right edge and never enter the conversation history. Collapsing tucks
 * the panel away behind a slim tab; Esc expands it again first and closes it on the second press.
 */
export function BtwOverlay({ btw, collapsed, onCollapse, onExpand, onClose }: Props): JSX.Element {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (collapsed) onExpand();
      else onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [collapsed, onExpand, onClose]);

  return (
    <>
      <div className={collapsed ? "btw-overlay btw-overlay-collapsed" : "btw-overlay"} role="dialog" aria-label="Side question" aria-hidden={collapsed}>
        <div className="btw-overlay-header">
          <span className="btw-overlay-title">/btw · side question</span>
          <button type="button" className="btw-overlay-collapse" onClick={onCollapse} aria-label="Collapse side question" title="Collapse">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" focusable="false">
              <path d="M9 6l6 6-6 6" />
            </svg>
          </button>
          <button type="button" className="btw-overlay-close" onClick={onClose} aria-label="Dismiss side question">
            ×
          </button>
        </div>
        {btw === null ? (
          <div className="btw-overlay-hint">
            Type <code>/btw your question</code> in the composer to ask without adding anything to the
            session.
          </div>
        ) : (
          <>
            <div className="btw-overlay-question">{btw.question}</div>
            {btw.pending && btw.answer === null && (
              <div className="btw-overlay-pending">
                <ThinkingIcon spinning={true} />
                <span className="thinking-label">
                  正在思考
                  <AnimatedEllipsis className="thinking-ellipsis" />
                </span>
              </div>
            )}
            {btw.error !== null && <div className="btw-overlay-error">{btw.error}</div>}
            {btw.answer !== null && (
              <div className="btw-overlay-answer">
                {/* streaming=true throttles rendering and skips highlighting while deltas arrive. */}
                <Markdown text={btw.answer} streaming={btw.pending} />
              </div>
            )}
          </>
        )}
      </div>
      {collapsed && (
        <button type="button" className="btw-tab" onClick={onExpand} aria-label="Expand side question">
          {btw?.pending ? "/btw ·…" : "/btw"}
        </button>
      )}
    </>
  );
}
