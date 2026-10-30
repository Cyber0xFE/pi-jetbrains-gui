import type { WireStatus } from "../types";

interface Props {
  status: WireStatus;
  busy: boolean;
}

export function StatusBar({ status, busy }: Props): JSX.Element {
  const context = status.context;
  const contextLabel =
    context && context.tokens !== null && context.contextWindow !== null
      ? `${formatTokens(context.tokens)} / ${formatTokens(context.contextWindow)}${context.percent !== null ? ` (${Math.round(context.percent)}%)` : ""}`
      : null;

  return (
    <div className={`statusbar statusbar-${status.phase}`}>
      <span className="status-model" title={status.node ?? undefined}>
        {status.model ?? "no model"}
        {status.thinkingLevel ? ` · ${status.thinkingLevel}` : ""}
      </span>
      {contextLabel && <span className="status-context">{contextLabel}</span>}
      {(busy || status.isStreaming) && <span className="status-streaming">running…</span>}
      {status.phase !== "running" && <span className="status-phase">{status.message}</span>}
    </div>
  );
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
  return String(tokens);
}
