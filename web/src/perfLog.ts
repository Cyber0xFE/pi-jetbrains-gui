import { post } from "./bridge";

type Metric = {
  count: number;
  totalMs: number;
  maxMs: number;
  last?: Record<string, number>;
};

const metrics = new Map<string, Metric>();
const FLUSH_COUNT = 50;
const FLUSH_INTERVAL_MS = 1000;
let pendingCount = 0;
let lastFlushAt = Date.now();

/**
 * Sends sampled webview performance data to the host log.
 *
 * Logging is deliberately aggregated: one native bridge call per 50 samples or one second keeps
 * the instrumentation from changing the rendering behaviour we are measuring.
 */
export function recordPerf(name: string, durationMs = 0, fields?: Record<string, number>): void {
  const current = metrics.get(name) ?? { count: 0, totalMs: 0, maxMs: 0 };
  current.count += 1;
  current.totalMs += durationMs;
  current.maxMs = Math.max(current.maxMs, durationMs);
  current.last = fields;
  metrics.set(name, current);
  pendingCount += 1;

  const now = Date.now();
  if (pendingCount >= FLUSH_COUNT || now - lastFlushAt >= FLUSH_INTERVAL_MS) flushPerf();
}

export function logWebview(message: string): void {
  post({ type: "log", message: `[webview] ${message}` });
}

/**
 * Detects pauses in the webview JavaScript event loop. A callback cannot run while the renderer
 * thread is busy with React, layout or painting, so the next callback reports the missed time.
 */
export function startWebviewHeartbeat(): () => void {
  const intervalMs = 100;
  const reportAfterMs = 200;
  let expectedAt = performance.now() + intervalMs;
  const timer = window.setInterval(() => {
    const now = performance.now();
    const delayMs = now - expectedAt;
    if (delayMs >= reportAfterMs) {
      post({
        type: "log",
        message: `[webview-stall] event_loop_delay=${delayMs.toFixed(1)}ms`,
      });
    }
    expectedAt = now + intervalMs;
  }, intervalMs);
  return () => window.clearInterval(timer);
}

function flushPerf(): void {
  if (pendingCount === 0) return;
  const parts: string[] = [];
  for (const [name, metric] of metrics) {
    const fields = metric.last
      ? ` ${Object.entries(metric.last).map(([key, value]) => `${key}=${value}`).join(" ")}`
      : "";
    parts.push(
      `${name} count=${metric.count} totalMs=${metric.totalMs.toFixed(1)} ` +
        `avgMs=${(metric.totalMs / metric.count).toFixed(1)} maxMs=${metric.maxMs.toFixed(1)}${fields}`,
    );
  }
  post({ type: "log", message: `[webview-perf] ${parts.join("; ")}` });
  metrics.clear();
  pendingCount = 0;
  lastFlushAt = Date.now();
}
