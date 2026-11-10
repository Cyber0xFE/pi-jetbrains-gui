import { useEffect, useId, useState } from "react";
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
  onOpenModels: () => void;
  /** Footer thinking-level entry, opening the thinking picker. */
  onOpenThinking: () => void;
  /** Footer icon, toggling automatic context compaction. */
  onToggleAutoCompaction: () => void;
}

/**
 * TUI-style footer (plan M2), one line like pi's `FooterComponent` stats row:
 *
 * `↑12k ↓3.4k R99k W2k CH59.2% $0.043 35.9%/524k (auto)   provider/model ▾ • high`
 *
 * followed by extension statuses. Everything is dim except the context percentage, which turns
 * warning/error above 70%/90%. The model entry doubles as the model picker trigger and the thinking level next to it opens the thinking picker
 * (both moved from the toolbar). Send/stop lives on the composer's corner button instead.
 */
export function StatusBar({
  status,
  busy,
  disabled,
  modelCount,
  cacheHitRate,
  extensionStatuses,
  onOpenModels,
  onOpenThinking,
  onToggleAutoCompaction,
}: Props): JSX.Element {
  const autoCompactionTooltipId = useId();
  const [autoCompactionHovered, setAutoCompactionHovered] = useState(false);
  const [autoCompactionFocused, setAutoCompactionFocused] = useState(false);
  const showAutoCompactionTooltip = autoCompactionHovered || autoCompactionFocused;
  // The footer's running indicator cycles "." -> ".." -> "..." on a timer instead of a CSS
  // animation: the IDE webview inherits the OS "show animations" setting, so keyframes are
  // dropped (prefers-reduced-motion) on machines with Windows animation effects off.
  const streaming = busy || status.isStreaming;
  const [ellipsisDots, setEllipsisDots] = useState(1);
  useEffect(() => {
    if (!streaming) return;
    setEllipsisDots(1);
    const timer = window.setInterval(() => setEllipsisDots((dots) => (dots % 3) + 1), 400);
    return () => window.clearInterval(timer);
  }, [streaming]);
  const usage = status.usage ?? null;
  const contextWindow = status.context?.contextWindow ?? status.contextWindow ?? null;
  const percent = status.context?.percent ?? null;
  const autoCompaction = status.autoCompaction !== false;
  const autoCompactionLabel = autoCompaction ? "自动压缩开启" : "自动压缩关闭";

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
          <span
            className={contextClass}
            title={
              percent === null || contextWindow === null
                ? "Context usage is not available"
                : `${formatTokens(usage?.input ?? 0)} input tokens · ${formatTokens(status.context?.tokens ?? 0)} used · ${formatTokens(Math.max(0, contextWindow - (status.context?.tokens ?? 0)))} remaining`
            }
          >
            {contextDisplay}
          </span>
          <span
            className="status-auto-control"
            onMouseEnter={() => setAutoCompactionHovered(true)}
            onMouseLeave={() => setAutoCompactionHovered(false)}
            onFocus={() => setAutoCompactionFocused(true)}
            onBlur={() => setAutoCompactionFocused(false)}
          >
            <button
              type="button"
              className={`status-auto ${autoCompaction ? "status-auto-on" : ""}`}
              onClick={onToggleAutoCompaction}
              disabled={disabled}
              aria-label={autoCompactionLabel}
              aria-pressed={autoCompaction}
              aria-describedby={showAutoCompactionTooltip ? autoCompactionTooltipId : undefined}
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
                <path d="M12 3v6m-4-4 4 4 4-4M12 21v-6m-4 4 4-4 4 4M4 12h16" />
              </svg>
            </button>
            {showAutoCompactionTooltip && (
              <span id={autoCompactionTooltipId} role="tooltip" className="status-auto-tooltip">
                {autoCompactionLabel}
              </span>
            )}
          </span>
          {status.isCompacting && <span className="status-streaming">compacting…</span>}
          {streaming && (
            <span className="status-streaming">
              running
              <span className="status-ellipsis" aria-hidden="true">
                {[1, 2, 3].map((dot) => (
                  <span key={dot} className={dot <= ellipsisDots ? undefined : "status-ellipsis-off"}>
                    .
                  </span>
                ))}
              </span>
            </span>
          )}
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
        </div>
      </div>
      {extensionLine.length > 0 && <div className="status-extensions">{extensionLine}</div>}
      {status.phase !== "running" && <div className="status-phase">{status.message}</div>}
    </footer>
  );
}
