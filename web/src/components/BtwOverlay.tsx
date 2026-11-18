import { useEffect, type JSX } from "react";
import { Markdown } from "./Markdown";
import { useI18n } from "../i18n";
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
  /** Stops the running side question; the host replies with the partial answer. */
  onAbort: () => void;
}

/**
 * Dismissible overlay for `/btw` side questions, mirroring Claude Code: the question and its
 * answer slide in from the right edge and never enter the conversation history. Collapsing tucks
 * the panel away behind a slim tab; Esc expands it again first and closes it on the second press.
 */
export function BtwOverlay({ btw, collapsed, onCollapse, onExpand, onClose, onAbort }: Props): JSX.Element {
  const { t } = useI18n();
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
      <div className={collapsed ? "btw-overlay btw-overlay-collapsed" : "btw-overlay"} role="dialog" aria-label={t("sideQuestion")} aria-hidden={collapsed}>
        <div className="btw-overlay-header">
          <span className="btw-overlay-title">{t("sideQuestionTitle")}</span>
          {btw?.pending && (
            <button
              type="button"
              className="btw-overlay-stop"
              onClick={onAbort}
              aria-label={t("stopSideQuestion")}
              title={t("stopSideQuestion")}
            >
              <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true" focusable="false">
                <rect x="4" y="4" width="16" height="16" rx="2" />
              </svg>
            </button>
          )}
          <button type="button" className="btw-overlay-collapse" onClick={onCollapse} aria-label={t("collapseSideQuestion")} title={t("collapseSideQuestion")}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" focusable="false">
              <path d="M9 6l6 6-6 6" />
            </svg>
          </button>
          <button type="button" className="btw-overlay-close" onClick={onClose} aria-label={t("dismissSideQuestion")}>
            ×
          </button>
        </div>
        <div className="btw-overlay-body">
          {btw === null ? (
            <div className="btw-overlay-hint">
              {t("sideQuestionHint")}
            </div>
          ) : (
          <>
            <div className="btw-overlay-question">{btw.question}</div>
            {btw.pending && btw.stage === "connecting" && (
              <div className="btw-overlay-pending">
                <ThinkingIcon spinning={true} />
                <span className="thinking-label">
                  {t("connecting")}
                  <AnimatedEllipsis className="thinking-ellipsis" />
                </span>
              </div>
            )}
            {(btw.thinking !== null || (btw.pending && btw.stage === "thinking")) && (
              <details className="thinking btw-overlay-thinking">
                <summary>
                  <ThinkingIcon spinning={btw.pending && btw.stage === "thinking"} />
                  <span className="thinking-label">
                    {btw.pending && btw.stage === "thinking" ? t("thinking") : t("done")}
                    {btw.pending && btw.stage === "thinking" && <AnimatedEllipsis className="thinking-ellipsis" />}
                  </span>
                </summary>
                {btw.thinking !== null && <pre>{btw.thinking}</pre>}
              </details>
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
      </div>
      {collapsed && (
        <button type="button" className="btw-tab" onClick={onExpand} aria-label={t("expandSideQuestion")}>
          {btw?.pending ? "/btw ·…" : "/btw"}
        </button>
      )}
    </>
  );
}
