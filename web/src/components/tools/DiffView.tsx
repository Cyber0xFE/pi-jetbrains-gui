import { post } from "../../bridge";
import type { DiffRow } from "../../tools/diff";

interface Props {
  rows: DiffRow[];
  /** File the diff belongs to; line numbers become clickable when set. */
  path?: string;
}

/** Line-level diff view; clicking a line opens the file at that line (plan M2.3). */
export function DiffView({ rows, path }: Props): JSX.Element {
  return (
    <div className="diff">
      {rows.map((row, index) => (
        <div key={index} className={`diff-row diff-${row.kind}`}>
          <LineNumber path={path} line={row.line} />
          <span className="diff-sign">{sign(row.kind)}</span>
          <span className="diff-text">{row.text}</span>
        </div>
      ))}
    </div>
  );
}

function LineNumber({ path, line }: { path?: string; line?: number }): JSX.Element {
  if (line === undefined) return <span className="diff-line" />;
  if (path === undefined) {
    return <span className="diff-line">{line}</span>;
  }
  return (
    <button
      type="button"
      className="diff-line diff-line-link"
      title={`Open ${path}:${line}`}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        post({ type: "open_path", path, line });
      }}
    >
      {line}
    </button>
  );
}

function sign(kind: DiffRow["kind"]): string {
  if (kind === "add") return "+";
  if (kind === "delete") return "-";
  return " ";
}
