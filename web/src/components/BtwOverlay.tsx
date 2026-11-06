import { useEffect } from "react";
import { Markdown } from "./Markdown";
import type { BtwState } from "../state/sessionReducer";

interface Props {
  /** Most recent side question; null shows the usage hint. */
  btw: BtwState | null;
  onClose: () => void;
}

/**
 * Dismissible overlay for `/btw` side questions, mirroring Claude Code: the question and its
 * answer float above the transcript and never enter the conversation history.
 */
export function BtwOverlay({ btw, onClose }: Props): JSX.Element {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="btw-overlay" role="dialog" aria-label="Side question">
      <div className="btw-overlay-header">
        <span className="btw-overlay-title">/btw · side question</span>
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
          {btw.pending && <div className="btw-overlay-pending">thinking…</div>}
          {btw.error !== null && <div className="btw-overlay-error">{btw.error}</div>}
          {!btw.pending && btw.answer !== null && (
            <div className="btw-overlay-answer">
              <Markdown text={btw.answer} streaming={false} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
