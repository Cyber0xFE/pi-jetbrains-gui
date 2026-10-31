/**
 * Loose parsing of pi's tool payloads (plan 7.6).
 *
 * Tool results are not a stable typed protocol: `bash` carries `output`,
 * `full_output_path` and truncation details, `read`/`grep` carry `content` text blocks plus
 * `details`, and extensions can return anything. Everything here is discriminant-free and
 * returns `undefined` instead of throwing so one odd tool cannot break the transcript.
 */

export type JsonObject = Record<string, unknown>;

/** Keep a second safety limit in the renderer even if the host-side limit is bypassed. */
export const MAX_TOOL_DISPLAY_CHARS = 256 * 1024;
export const MAX_DIFF_INPUT_CHARS = 64 * 1024;

export function truncateToolText(value: string, maxChars = MAX_TOOL_DISPLAY_CHARS): string {
  if (value.length <= maxChars) return value;
  const suffix = `\n[… output truncated for UI; ${value.length.toLocaleString()} chars total …]`;
  return `${value.slice(0, Math.max(0, maxChars - suffix.length))}${suffix}`;
}

/** Bounds retained tool arguments/details as well as their final DOM representation. */
export function truncateToolValue(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return truncateToolText(value, MAX_DIFF_INPUT_CHARS);
  if (depth >= 5 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.slice(0, 1000).map((item) => truncateToolValue(item, depth + 1));
  const object = value as Record<string, unknown>;
  return Object.fromEntries(Object.entries(object).map(([key, item]) => [key, truncateToolValue(item, depth + 1)]));
}

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
  /** True when the host replaced an oversized result with a summary. */
  outputTruncated?: boolean;
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
  const text = textOf(result);
  const truncatedText = text === undefined ? undefined : truncateToolText(text);
  return {
    text: truncatedText,
    details,
    fullOutputPath,
    outputTruncated:
      object.outputTruncated === true || object.output_truncated === true || truncatedText !== text,
  };
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
