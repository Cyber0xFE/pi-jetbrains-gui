import { post } from "../../bridge";

interface Props {
  path: string;
  line?: number;
  endLine?: number;
  label?: string;
  className?: string;
}

/** Clickable file reference; Kotlin resolves it against the project and opens the editor. */
export function PathLink({ path, line, endLine, label, className }: Props): JSX.Element {
  const title = line === undefined
    ? `Open ${path}`
    : `Open ${path}:${line}${endLine !== undefined && endLine !== line ? `-${endLine}` : ""}`;
  return (
    <button
      type="button"
      className={`path-link${className ? ` ${className}` : ""}`}
      title={title}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        post(line === undefined
          ? { type: "open_path", path }
          : { type: "open_path", path, line, ...(endLine === undefined ? {} : { endLine }) });
      }}
    >
      {label ?? path}
    </button>
  );
}
