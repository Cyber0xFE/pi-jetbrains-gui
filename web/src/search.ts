import { normalizeTaggedBlocks, type Block, type ChatMessage } from "./state/sessionReducer";

export interface SearchOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
}

/** Full search panel state owned by `App`; `open` only controls bar visibility. */
export interface SearchState extends SearchOptions {
  open: boolean;
  query: string;
}

export const EMPTY_SEARCH: SearchState = {
  open: false,
  query: "",
  caseSensitive: false,
  wholeWord: false,
  regex: false,
};

export interface CompiledQuery {
  regexp: RegExp | null;
  /** Localized error text when the query is not usable (e.g. invalid regex). */
  error: string | null;
}

export interface SearchMatch {
  start: number;
  end: number;
}

export interface MessageSearchHit {
  messageId: string;
  messageIndex: number;
  role: ChatMessage["role"];
  matches: SearchMatch[];
}

/** Upper bound so a pathological regex cannot freeze the JCEF UI thread. */
const MAX_MATCHES = 2000;

/**
 * Compiles the query into a global RegExp. Literal mode escapes the query; whole-word mode wraps
 * it in `\b` guards (also applied around a user-supplied regex). Returns a null regexp (no error)
 * for empty queries and an error message for invalid regex patterns.
 */
export function compileQuery(query: string, options: SearchOptions): CompiledQuery {
  if (query.length === 0) return { regexp: null, error: null };
  const flags = `g${options.caseSensitive ? "" : "i"}`;
  let source: string;
  if (options.regex) {
    try {
      new RegExp(query); // validity probe; throws on bad patterns
    } catch {
      return { regexp: null, error: "无效的正则表达式" };
    }
    source = query;
  } else {
    source = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  if (options.wholeWord) source = `\\b(?:${source})\\b`;
  return { regexp: new RegExp(source, flags), error: null };
}

/** Collects non-overlapping matches; guards against zero-length regex matches. */
export function findMatches(text: string, compiled: CompiledQuery): SearchMatch[] {
  const regexp = compiled.regexp;
  if (!regexp || text.length === 0) return [];
  const matches: SearchMatch[] = [];
  const global = new RegExp(regexp.source, regexp.flags.includes("g") ? regexp.flags : `${regexp.flags}g`);
  let match: RegExpExecArray | null;
  while ((match = global.exec(text)) !== null) {
    if (match[0].length === 0) {
      global.lastIndex += 1;
      if (global.lastIndex > text.length) break;
      continue;
    }
    matches.push({ start: match.index, end: match.index + match[0].length });
    if (matches.length >= MAX_MATCHES) break;
  }
  return matches;
}

/** Only user and assistant text blocks are searchable; tools, thinking and images are not. */
export function isSearchableMessage(message: ChatMessage): message is ChatMessage & { role: "user" | "assistant" } {
  return message.role === "user" || message.role === "assistant";
}

export interface PositionedTextBlock {
  block: Extract<Block, { kind: "text" }>;
  text: string;
  /** Offset of this block's text inside `messageSearchText(message)`. */
  start: number;
}

/** Text blocks with their offsets inside the concatenated search text (joined by `\n\n`). */
export function messageTextBlocks(message: ChatMessage): PositionedTextBlock[] {
  if (!isSearchableMessage(message)) return [];
  // Split inline `<thinking>` tags exactly like the renderer does, so matches hidden inside a
  // collapsed thinking section are not counted against the visible transcript.
  const blocks: PositionedTextBlock[] = [];
  let offset = 0;
  for (const block of normalizeTaggedBlocks(message.blocks)) {
    if (block.kind !== "text") continue;
    if (blocks.length > 0) offset += 2;
    blocks.push({ block, text: block.text, start: offset });
    offset += block.text.length;
  }
  return blocks;
}

/** Searchable content of one message: its text blocks joined by `\n\n`. */
export function messageSearchText(message: ChatMessage): string {
  return messageTextBlocks(message)
    .map(({ text }) => text)
    .join("\n\n");
}

/** Runs the query over every searchable message, in transcript order. */
export function searchMessages(messages: ChatMessage[], compiled: CompiledQuery): MessageSearchHit[] {
  const hits: MessageSearchHit[] = [];
  messages.forEach((message, messageIndex) => {
    if (!isSearchableMessage(message)) return;
    const matches = findMatches(messageSearchText(message), compiled);
    if (matches.length > 0) hits.push({ messageId: message.id, messageIndex, role: message.role, matches });
  });
  return hits;
}
