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
      {rows.map((row, index) => {
        const canOpen = path !== undefined && row.line !== undefined;
        const content = (
          <>
            <span className={`diff-line${canOpen ? " diff-line-link" : ""}`}>
              {row.line ?? ""}
            </span>
            <span className="diff-sign">{sign(row.kind)}</span>
            <span className="diff-text">{row.text}</span>
          </>
        );
        if (path === undefined || row.line === undefined) {
          return (
            <div key={index} className={`diff-row diff-${row.kind}`}>
              {content}
            </div>
          );
        }

        const targetPath = path;
        const targetLine = row.line;
        const open = (): void => post({ type: "open_path", path: targetPath, line: targetLine });
        return (
          <div
            key={index}
            className={`diff-row diff-${row.kind} diff-row-link`}
            role="button"
            tabIndex={0}
            title={`Open ${targetPath}:${targetLine}`}
            onClick={open}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                open();
              }
            }}
          >
            {content}
          </div>
        );
      })}
    </div>
  );
}

function sign(kind: DiffRow["kind"]): string {
  if (kind === "add") return "+";
  if (kind === "delete") return "-";
  return " ";
}
