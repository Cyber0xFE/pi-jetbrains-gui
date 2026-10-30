import type { ToolState } from "../state/sessionReducer";

const MAX_OUTPUT_CHARS = 4000;

interface Props {
  name: string;
  callId: string;
  tool: ToolState | undefined;
}

/** M1 keeps tool calls to a compact, collapsible card. Rich per-tool rendering lands in M2. */
export function ToolCard({ name, callId, tool }: Props): JSX.Element {
  const status = tool?.status ?? "running";
  const output = tool?.output;
  const truncated = output !== undefined && output.length > MAX_OUTPUT_CHARS;
  const shown = truncated ? `${output.slice(0, MAX_OUTPUT_CHARS)}\n… (${output.length - MAX_OUTPUT_CHARS} chars hidden)` : output;

  return (
    <details className={`tool tool-${status}`} data-call-id={callId}>
      <summary className="tool-head">
        <span className="tool-name">{name}</span>
        <span className="tool-status">
          {status}
          {tool?.durationMs !== undefined ? ` · ${tool.durationMs}ms` : ""}
        </span>
      </summary>
      {tool?.args !== undefined && <pre className="tool-block">{formatJson(tool.args)}</pre>}
      {shown !== undefined && shown.length > 0 && <pre className="tool-block tool-output">{shown}</pre>}
    </details>
  );
}

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
