import { formatCost, formatTokens } from "../format";
import type { WireStatus } from "../types";

interface Props {
  status: WireStatus;
  busy: boolean;
  disabled: boolean;
  modelCount: number;
  /** Latest assistant message cache read / prompt tokens, as a percentage. */
  cacheHitRate: number | null;
  /** `ctx.ui.setStatus()` texts, keyed by extension key. */
  extensionStatuses: Record<string, string>;
  /** Footer send/stop action, mirroring the composer's Enter key. */
  onSend: () => void;
  onAbort: () => void;
  onOpenModels: () => void;
  /** Footer thinking-level entry, opening the thinking picker. */
  onOpenThinking: () => void;
  /** Footer `(auto)` entry, toggling automatic context compaction. */
  onToggleAutoCompaction: () => void;
  canSend: boolean;
}

/**
 * TUI-style footer (plan M2), one line like pi's `FooterComponent` stats row:
 *
 * `↑12k ↓3.4k R99k W2k CH59.2% $0.043 35.9%/524k (auto)   provider/model ▾ • high`
 *
 * followed by extension statuses. Everything is dim except the context percentage, which turns
 * warning/error above 70%/90%. The model entry doubles as the model picker trigger and the thinking level next to it opens the thinking picker
 * (both moved from the toolbar).
 */
export function StatusBar({
  status,
  busy,
  disabled,
  modelCount,
  cacheHitRate,
  extensionStatuses,
  onSend,
  onAbort,
  onOpenModels,
  onOpenThinking,
  onToggleAutoCompaction,
  canSend,
}: Props): JSX.Element {
  const usage = status.usage ?? null;
  const contextWindow = status.context?.contextWindow ?? status.contextWindow ?? null;
  const percent = status.context?.percent ?? null;
  const autoCompaction = status.autoCompaction !== false;

  const contextDisplay =
    percent === null
      ? `?/${contextWindow === null ? "?" : formatTokens(contextWindow)}`
      : `${percent.toFixed(1)}%/${contextWindow === null ? "?" : formatTokens(contextWindow)}`;
  const contextClass =
    percent !== null && percent > 90
      ? "status-context status-context-critical"
      : percent !== null && percent > 70
        ? "status-context status-context-warning"
        : "status-context";

  const cacheRead = usage?.cacheRead ?? 0;
  const cacheWrite = usage?.cacheWrite ?? 0;
  const showCacheHit = (cacheRead > 0 || cacheWrite > 0) && cacheHitRate !== null;

  const model = status.model ?? "no model";
  const showThinking = status.reasoning !== false && status.thinkingLevel !== null && status.thinkingLevel !== undefined;
  const thinkingLabel = showThinking
    ? status.thinkingLevel === "off"
      ? "thinking off"
      : (status.thinkingLevel ?? "off")
    : null;
  const modelLabel = `${status.provider ? `${status.provider}/` : ""}${model}`;

  const extensionLine = Object.entries(extensionStatuses)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, text]) => text.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim())
    .filter((text) => text.length > 0)
    .join(" ");

  return (
    <footer className={`statusbar statusbar-${status.phase}`}>
      <div className="status-main">
        <div className="status-stats">
          {usage?.input ? <span>↑{formatTokens(usage.input)}</span> : null}
          {usage?.output ? <span>↓{formatTokens(usage.output)}</span> : null}
          {cacheRead > 0 ? <span>R{formatTokens(cacheRead)}</span> : null}
          {cacheWrite > 0 ? <span>W{formatTokens(cacheWrite)}</span> : null}
          {showCacheHit ? <span>CH{cacheHitRate.toFixed(1)}%</span> : null}
          {usage?.cost ? <span>{formatCost(usage.cost)}</span> : null}
          <span className={contextClass}>{contextDisplay}</span>
          <button
            type="button"
            className={`status-auto ${autoCompaction ? "status-auto-on" : ""}`}
            onClick={onToggleAutoCompaction}
            disabled={disabled}
            title="Automatic compaction when the context window fills up"
            aria-pressed={autoCompaction}
          >
            {autoCompaction ? "(auto)" : "(manual)"}
          </button>
          {status.isCompacting && <span className="status-streaming">compacting…</span>}
          {(busy || status.isStreaming) && <span className="status-streaming">running…</span>}
        </div>
        <div className="status-right">
          <button
            type="button"
            className="status-model"
            onClick={onOpenModels}
            disabled={disabled}
            title={modelCount > 0 ? `${modelCount} available models` : "Open the model picker"}
          >
            {modelLabel} ▾
          </button>
          {thinkingLabel && (
            <button
              type="button"
              className="status-model status-thinking"
              onClick={onOpenThinking}
              disabled={disabled}
              title="Thinking level"
            >
              {thinkingLabel} ▾
            </button>
          )}
          {busy ? (
            <button type="button" className="button button-secondary button-footer" onClick={onAbort}>
              Stop
            </button>
          ) : (
            <button type="button" className="button button-footer" onClick={onSend} disabled={!canSend}>
              Send
            </button>
          )}
        </div>
      </div>
      {extensionLine.length > 0 && <div className="status-extensions">{extensionLine}</div>}
      {status.phase !== "running" && <div className="status-phase">{status.message}</div>}
    </footer>
  );
}
