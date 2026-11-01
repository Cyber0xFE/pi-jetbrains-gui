import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import MarkdownIt from "markdown-it";
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import kotlin from "highlight.js/lib/languages/kotlin";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import { post } from "../bridge";
import { recordPerf } from "../perfLog";
import { copyText } from "./CopyButton";

hljs.registerLanguage("bash", bash);
hljs.registerLanguage("sh", bash);
hljs.registerLanguage("shell", bash);
hljs.registerLanguage("css", css);
hljs.registerLanguage("diff", diff);
hljs.registerLanguage("go", go);
hljs.registerLanguage("java", java);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("js", javascript);
hljs.registerLanguage("jsx", javascript);
hljs.registerLanguage("json", json);
hljs.registerLanguage("kotlin", kotlin);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("python", python);
hljs.registerLanguage("py", python);
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("ts", typescript);
hljs.registerLanguage("tsx", typescript);
hljs.registerLanguage("html", xml);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("yaml", yaml);
hljs.registerLanguage("yml", yaml);

function highlight(code: string, language: string): string {
  if (!language || !hljs.getLanguage(language)) return "";
  try {
    return hljs.highlight(code, { language, ignoreIllegals: true }).value;
  } catch {
    return "";
  }
}

function createRenderer(withHighlight: boolean, fileReferences: readonly string[]): MarkdownIt {
  const renderer = new MarkdownIt({
    // Model output is untrusted HTML: never let raw tags through.
    html: false,
    linkify: true,
    breaks: true,
    ...(withHighlight ? { highlight } : {}),
  });
  const references = [...fileReferences].sort((left, right) => right.length - left.length);
  renderer.inline.ruler.before("text", "file_reference", (state, silent) => {
    const preceding = state.src[state.pos - 1] ?? " ";
    if (!/[\s([{*_]/.test(preceding)) return false;
    for (const path of references) {
      if (!state.src.startsWith(`@${path}`, state.pos)) continue;
      const next = state.src[state.pos + path.length + 1] ?? "";
      if (next && /[A-Za-z0-9_./\\-]/.test(next)) continue;
      if (!silent) {
        const token = state.push("file_reference", "", 0);
        token.content = path;
      }
      state.pos += path.length + 1;
      return true;
    }
    return false;
  });
  renderer.renderer.rules.file_reference = (tokens, index) => {
    const path = tokens[index]?.content ?? "";
    const escaped = renderer.utils.escapeHtml(path);
    return `<button type="button" class="md-file-reference" data-file-path="${escaped}" title="Open ${escaped}">@${escaped}</button>`;
  };
  // Links must not navigate the JCEF page away from the chat; open them in the IDE instead.
  renderer.renderer.rules.link_open = (tokens, index, options, _env, self) => {
    const token = tokens[index];
    if (token) {
      token.attrSet("rel", "noreferrer");
      token.attrJoin("class", "md-link");
    }
    return self.renderToken(tokens, index, options);
  };
  return renderer;
}

const EMPTY_FILE_REFERENCES: readonly string[] = [];

/**
 * Markdown for assistant text.
 *
 * `streaming` is true while deltas arrive: rendering is throttled and syntax highlighting is
 * skipped (plan M2.5). A code fence that is still open is closed for display so the partial answer
 * renders as a code block instead of swallowing the rest of the message.
 */
export function Markdown({
  text,
  streaming,
  fileReferences = EMPTY_FILE_REFERENCES,
}: { text: string; streaming: boolean; fileReferences?: readonly string[] }): JSX.Element {
  const shown = useThrottled(text, STREAM_THROTTLE_MS, streaming);
  const renderer = useMemo(() => createRenderer(!streaming, fileReferences), [fileReferences, streaming]);
  const html = useMemo(() => {
    const startedAt = performance.now();
    const source = streaming ? closeOpenFence(shown) : text;
    const rendered = addCodeCopyButtons(renderer.render(source));
    recordPerf("markdown_render", performance.now() - startedAt, {
      chars: source.length,
      streaming: streaming ? 1 : 0,
    });
    return rendered;
  }, [renderer, shown, streaming, text]);

  const handleClick = (event: MouseEvent<HTMLDivElement>): void => {
    const target = event.target as HTMLElement | null;
    const fileReferenceButton = target?.closest<HTMLButtonElement>(".md-file-reference");
    const buttonPath = fileReferenceButton?.dataset.filePath;
    if (buttonPath) {
      event.preventDefault();
      post({ type: "open_path", path: buttonPath });
      return;
    }
    const copyButton = target?.closest<HTMLButtonElement>("[data-copy-code]");
    if (copyButton) {
      const code = copyButton.parentElement?.querySelector("pre")?.textContent ?? "";
      void copyText(code).then((success) => {
        if (!success) return;
        copyButton.innerHTML = codeCopyIcon(true);
        copyButton.title = "已复制";
        copyButton.setAttribute("aria-label", "已复制");
        window.setTimeout(() => {
          copyButton.innerHTML = codeCopyIcon();
          copyButton.title = "复制代码块";
          copyButton.setAttribute("aria-label", "复制代码块");
        }, 1200);
      });
      return;
    }

    const anchor = target?.closest("a");
    const href = anchor?.getAttribute("href");
    if (!href) return;
    if (/^https?:/i.test(href)) {
      event.preventDefault();
      post({ type: "open_url", url: href });
      return;
    }
    const fileReference = fileReferenceFromLink(href, anchor?.textContent ?? "");
    if (fileReference) {
      event.preventDefault();
      post({ type: "open_path", ...fileReference });
      return;
    }
    // `#anchor`-style links have no target in a single-document webview. Keep other schemes
    // from navigating the JCEF page away from the chat as well.
    if (/^[a-z][a-z\d+.-]*:/i.test(href)) event.preventDefault();
  };

  return <div className="markdown" onClick={handleClick} dangerouslySetInnerHTML={{ __html: html }} />;
}

type FileReference = { path: string; line?: number; endLine?: number };

/** Returns a project/absolute file reference, including an optional `:line[-endLine]` suffix. */
export function fileReferenceFromLink(href: string, label = ""): FileReference | null {
  const raw = href.trim();
  if (!raw || raw.startsWith("#") || raw.startsWith("//")) return null;

  if (/^file:/i.test(raw)) {
    try {
      const url = new URL(raw);
      if (url.protocol !== "file:") return null;
      const pathname = decodeURIComponent(url.pathname);
      if (!pathname) return null;
      const path = url.hostname && url.hostname !== "localhost" ? `//${url.hostname}${pathname}` : pathname;
      return withLocation(path, url.hash, label);
    } catch {
      return null;
    }
  }

  // Strip a fragment/query before decoding so links such as `src/main.kt#L12` still open the
  // file. A Windows drive letter is accepted as an absolute path even though it looks like a URI
  // scheme to the generic protocol check.
  const pathPart = raw.split(/[?#]/, 1)[0] ?? "";
  let path: string;
  try {
    path = decodeURIComponent(pathPart);
  } catch {
    path = pathPart;
  }
  if (!path || (/^[a-z][a-z\d+.-]*:/i.test(raw) && !/^[A-Za-z]:[\\/]/.test(path))) return null;
  return withLocation(path, raw.slice(pathPart.length), label);
}

function withLocation(path: string, suffix: string, label: string): FileReference | null {
  const pathLocation = parseLocationSuffix(path);
  const fragmentLocation = parseLocationFragment(suffix);
  const labelLocation = parseLocationSuffix(label);
  const location = pathLocation ?? fragmentLocation ?? labelLocation;
  const filePath = pathLocation?.path ?? path;
  if (!filePath) return null;
  const normalizedPath = /^\/[A-Za-z]:\//.test(filePath) || /^[A-Za-z]:\//.test(filePath)
    ? filePath.replace(/^\//, "")
    : filePath;
  // Some Markdown producers put only the start line in href and keep the complete range in
  // the link label. Preserve that end line when both references agree on the start line.
  const endLine = location?.endLine ?? (
    labelLocation?.line !== undefined && labelLocation.line === location?.line
      ? labelLocation.endLine
      : undefined
  );
  return location?.line === undefined
    ? { path: normalizedPath }
    : { path: normalizedPath, line: location.line, ...(endLine === undefined ? {} : { endLine }) };
}

function parseLocationSuffix(value: string): { path: string; line: number; endLine?: number } | null {
  const match = /^(.*?):(\d+)(?:-(\d+))?$/.exec(value.trim());
  if (!match?.[1]) return null;
  const line = Number(match[2]);
  const endLine = match[3] === undefined ? undefined : Number(match[3]);
  if (!Number.isSafeInteger(line) || line < 1 || (endLine !== undefined && (!Number.isSafeInteger(endLine) || endLine < line))) {
    return null;
  }
  return { path: match[1], line, ...(endLine === undefined ? {} : { endLine }) };
}

function parseLocationFragment(value: string): { line: number; endLine?: number } | null {
  const match = /^#L(\d+)(?:-L?(\d+))?$/i.exec(value.trim());
  if (!match) return null;
  const line = Number(match[1]);
  const endLine = match[2] === undefined ? undefined : Number(match[2]);
  if (!Number.isSafeInteger(line) || line < 1 || (endLine !== undefined && (!Number.isSafeInteger(endLine) || endLine < line))) {
    return null;
  }
  return { line, ...(endLine === undefined ? {} : { endLine }) };
}

function codeCopyIcon(copied = false): string {
  const shape = copied
    ? '<path d="m5 12 4 4L19 6" />'
    : '<rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" />';
  return `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shape}</svg>`;
}

function addCodeCopyButtons(html: string): string {
  return html.replace(
    /<pre(\b[^>]*)>([\s\S]*?)<\/pre>/g,
    (_match, attributes: string, body: string) =>
      `<div class="markdown-card"><button type="button" class="card-copy markdown-card-copy" data-copy-code="true" title="复制代码块" aria-label="复制代码块">${codeCopyIcon()}</button><pre${attributes}>${body}</pre></div>`,
  );
}

/** True when the text ends inside an unterminated fenced code block. */
export function closeOpenFence(text: string): string {
  let open: string | null = null;
  for (const line of text.split("\n")) {
    const match = /^\s*(`{3,}|~{3,})/.exec(line);
    if (!match) continue;
    const marker = match[1]?.charAt(0);
    if (!marker) continue;
    if (open === null) open = marker;
    else if (open === marker) open = null;
  }
  return open === null ? text : `${text}\n${open.repeat(3)}`;
}

/**
 * Leading-edge throttle: at most one update per `delay` ms while streaming, then the trailing
 * value. A plain trailing debounce would starve under a continuous token stream.
 */
function useThrottled(value: string, delay: number, enabled: boolean): string {
  const [snapshot, setSnapshot] = useState(value);
  const latest = useRef(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  latest.current = value;

  useEffect(() => {
    if (!enabled || timer.current !== null) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      setSnapshot(latest.current);
    }, delay);
  }, [value, delay, enabled]);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  return enabled ? snapshot : value;
}

const STREAM_THROTTLE_MS = 80;
