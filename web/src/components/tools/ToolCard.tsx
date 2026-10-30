import { useMemo } from "react";
import type { ToolState, ToolStatus } from "../../state/sessionReducer";
import { parseDetailsDiff, previewDiff } from "../../tools/diff";
import { arrayField, formatJson, asObject, numberField, stringField } from "../../tools/result";
import { DiffView } from "./DiffView";
import { PathLink } from "./PathLink";

const MAX_NESTING = 4;

interface Props {
  callId: string;
  name: string;
  tool: ToolState | undefined;
  tools: Record<string, ToolState>;
  depth?: number;
}

/**
 * One tool call. The card body depends on the tool name (plan M2.1); calls a tool made through
 * `ctx.executeTool()` are rendered as nested cards under their parent (plan M2.6).
 */
export function ToolCard({ callId, name, tool, tools, depth = 0 }: Props): JSX.Element {
  const state: ToolState = tool ?? { callId, name, status: "running" };
  const children = useMemo(
    () => Object.values(tools).filter((candidate) => candidate.parentCallId === callId),
    [tools, callId],
  );
  const view = renderTool(state);

  return (
    <section className={`tool-card tool-card-${state.status}`} data-call-id={callId} data-tool={state.name}>
      <header className="tool-head">
        <span className="tool-name">{state.name}</span>
        <span className="tool-title">{view.title}</span>
        <StatusBadge status={state.status} durationMs={state.durationMs} />
      </header>
      {view.body}
      {children.length > 0 && depth < MAX_NESTING && (
        <div className="tool-children">
          <div className="tool-children-label">{children.length} nested call(s)</div>
          {children.map((child) => (
            <ToolCard
              key={child.callId}
              callId={child.callId}
              name={child.name}
              tool={child}
              tools={tools}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </section>
  );
}

interface ToolView {
  title: JSX.Element | string | null;
  body: JSX.Element | null;
}

function renderTool(tool: ToolState): ToolView {
  switch (tool.name) {
    case "read":
      return readView(tool);
    case "edit":
      return editView(tool);
    case "write":
      return writeView(tool);
    case "bash":
    case "powershell":
      return bashView(tool);
    case "grep":
      return grepView(tool);
    case "find":
      return findView(tool);
    case "ls":
      return lsView(tool);
    default:
      return genericView(tool);
  }
}

// ---------------------------------------------------------------------------------------------
// read
// ---------------------------------------------------------------------------------------------

function readView(tool: ToolState): ToolView {
  const path = stringField(tool.args, "path");
  const offset = numberField(tool.args, "offset");
  const limit = numberField(tool.args, "limit");
  const range =
    offset !== undefined
      ? `${offset}${limit !== undefined ? `–${offset + limit - 1}` : "+"}`
      : limit !== undefined
        ? `first ${limit} lines`
        : undefined;

  return {
    title: (
      <>
        {path !== undefined && <PathLink path={path} />}
        {range !== undefined && <span className="chip">{range}</span>}
      </>
    ),
    body: tool.output ? <pre className="tool-output">{tool.output}</pre> : null,
  };
}

// ---------------------------------------------------------------------------------------------
// edit
// ---------------------------------------------------------------------------------------------

interface EditPair {
  oldText: string;
  newText: string;
}

function editsOf(args: unknown): EditPair[] {
  const raw = arrayField(args, "edits") ?? [];
  const pairs: EditPair[] = [];
  for (const item of raw) {
    const object = asObject(item);
    if (!object) continue;
    if (typeof object.oldText === "string" && typeof object.newText === "string") {
      pairs.push({ oldText: object.oldText, newText: object.newText });
    }
  }
  return pairs;
}

function editView(tool: ToolState): ToolView {
  const path = stringField(tool.args, "path");
  const edits = editsOf(tool.args);
  const details = tool.details;
  const detailDiff = typeof details?.diff === "string" ? details.diff : undefined;

  const rows = detailDiff !== undefined ? parseDetailsDiff(detailDiff) : [];
  const isPreview = detailDiff === undefined;

  const body = tool.isError ? (
    tool.output ? <pre className="tool-output tool-output-error">{tool.output}</pre> : null
  ) : detailDiff !== undefined ? (
    <DiffView rows={rows} path={path} />
  ) : edits.length > 0 ? (
    <>
      {edits.map((edit, index) => (
        <div key={index} className="diff-group">
          {edits.length > 1 && <div className="diff-caption">edit {index + 1}</div>}
          <DiffView rows={previewDiff(edit.oldText, edit.newText)} />
        </div>
      ))}
      <div className="tool-note">preview from args; pi applies edits fuzzily (BOM/whitespace tolerant)</div>
    </>
  ) : null;

  return {
    title: (
      <>
        {path !== undefined && <PathLink path={path} />}
        <span className="chip">{edits.length > 0 ? `${edits.length} edit(s)` : "diff"}</span>
        {isPreview && !tool.isError && <span className="chip chip-muted">preview</span>}
      </>
    ),
    body,
  };
}

// ---------------------------------------------------------------------------------------------
// write
// ---------------------------------------------------------------------------------------------

function writeView(tool: ToolState): ToolView {
  const path = stringField(tool.args, "path");
  const content = stringField(tool.args, "content");
  const lines = content === undefined ? 0 : content.split("\n").length;

  return {
    title: (
      <>
        {path !== undefined && <PathLink path={path} />}
        {content !== undefined && <span className="chip">{lines} lines</span>}
      </>
    ),
    body: tool.isError ? (
      tool.output ? <pre className="tool-output tool-output-error">{tool.output}</pre> : null
    ) : content !== undefined ? (
      <details className="tool-section">
        <summary>written content</summary>
        <pre className="tool-output">{content}</pre>
      </details>
    ) : null,
  };
}

// ---------------------------------------------------------------------------------------------
// bash
// ---------------------------------------------------------------------------------------------

function bashView(tool: ToolState): ToolView {
  const command = stringField(tool.args, "command");
  const timeout = numberField(tool.args, "timeout");
  const hasOutput = (tool.output ?? "").length > 0;

  return {
    title: (
      <>
        {timeout !== undefined && <span className="chip">{timeout}s timeout</span>}
        {!hasOutput && tool.status === "running" && <span className="tool-note">waiting for output…</span>}
      </>
    ),
    body: (
      <>
        {command !== undefined && <pre className="tool-command">$ {command}</pre>}
        {hasOutput && (
          <details className="tool-section" open>
            <summary>output</summary>
            <pre className="tool-output tool-terminal">{tool.output}</pre>
          </details>
        )}
        {tool.fullOutputPath !== undefined && (
          <div className="tool-actions">
            <PathLink path={tool.fullOutputPath} label="Open full output" className="path-link-action" />
          </div>
        )}
      </>
    ),
  };
}

// ---------------------------------------------------------------------------------------------
// grep / find / ls
// ---------------------------------------------------------------------------------------------

interface GrepHit {
  path: string;
  line: number;
  text: string;
}

const GREP_LINE = /^(.*?):(\d+):\s?(.*)$/;

function grepView(tool: ToolState): ToolView {
  const pattern = stringField(tool.args, "pattern");
  const searchPath = stringField(tool.args, "path");
  const glob = stringField(tool.args, "glob");
  const hits = parseGrepHits(tool.output);

  return {
    title: (
      <>
        {pattern !== undefined && <code className="chip chip-code">{pattern}</code>}
        {searchPath !== undefined && <PathLink path={searchPath} label={searchPath === "." ? "cwd" : searchPath} />}
        {glob !== undefined && <span className="chip chip-muted">{glob}</span>}
        {hits.length > 0 && <span className="chip">{hits.length} hit(s)</span>}
      </>
    ),
    body:
      tool.isError && tool.output ? (
        <pre className="tool-output tool-output-error">{tool.output}</pre>
      ) : hits.length > 0 ? (
        <div className="hits">
          {hits.map((hit, index) => (
            <div key={index} className="hit">
              <PathLink path={hit.path} line={hit.line} label={`${hit.path}:${hit.line}`} className="hit-path" />
              <span className="hit-text">{hit.text}</span>
            </div>
          ))}
        </div>
      ) : tool.output ? (
        <pre className="tool-output">{tool.output}</pre>
      ) : null,
  };
}

function parseGrepHits(output: string | undefined): GrepHit[] {
  if (!output) return [];
  const hits: GrepHit[] = [];
  for (const raw of output.split("\n")) {
    const match = GREP_LINE.exec(raw);
    if (!match) continue;
    const path = match[1];
    const line = Number(match[2]);
    if (!path || !Number.isFinite(line)) continue;
    hits.push({ path, line, text: match[3] ?? "" });
  }
  return hits;
}

function findView(tool: ToolState): ToolView {
  const pattern = stringField(tool.args, "pattern");
  const searchPath = stringField(tool.args, "path");
  const files = tool.output ? tool.output.split("\n").filter((line) => line.length > 0) : [];

  return {
    title: (
      <>
        {pattern !== undefined && <code className="chip chip-code">{pattern}</code>}
        {searchPath !== undefined && <PathLink path={searchPath} label={searchPath === "." ? "cwd" : searchPath} />}
        <span className="chip">{files.length} file(s)</span>
      </>
    ),
    body:
      files.length > 0 ? (
        <div className="chips">
          {files.map((file) => (
            <PathLink key={file} path={file} />
          ))}
        </div>
      ) : tool.output ? (
        <pre className="tool-output">{tool.output}</pre>
      ) : null,
  };
}

function lsView(tool: ToolState): ToolView {
  const path = stringField(tool.args, "path");
  return {
    title: <PathLink path={path ?? "."} label={path ?? "cwd"} />,
    body: tool.output ? <pre className="tool-output">{tool.output}</pre> : null,
  };
}

// ---------------------------------------------------------------------------------------------
// unknown tools
// ---------------------------------------------------------------------------------------------

function genericView(tool: ToolState): ToolView {
  return {
    title: tool.args !== undefined ? <span className="chip chip-muted">args</span> : null,
    body: (
      <>
        {tool.args !== undefined && (
          <details className="tool-section">
            <summary>arguments</summary>
            <pre className="tool-output">{formatJson(tool.args)}</pre>
          </details>
        )}
        {tool.output !== undefined && (
          <details className="tool-section" open={tool.isError}>
            <summary>{tool.isError ? "error" : "result"}</summary>
            <pre className="tool-output">{tool.output}</pre>
          </details>
        )}
        {tool.fullOutputPath !== undefined && (
          <div className="tool-actions">
            <PathLink path={tool.fullOutputPath} label="Open full output" className="path-link-action" />
          </div>
        )}
      </>
    ),
  };
}

function StatusBadge({ status, durationMs }: { status: ToolStatus; durationMs?: number }): JSX.Element {
  const label = status === "running" ? "running" : status === "error" ? "failed" : "done";
  return (
    <span className="tool-status">
      {label}
      {durationMs !== undefined ? ` · ${Math.round(durationMs)}ms` : ""}
    </span>
  );
}
