import { useEffect, useId, useRef, useState } from "react";
import { formatCost, formatTokens } from "../format";
import { useI18n } from "../i18n";
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
  /** Renders the model popup above the footer model entry; the argument closes it. */
  renderModelsMenu?: (close: () => void) => JSX.Element;
  onOpenModels: () => void;
  /** Available thinking levels for the footer popup. */
  thinkingLevels: string[];
  /** Footer thinking-level entry, opening the popup (and asking the host for fresh levels). */
  onOpenThinking: () => void;
  /** Choosing a level in the footer popup. */
  onSelectThinking: (level: string) => void;
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
  thinkingLevels,
  renderModelsMenu,
  onOpenModels,
  onOpenThinking,
  onSelectThinking,
  onToggleAutoCompaction,
}: Props): JSX.Element {
  const { t } = useI18n();
  const autoCompactionTooltipId = useId();
  const [autoCompactionHovered, setAutoCompactionHovered] = useState(false);
  const [autoCompactionFocused, setAutoCompactionFocused] = useState(false);
  const showAutoCompactionTooltip = autoCompactionHovered || autoCompactionFocused;
  // The thinking and model entries open small popups above the footer instead of the full
  // picker overlay; only one is open at a time and both close on an outside click/Escape.
  const [openPopup, setOpenPopup] = useState<"models" | "thinking" | null>(null);
  const thinkingControlRef = useRef<HTMLDivElement>(null);
  const modelsControlRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!openPopup) return;
    const closeOnOutsidePointer = (event: MouseEvent): void => {
      const target = event.target as Node;
      if (modelsControlRef.current?.contains(target) || thinkingControlRef.current?.contains(target)) return;
      setOpenPopup(null);
    };
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpenPopup(null);
    };
    document.addEventListener("mousedown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [openPopup]);
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
  const autoCompactionLabel = autoCompaction ? t("automaticCompactionOn") : t("automaticCompactionOff");

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
                ? t("contextUnavailable")
                : t("contextUsage", { input: formatTokens(usage?.input ?? 0), used: formatTokens(status.context?.tokens ?? 0), remaining: formatTokens(Math.max(0, contextWindow - (status.context?.tokens ?? 0))) })
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
          {status.isCompacting && <span className="status-streaming">{t("compacting")}</span>}
          {streaming && (
            <span className="status-streaming">
              {t("running")}
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
          <div className="status-model-control" ref={modelsControlRef}>
            <button
              type="button"
              className="status-model"
              onClick={() => {
                if (openPopup === "models") {
                  setOpenPopup(null);
                  return;
                }
                onOpenModels();
                setOpenPopup("models");
              }}
              disabled={disabled}
              title={modelCount > 0 ? t("availableModels", { count: modelCount }) : t("openModelPicker")}
              aria-haspopup="dialog"
              aria-expanded={openPopup === "models"}
            >
              {modelLabel} ▾
            </button>
            {openPopup === "models" && renderModelsMenu?.(() => setOpenPopup(null))}
          </div>
          {thinkingLabel && (
            <div className="status-thinking-control" ref={thinkingControlRef}>
              <button
                type="button"
                className="status-model status-thinking"
                onClick={() => {
                  if (openPopup === "thinking") {
                    setOpenPopup(null);
                    return;
                  }
                  onOpenThinking();
                  setOpenPopup("thinking");
                }}
                disabled={disabled}
                title={t("thinkingLevel")}
                aria-haspopup="listbox"
                aria-expanded={openPopup === "thinking"}
              >
                {thinkingLabel} ▾
              </button>
              {openPopup === "thinking" && (
                <div className="status-thinking-menu" role="listbox" aria-label={t("thinkingLevel")}>
                  {thinkingLevels.length === 0 ? (
                    <span className="status-thinking-empty">{t("thinkingEmpty")}</span>
                  ) : (
                    thinkingLevels.map((level) => (
                      <button
                        key={level}
                        type="button"
                        role="option"
                        aria-selected={level === status.thinkingLevel}
                        className={`status-thinking-item ${level === status.thinkingLevel ? "status-thinking-item-active" : ""}`}
                        onClick={() => {
                          setOpenPopup(null);
                          onSelectThinking(level);
                        }}
                      >
                        <span className="status-thinking-marker" aria-hidden="true">
                          {level === status.thinkingLevel ? "●" : ""}
                        </span>
                        {level}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      {extensionLine.length > 0 && <div className="status-extensions">{extensionLine}</div>}
      {status.phase !== "running" && <div className="status-phase">{status.message}</div>}
    </footer>
  );
}
