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

function createRenderer(withHighlight: boolean): MarkdownIt {
  const renderer = new MarkdownIt({
    // Model output is untrusted HTML: never let raw tags through.
    html: false,
    linkify: true,
    breaks: true,
    ...(withHighlight ? { highlight } : {}),
  });
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

const streamingRenderer = createRenderer(false);
const finalRenderer = createRenderer(true);

/**
 * Markdown for assistant text.
 *
 * `streaming` is true while deltas arrive: rendering is throttled and syntax highlighting is
 * skipped (plan M2.5). A code fence that is still open is closed for display so the partial answer
 * renders as a code block instead of swallowing the rest of the message.
 */
export function Markdown({ text, streaming }: { text: string; streaming: boolean }): JSX.Element {
  const shown = useThrottled(text, STREAM_THROTTLE_MS, streaming);
  const html = useMemo(() => {
    if (!streaming) return finalRenderer.render(text);
    return streamingRenderer.render(closeOpenFence(shown));
  }, [shown, streaming, text]);

  const handleClick = (event: MouseEvent<HTMLDivElement>): void => {
    const anchor = (event.target as HTMLElement | null)?.closest("a");
    const href = anchor?.getAttribute("href");
    if (!href) return;
    // `#anchor`-style links have no target in a single-document webview.
    if (!/^[a-z]+:/i.test(href)) return;
    event.preventDefault();
    if (/^https?:/i.test(href)) post({ type: "open_url", url: href });
  };

  return <div className="markdown" onClick={handleClick} dangerouslySetInnerHTML={{ __html: html }} />;
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
