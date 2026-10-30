import { diffLines } from "diff";

/** One rendered diff line. `line` always points at the new-file line when known. */
export interface DiffRow {
  kind: "add" | "delete" | "context" | "skip";
  line?: number;
  text: string;
}

/**
 * Preview diff for `edit` calls that are still running (plan 7.7).
 *
 * The preview is computed from `args.edits[]` only, matching oldText/newText per edit. It cannot
 * know the real position in the file, so rows carry no line numbers; the authoritative replacement
 * arrives with `result.details.diff` once the tool finishes.
 */
export function previewDiff(oldText: string, newText: string, context = 3): DiffRow[] {
  const parts = diffLines(oldText, newText);
  const rows: DiffRow[] = [];

  for (const part of parts) {
    const lines = part.value.split("\n");
    if (lines[lines.length - 1] === "") lines.pop();
    for (const text of lines) {
      if (part.added) rows.push({ kind: "add", text });
      else if (part.removed) rows.push({ kind: "delete", text });
      else rows.push({ kind: "context", text });
    }
  }

  return collapseContext(rows, context);
}

const ADD = /^\+(\d+) (.*)$/;
const DELETE = /^-(\d+) (.*)$/;
const CONTEXT = /^ (\d+) (.*)$/;
const SKIP = /^ +\d*\s*\.\.\.$/;

/**
 * Parses `EditToolDetails.diff`, pi's display-oriented diff
 * (`packages/coding-agent/src/core/tools/edit-diff.ts: generateDiffString`).
 *
 * Format: `+<newLine> text`, `-<oldLine> text`, ` <line> text`, and `<spaces> ...` for skipped
 * context. Using the tool's own diff keeps the GUI in sync with pi's fuzzy match and line numbers.
 */
export function parseDetailsDiff(diff: string): DiffRow[] {
  const rows: DiffRow[] = [];
  for (const raw of diff.split("\n")) {
    const add = ADD.exec(raw);
    if (add) {
      rows.push({ kind: "add", line: Number(add[1]), text: add[2] ?? "" });
      continue;
    }
    const del = DELETE.exec(raw);
    if (del) {
      rows.push({ kind: "delete", line: Number(del[1]), text: del[2] ?? "" });
      continue;
    }
    const context = CONTEXT.exec(raw);
    if (context) {
      rows.push({ kind: "context", line: Number(context[1]), text: context[2] ?? "" });
      continue;
    }
    if (SKIP.test(raw)) {
      rows.push({ kind: "skip", text: "…" });
      continue;
    }
    if (raw.length > 0) rows.push({ kind: "context", text: raw });
  }
  return rows;
}

/** Keeps `context` lines around every change and folds the rest into a skip row. */
function collapseContext(rows: DiffRow[], context: number): DiffRow[] {
  const out: DiffRow[] = [];
  let index = 0;

  while (index < rows.length) {
    const row = rows[index];
    if (!row || row.kind !== "context") {
      if (row) out.push(row);
      index += 1;
      continue;
    }

    let end = index;
    while (end < rows.length && rows[end]?.kind === "context") end += 1;
    const run = end - index;
    const hasBefore = index > 0;
    const hasAfter = end < rows.length;
    const hidden = run - context * 2;

    if (hasBefore && hasAfter && hidden > 0) {
      for (let i = index; i < index + context; i += 1) push(out, rows[i]);
      out.push({ kind: "skip", text: `${hidden} unchanged lines` });
      for (let i = end - context; i < end; i += 1) push(out, rows[i]);
    } else if (!hasBefore && hasAfter && run > context) {
      const start = end - context;
      out.push({ kind: "skip", text: `${start - index} unchanged lines` });
      for (let i = start; i < end; i += 1) push(out, rows[i]);
    } else if (hasBefore && !hasAfter && run > context) {
      for (let i = index; i < index + context; i += 1) push(out, rows[i]);
      out.push({ kind: "skip", text: `${run - context} unchanged lines` });
    } else {
      for (let i = index; i < end; i += 1) push(out, rows[i]);
    }
    index = end;
  }

  return out;
}

function push(out: DiffRow[], row: DiffRow | undefined): void {
  if (row) out.push(row);
}
