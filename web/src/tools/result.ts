/**
 * Loose parsing of pi's tool payloads (plan 7.6).
 *
 * Tool results are not a stable typed protocol: `bash` carries `output`,
 * `full_output_path` and truncation details, `read`/`grep` carry `content` text blocks plus
 * `details`, and extensions can return anything. Everything here is discriminant-free and
 * returns `undefined` instead of throwing so one odd tool cannot break the transcript.
 */

export type JsonObject = Record<string, unknown>;

export function asObject(value: unknown): JsonObject | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as JsonObject;
}

export function stringField(source: unknown, key: string): string | undefined {
  const value = asObject(source)?.[key];
  return typeof value === "string" ? value : undefined;
}

export function numberField(source: unknown, key: string): number | undefined {
  const value = asObject(source)?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function arrayField(source: unknown, key: string): unknown[] | undefined {
  const value = asObject(source)?.[key];
  return Array.isArray(value) ? value : undefined;
}

export interface ToolResultParts {
  /** Human-readable text extracted from `content` blocks. */
  text?: string;
  /** Structured `result.details` (edit diff, truncation info, ...). */
  details?: JsonObject;
  /** Full output file for truncated `bash`/tool output. */
  fullOutputPath?: string;
}

/** Splits a `tool_execution_end.result` / `tool_execution_update.partialResult`. */
export function toolResultParts(result: unknown): ToolResultParts {
  const object = asObject(result);
  if (!object) {
    return { text: typeof result === "string" ? result : undefined };
  }
  const details = asObject(object.details);
  const structured = asObject(object.structuredContent);
  const fullOutputPath =
    stringField(details, "fullOutputPath") ??
    stringField(details, "full_output_path") ??
    stringField(structured, "full_output_path");
  return { text: textOf(result), details, fullOutputPath };
}

/** Best-effort text extraction from the loosely typed payloads. */
export function textOf(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return value.length > 0 ? value : undefined;
  if (Array.isArray(value)) {
    const parts = value.map(textOf).filter((part): part is string => Boolean(part));
    return parts.length > 0 ? parts.join("\n") : undefined;
  }
  if (typeof value === "object") {
    const object = value as JsonObject;
    if (typeof object.output === "string") return object.output;
    if (Array.isArray(object.content)) {
      const nested = textOf(object.content);
      if (nested) return nested;
    }
    if (typeof object.text === "string") return object.text;
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return undefined;
    }
  }
  return String(value);
}

/** JSON with stable formatting, used by the generic tool card. */
export function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}
