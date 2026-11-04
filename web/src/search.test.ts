import { describe, expect, it } from "vitest";
import type { ChatMessage } from "./state/sessionReducer";
import {
  compileQuery,
  findMatches,
  messageSearchText,
  messageTextBlocks,
  searchMessages,
  selectedSearchSeed,
} from "./search";

const defaults = { caseSensitive: false, wholeWord: false, regex: false };

function message(id: string, role: ChatMessage["role"], blocks: ChatMessage["blocks"]): ChatMessage {
  return { id, role, blocks, timestamp: 1, streaming: false };
}

describe("compileQuery", () => {
  it("returns a null regexp without error for empty queries", () => {
    const compiled = compileQuery("", defaults);
    expect(compiled.regexp).toBeNull();
    expect(compiled.error).toBeNull();
  });

  it("escapes literal-mode metacharacters", () => {
    const matches = findMatches("a.b a b aXb", compileQuery("a.b", defaults));
    expect(matches).toEqual([{ start: 0, end: 3 }]);
  });

  it("rejects invalid regex patterns with an error", () => {
    const compiled = compileQuery("(", { ...defaults, regex: true });
    expect(compiled.regexp).toBeNull();
    expect(compiled.error).toContain("正则");
  });

  it("wraps whole-word queries in word boundaries", () => {
    const text = "cat catalog Cat category";
    expect(findMatches(text, compileQuery("cat", { ...defaults, wholeWord: true }))).toEqual([
      { start: 0, end: 3 },
      { start: 12, end: 15 },
    ]);
  });

  it("applies word boundaries to regex mode too", () => {
    const matches = findMatches("abc ab", compileQuery("ab", { ...defaults, wholeWord: true, regex: true }));
    expect(matches).toEqual([{ start: 4, end: 6 }]);
  });
});

describe("findMatches", () => {
  it("is case-insensitive by default and case-sensitive on request", () => {
    const text = "Error error ERROR";
    expect(findMatches(text, compileQuery("error", defaults))).toHaveLength(3);
    expect(findMatches(text, compileQuery("error", { ...defaults, caseSensitive: true }))).toEqual([
      { start: 6, end: 11 },
    ]);
  });

  it("supports regex quantifiers and classes", () => {
    const matches = findMatches("v1.2 和 v10.3", compileQuery("v\\d+\\.\\d", { ...defaults, regex: true }));
    expect(matches).toEqual([
      { start: 0, end: 4 },
      { start: 7, end: 12 },
    ]);
  });

  it("never loops forever on zero-length regex matches", () => {
    const matches = findMatches("ab", compileQuery("x*", { ...defaults, regex: true }));
    expect(matches).toEqual([]);
  });
});

describe("messageSearchText", () => {
  it("joins text blocks with blank lines and tracks offsets", () => {
    const msg = message("m1", "user", [
      { kind: "text", text: "first" },
      { kind: "tool", callId: "t1", name: "bash" },
      { kind: "text", text: "second" },
    ]);
    expect(messageSearchText(msg)).toBe("first\n\nsecond");
    const blocks = messageTextBlocks(msg);
    expect(blocks.map(({ text, start }) => ({ text, start }))).toEqual([
      { text: "first", start: 0 },
      { text: "second", start: 7 },
    ]);
  });

  it("skips thinking blocks, images and non-searchable roles", () => {
    const assistant = message("a1", "assistant", [
      { kind: "thinking", text: "secret reasoning" },
      { kind: "text", text: "visible" },
    ]);
    expect(messageSearchText(assistant)).toBe("visible");
    const system = message("s1", "system", [{ kind: "text", text: "hidden" }]);
    expect(messageSearchText(system)).toBe("");
  });

  it("excludes inline <thinking> sections kept inside streamed text blocks", () => {
    const streamed = message("a2", "assistant", [
      { kind: "text", text: "<thinking>搜索功能在思考里</thinking>\n\n可见的搜索功能" },
    ]);
    expect(messageSearchText(streamed)).toBe("\n\n可见的搜索功能");
    const hits = searchMessages([streamed], compileQuery("搜索功能", defaults));
    expect(hits[0]?.matches).toEqual([{ start: 5, end: 9 }]);
  });
});

describe("searchMessages", () => {
  const messages: ChatMessage[] = [
    message("u1", "user", [{ kind: "text", text: "帮我看看 build 失败的原因" }]),
    message("a1", "assistant", [
      { kind: "thinking", text: "build 内部推理" },
      { kind: "tool", callId: "t1", name: "bash" },
      { kind: "text", text: "build 失败是因为缺依赖" },
    ]),
    message("a2", "assistant", [{ kind: "text", text: "没有匹配内容" }]),
  ];

  it("finds matches in user and assistant text blocks in transcript order", () => {
    const hits = searchMessages(messages, compileQuery("build", defaults));
    expect(hits.map((hit) => hit.messageId)).toEqual(["u1", "a1"]);
    expect(hits[0]?.matches).toEqual([{ start: 5, end: 10 }]);
    expect(hits[1]?.matches).toEqual([{ start: 0, end: 5 }]);
  });

  it("returns no hits for empty or non-matching queries", () => {
    expect(searchMessages(messages, compileQuery("", defaults))).toEqual([]);
    expect(searchMessages(messages, compileQuery("不存在", defaults))).toEqual([]);
  });

  it("keeps every occurrence inside one message", () => {
    const hits = searchMessages(messages, compileQuery("失", defaults));
    expect(hits).toHaveLength(2);
    expect(hits[0]?.matches).toHaveLength(1);
    expect(hits[1]?.matches).toHaveLength(1);
  });
});

describe("selectedSearchSeed", () => {
  function seedFor(anchor: Node | null, text: string): string | null {
    const selection = { toString: () => text, anchorNode: anchor } as unknown as Selection;
    return selectedSearchSeed(selection);
  }

  it("seeds from selections inside a rendered message", () => {
    document.body.innerHTML = `<article class="message message-user"><div class="markdown"><p>选中这段文字</p></div></article>`;
    const anchor = document.querySelector(".message .markdown p");
    expect(seedFor(anchor, "  选中这段 ")).toBe("选中这段");
  });

  it("ignores selections inside collapsed thinking sections", () => {
    document.body.innerHTML = `<article class="message"><details class="thinking"><pre>思考内容</pre></details></article>`;
    expect(seedFor(document.querySelector(".thinking pre"), "思考内容")).toBeNull();
  });

  it("ignores selections outside messages (composer, dialogs, search bar)", () => {
    document.body.innerHTML = `<div class="composer"><textarea>hi</textarea></div><div class="search-bar"><input /></div>`;
    expect(seedFor(document.querySelector(".composer textarea"), "hi")).toBeNull();
    expect(seedFor(document.querySelector(".search-bar input"), "hi")).toBeNull();
  });

  it("ignores empty or whitespace-only selections", () => {
    document.body.innerHTML = `<article class="message"><p>text</p></article>`;
    expect(seedFor(document.querySelector(".message p"), "   ")).toBeNull();
    expect(selectedSearchSeed(null)).toBeNull();
  });
});
