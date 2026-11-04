import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MessageList } from "./MessageList";
import type { ChatMessage } from "../state/sessionReducer";
import { initialState, reduce } from "../state/sessionReducer";
import type { AssistantDelta } from "../types";

it("opens sent images in a dismissible preview", () => {
  const view = render(
    <MessageList
      messages={[{
        id: "image-message",
        role: "assistant",
        blocks: [{ kind: "image", data: "aGVsbG8=", mimeType: "image/png" }],
        timestamp: 1,
        streaming: false,
      }]}
      tools={{}}
      loadingHistory={false}
      emptyHint=""
      thinkingLabel={null}
      connecting={false}
    />,
  );

  fireEvent.click(view.getByRole("button", { name: "Preview image" }));
  expect(view.getByRole("dialog", { name: "Image preview" })).toBeDefined();
  expect(view.getByRole("button", { name: "Close image preview" })).toBeDefined();

  fireEvent.keyDown(window, { key: "Escape" });
  expect(view.queryByRole("dialog", { name: "Image preview" })).toBeNull();
});

it("renders sent user-message images as a thumbnail and previews the full image on click", () => {
  const view = render(
    <MessageList
      messages={[{
        id: "user-image-message",
        role: "user",
        blocks: [{ kind: "image", data: "aGVsbG8=", mimeType: "image/png" }],
        timestamp: 1,
        streaming: false,
      }]}
      tools={{}}
      loadingHistory={false}
      emptyHint=""
      thinkingLabel={null}
      connecting={false}
    />,
  );

  const trigger = view.getByRole("button", { name: "Preview image" });
  const thumbnail = trigger.querySelector("img");
  expect(thumbnail).toBeDefined();
  expect(thumbnail?.className).toContain("message-image-thumbnail");

  fireEvent.click(trigger);
  const preview = view.getByRole("dialog", { name: "Image preview" });
  const fullImage = preview.querySelector("img");
  expect(fullImage?.className).not.toContain("message-image-thumbnail");
  expect(fullImage?.getAttribute("src")).toBe("data:image/png;base64,aGVsbG8=");
});

it("shows an omitted-image placeholder for empty image payloads", () => {
  const view = render(
    <MessageList
      messages={[{
        id: "omitted-image-message",
        role: "assistant",
        blocks: [{ kind: "image", data: "", mimeType: "image/png" }],
        timestamp: 1,
        streaming: false,
      }]}
      tools={{}}
      loadingHistory={false}
      emptyHint=""
      thinkingLabel={null}
      connecting={false}
    />,
  );

  expect(view.getByText("图片过大，未在会话视图中加载")).toBeDefined();
  expect(view.queryByRole("button", { name: "Preview image" })).toBeNull();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each([
  { text: "再来一个200字左右的", expected: "再来一个200字左右的" },
  { text: "--- src/main.ts:1-2 (buffer) ---\nconst x = 1;\nconst y = 2;\n\n解释这段代码", expected: "解释这段代码" },
])("copies user message text with feedback: $expected", async ({ text, expected }) => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", Object.create(navigator, { clipboard: { value: { writeText } } }));
  const messages: ChatMessage[] = [{
    id: "user-1", role: "user", blocks: [{ kind: "text", text }], timestamp: 1, streaming: false,
  }];
  const view = render(<MessageList messages={messages} tools={{}} loadingHistory={false}
    emptyHint="" thinkingLabel={null} connecting={false} />);
  const button = view.getByRole("button", { name: "复制用户消息" });
  expect(button.title).toBe("复制用户消息");
  expect(button.textContent).toBe("");
  expect(button.querySelector("svg")).not.toBeNull();
  expect(button.parentElement?.classList.contains("message-user-content")).toBe(true);
  await act(async () => { fireEvent.click(button); });
  expect(writeText).toHaveBeenCalledWith(expected);
  expect(view.getByRole("button", { name: "已复制" })).toBeDefined();
});

it("renders user message Windows paths with backslashes intact", () => {
  const view = render(
    <MessageList
      messages={[{
        id: "user-path",
        role: "user",
        blocks: [{ kind: "text", text: "我刚才打开 @C:\\Users\\Bebop\\.pi\\agent\\models-store.json 怎么还有?" }],
        timestamp: 1,
        streaming: false,
      }]}
      tools={{}}
      loadingHistory={false}
      emptyHint=""
      thinkingLabel={null}
      connecting={false}
    />,
  );
  expect(view.container.querySelector(".message-user-content")?.textContent).toContain("Bebop\\.pi\\agent");
});

it("renders file-only editor context as a clickable file chip", () => {
  const view = render(
    <MessageList
      messages={[{
        id: "context-only",
        role: "user",
        blocks: [{ kind: "text", text: "--- scripts/dump-rpc-schema.ts:8-18 ---\n" }],
        timestamp: 1,
        streaming: false,
      }]}
      tools={{}}
      loadingHistory={false}
      emptyHint=""
      thinkingLabel={null}
      connecting={false}
    />,
  );

  expect(view.getByRole("button", { name: "Open scripts/dump-rpc-schema.ts and select lines 8-18" })).toBeDefined();
  expect(view.container.querySelector(".message-editor-context")).not.toBeNull();
  expect(view.container.querySelector(".message-user-body")).toBeNull();
  expect(view.queryByText("--- scripts/dump-rpc-schema.ts:8-18 ---")).toBeNull();
});

it("collapses expanded skill instructions and keeps the user request visible", () => {
  const text = [
    '<skill name="drawio-skill" location="C:\\Users\\Bebop\\.pi\\skills\\drawio-skill\\SKILL.md">',
    "References are relative to C:\\Users\\Bebop\\.pi\\skills\\drawio-skill.",
    "",
    "# Draw.io Diagrams",
    "\nDetailed skill instructions.",
    "</skill>",
    "",
    "画一下系统架构图",
  ].join("\n");
  const view = render(
    <MessageList
      messages={[{ id: "skill-1", role: "user", blocks: [{ kind: "text", text }], timestamp: 1, streaming: false }]}
      tools={{}}
      loadingHistory={false}
      emptyHint=""
      thinkingLabel={null}
      connecting={false}
    />,
  );

  const details = view.container.querySelector<HTMLDetailsElement>("details.skill-invocation");
  expect(details).not.toBeNull();
  expect(details?.open).toBe(false);
  expect(view.getByText("[skill]")).toBeDefined();
  expect(view.getByText("drawio-skill")).toBeDefined();
  expect(view.getByText("画一下系统架构图")).toBeDefined();
  expect(view.queryByText("Draw.io Diagrams")).toBeNull();

  fireEvent.click(view.getByText("(click to expand)"));
  expect(details?.open).toBe(true);
  expect(view.container.querySelector("h1")?.textContent).toContain("Draw.io Diagrams");
  expect(view.getByText("(click to collapse)")).toBeDefined();
});

it("shows the thinking status icon, streaming ellipsis and completed duration", () => {
  const view = render(
    <MessageList
      messages={[
        {
          id: "thinking-stream",
          role: "assistant",
          blocks: [{ kind: "thinking", text: "still working" }],
          timestamp: 1,
          streaming: true,
        },
        {
          id: "thinking-done",
          role: "assistant",
          blocks: [{ kind: "thinking", text: "finished", completed: true }],
          timestamp: 2,
          streaming: false,
          durationMs: 21_000,
        },
      ]}
      tools={{}}
      loadingHistory={false}
      emptyHint=""
      thinkingLabel={null}
      connecting={false}
    />,
  );

  expect(view.getByText("正在思考")).toBeDefined();
  expect(view.getByText("已思考")).toBeDefined();
  expect(view.getByText("（用时 21 秒）")).toBeDefined();
  expect(view.container.querySelectorAll(".thinking-icon")).toHaveLength(2);
  expect(view.container.querySelectorAll("animateTransform")).toHaveLength(1);
  const spinningCircle = view.container.querySelector("animateTransform")!.parentElement!.querySelector("circle")!;
  expect(spinningCircle.getAttribute("stroke-dasharray")).not.toBeNull();
  const staticCircles = view.container.querySelectorAll(".thinking-icon circle:not([stroke-dasharray])");
  expect(staticCircles).toHaveLength(1);
  expect(view.container.querySelectorAll(".thinking-ellipsis")).toHaveLength(1);
});

it.each([
  {
    name: "tagged thinking with a closing tag split across chunks",
    start: { type: "text_delta", contentIndex: 0, delta: "<thinking>reasoning" },
    finish: [
      { type: "text_delta", contentIndex: 0, delta: "</think" },
      { type: "text_delta", contentIndex: 0, delta: "ing>" },
    ],
    answer: { type: "text_delta", contentIndex: 0, delta: "answer" },
  },
  {
    name: "native thinking with an explicit end",
    start: { type: "thinking_delta", contentIndex: 0, delta: "reasoning" },
    finish: [{ type: "thinking_end", contentIndex: 0 }],
    answer: { type: "text_delta", contentIndex: 1, delta: "answer" },
  },
  {
    name: "native thinking followed by text_start without thinking_end",
    start: { type: "thinking_delta", contentIndex: 0, delta: "reasoning" },
    finish: [{ type: "text_start", contentIndex: 1 }],
    answer: { type: "text_delta", contentIndex: 1, delta: "answer" },
  },
  {
    name: "native thinking followed directly by answer text",
    start: { type: "thinking_delta", contentIndex: 0, delta: "reasoning" },
    finish: [{ type: "text_delta", contentIndex: 1, delta: "answer" }],
    answer: { type: "text_delta", contentIndex: 1, delta: " continues" },
  },
  {
    name: "native thinking followed by a tool call",
    start: { type: "thinking_delta", contentIndex: 0, delta: "reasoning" },
    finish: [{ type: "toolcall_start", contentIndex: 1, id: "read-1", toolName: "read" }],
    answer: { type: "text_delta", contentIndex: 2, delta: "answer" },
  },
])("finishes $name while the assistant keeps streaming", ({ start, finish, answer }) => {
  let state = reduce(initialState, {
    kind: "inbound",
    message: {
      type: "records",
      records: [{ type: "message_start", message: { role: "assistant", timestamp: 1, content: [] } }],
    },
  });
  const update = (delta: AssistantDelta): void => {
    state = reduce(state, {
      kind: "inbound",
      message: { type: "records", records: [{ type: "message_update", assistantMessageEvent: delta }] },
    });
  };
  const transcript = (): JSX.Element => (
    <MessageList messages={state.messages} tools={state.tools} loadingHistory={false}
      emptyHint="" thinkingLabel={null} connecting={false} />
  );
  update(start);
  const view = render(transcript());
  expect(view.getByText("正在思考")).toBeDefined();
  expect(view.container.querySelector(".thinking-ellipsis")).not.toBeNull();

  finish.forEach(update);
  view.rerender(transcript());
  expect(state.messages[0]?.streaming).toBe(true);
  expect(view.getByText("已思考")).toBeDefined();
  expect(view.queryByText("正在思考")).toBeNull();
  expect(view.container.querySelector(".thinking-ellipsis")).toBeNull();

  update(answer);
  view.rerender(transcript());
  expect(state.messages[0]?.streaming).toBe(true);
  expect(view.getByText("已思考")).toBeDefined();
  expect(view.container.querySelector(".thinking-ellipsis")).toBeNull();
});

it("shows scroll hints only in directions with more user messages", () => {
  const messages: ChatMessage[] = Array.from({ length: 20 }, (_, index) => ({
    id: `user-${index}`, role: "user", blocks: [{ kind: "text", text: `Message ${index}` }],
    timestamp: index, streaming: false,
  }));
  const view = render(<MessageList messages={messages} tools={{}} loadingHistory={false}
    emptyHint="" thinkingLabel={null} connecting={false} />);
  const track = view.container.querySelector<HTMLElement>(".message-outline-track")!;
  Object.defineProperties(track, {
    scrollHeight: { configurable: true, value: 600 },
    clientHeight: { value: 400 },
  });
  const scrollBy = vi.fn();
  track.scrollBy = scrollBy;
  fireEvent.scroll(track);
  expect(view.queryByRole("button", { name: "向上浏览用户消息" })).toBeNull();
  fireEvent.click(view.getByRole("button", { name: "向下浏览用户消息" }));
  expect(scrollBy).toHaveBeenCalledWith({ top: 81, behavior: "smooth" });

  track.scrollTop = 100;
  fireEvent.scroll(track);
  expect(view.getByRole("button", { name: "向上浏览用户消息" })).toBeDefined();
  expect(view.getByRole("button", { name: "向下浏览用户消息" })).toBeDefined();

  track.scrollTop = 200;
  fireEvent.scroll(track);
  expect(view.queryByRole("button", { name: "向下浏览用户消息" })).toBeNull();
  expect(view.getByRole("button", { name: "向上浏览用户消息" })).toBeDefined();

  Object.defineProperty(track, "scrollHeight", { value: 400 });
  track.scrollTop = 0;
  fireEvent.scroll(track);
  expect(view.queryByRole("button", { name: "向上浏览用户消息" })).toBeNull();
});

it("keeps streaming updates from pulling an upward wheel gesture back to the bottom", () => {
  let now = 0;
  let frameId = 0;
  const frames = new Map<number, FrameRequestCallback>();
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    frames.set(++frameId, callback);
    return frameId;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => { frames.delete(id); });
  const props = {
    messages: [], tools: {}, loadingHistory: false, emptyHint: "", thinkingLabel: null, connecting: false,
  };
  const view = render(<MessageList {...props} />);
  const log = view.getByRole("log");
  Object.defineProperties(log, {
    scrollHeight: { value: 2000 },
    clientHeight: { value: 400 },
  });
  log.scrollTop = 1600;
  fireEvent.wheel(log, { deltaY: -10 });
  // A streaming update can arrive before the first animation frame.
  view.rerender(<MessageList {...props} tools={{}} />);
  expect(log.scrollTop).toBe(1600);

  for (let step = 0; frames.size && step < 120; step += 1) {
    act(() => {
      now += 16;
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((callback) => callback(now));
      fireEvent.scroll(log);
    });
    if (1600 - log.scrollTop >= 17) break;
  }
  expect(log.scrollTop).toBeLessThan(1600);
  // Still within the old 48px bottom threshold: reading upward must disable following.
  const readingPosition = log.scrollTop;
  view.rerender(<MessageList {...props} tools={{}} />);
  expect(log.scrollTop).toBe(readingPosition);
});

it("returns to the latest message when a prompt is sent while reading upward", async () => {
  const props = {
    messages: [{
      id: "user-1", role: "user" as const, blocks: [{ kind: "text" as const, text: "Question" }],
      timestamp: 1, streaming: false,
    }],
    tools: {}, loadingHistory: false, emptyHint: "", thinkingLabel: null, connecting: false,
  };
  const view = render(<MessageList {...props} scrollToLatestRequest={0} />);
  const log = view.getByRole("log");
  Object.defineProperties(log, {
    scrollHeight: { configurable: true, value: 2000 },
    clientHeight: { configurable: true, value: 400 },
  });
  log.scrollTop = 600;
  fireEvent.scroll(log);
  await waitFor(() => expect(view.getByRole("button", { name: "Back to latest" })).toBeDefined());

  view.rerender(<MessageList {...props} scrollToLatestRequest={1} />);

  expect(log.scrollTop).toBe(2000);
  expect(view.queryByRole("button", { name: "Back to latest" })).toBeNull();
});

it("reuses navigation offsets while scrolling and keeps the latest button outside the transcript layout", () => {
  let pending: FrameRequestCallback | null = null;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    pending = callback;
    return 1;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => { pending = null; });
  const messages: ChatMessage[] = Array.from({ length: 3 }, (_, index) => ({
    id: `user-${index}`, role: "user", blocks: [{ kind: "text", text: `Question ${index}` }],
    timestamp: index, streaming: false,
  }));
  const props = { messages, tools: {}, loadingHistory: false, emptyHint: "", thinkingLabel: null, connecting: false };
  const view = render(<MessageList {...props} />);
  const log = view.getByRole("log");
  Object.defineProperties(log, { scrollHeight: { value: 2000 }, clientHeight: { value: 400 } });
  const positions = Array.from(log.querySelectorAll(".message-user"), (message, index) => {
    const read = vi.fn(() => index * 600);
    Object.defineProperty(message, "offsetTop", { get: read });
    return read;
  });
  const scroll = (top: number): void => {
    log.scrollTop = top;
    fireEvent.scroll(log);
    act(() => { pending?.(16); });
  };
  scroll(650);
  positions.forEach((read) => expect(read).toHaveBeenCalledTimes(1));
  scroll(700);
  scroll(800);
  positions.forEach((read) => expect(read).toHaveBeenCalledTimes(1));
  const latest = view.getByRole("button", { name: "Back to latest" });
  expect(log.contains(latest)).toBe(false);
  expect(view.getByRole("button", { name: "Jump to user message 2: Question 1" }).getAttribute("aria-current")).toBe("location");

  // A content update invalidates the positions for the next scroll.
  view.rerender(<MessageList {...props} messages={[...messages]} />);
  scroll(1250);
  positions.forEach((read) => expect(read).toHaveBeenCalledTimes(2));
  expect(view.getByRole("button", { name: "Jump to user message 3: Question 2" }).getAttribute("aria-current")).toBe("location");
});

it("jumps to the previous and next user message on navigation requests", () => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
  const message = (id: string, role: "user" | "assistant", text: string, timestamp: number): ChatMessage => ({
    id, role, blocks: [{ kind: "text", text }], timestamp, streaming: false,
  });
  const messages: ChatMessage[] = [
    message("user-0", "user", "Question 0", 0),
    message("assistant-0", "assistant", "Answer 0", 1),
    message("user-1", "user", "Question 1", 2),
    message("assistant-1", "assistant", "Answer 1", 3),
    message("user-2", "user", "Question 2", 4),
  ];
  const props = { messages, tools: {}, loadingHistory: false, emptyHint: "", thinkingLabel: null, connecting: false };
  const view = render(<MessageList {...props} previousUserMessageRequest={0} nextUserMessageRequest={0} />);
  const log = view.getByRole("log");
  Object.defineProperties(log, { scrollHeight: { configurable: true, value: 3000 }, clientHeight: { configurable: true, value: 400 } });
  log.scrollTop = 1200;
  Array.from(log.querySelectorAll(".message-user")).forEach((element, index) => {
    Object.defineProperty(element, "offsetTop", { configurable: true, value: index * 600 });
  });
  expect(view.getByRole("button", { name: "Jump to user message 3: Question 2" }).getAttribute("aria-current")).toBe("location");

  view.rerender(<MessageList {...props} previousUserMessageRequest={1} nextUserMessageRequest={0} />);
  expect(view.getByRole("button", { name: "Jump to user message 2: Question 1" }).getAttribute("aria-current")).toBe("location");

  // Simulate the viewport following the jump, then navigate forward again.
  log.scrollTop = 600;
  view.rerender(<MessageList {...props} previousUserMessageRequest={1} nextUserMessageRequest={1} />);
  expect(view.getByRole("button", { name: "Jump to user message 3: Question 2" }).getAttribute("aria-current")).toBe("location");
});

it("steps up to the closest user message the viewport has scrolled past", () => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
  const message = (id: string, role: "user" | "assistant", text: string, timestamp: number): ChatMessage => ({
    id, role, blocks: [{ kind: "text", text }], timestamp, streaming: false,
  });
  const messages: ChatMessage[] = [
    message("user-0", "user", "Question 0", 0),
    message("assistant-0", "assistant", "Answer 0", 1),
    message("user-1", "user", "Question 1", 2),
    message("assistant-1", "assistant", "Answer 1", 3),
  ];
  const props = { messages, tools: {}, loadingHistory: false, emptyHint: "", thinkingLabel: null, connecting: false };
  const view = render(<MessageList {...props} previousUserMessageRequest={0} nextUserMessageRequest={0} />);
  const log = view.getByRole("log");
  Object.defineProperties(log, { scrollHeight: { configurable: true, value: 3000 }, clientHeight: { configurable: true, value: 400 } });
  Array.from(log.querySelectorAll(".message-user")).forEach((element, index) => {
    Object.defineProperty(element, "offsetTop", { configurable: true, value: index * 600 });
  });
  // The viewport rests at the bottom, past the newest user message.
  log.scrollTop = 1200;

  view.rerender(<MessageList {...props} previousUserMessageRequest={1} nextUserMessageRequest={0} />);
  expect(view.getByRole("button", { name: "Jump to user message 2: Question 1" }).getAttribute("aria-current")).toBe("location");

  // Standing on the newest user message, the next step goes to the previous one.
  log.scrollTop = 600;
  view.rerender(<MessageList {...props} previousUserMessageRequest={2} nextUserMessageRequest={0} />);
  expect(view.getByRole("button", { name: "Jump to user message 1: Question 0" }).getAttribute("aria-current")).toBe("location");
});

it("steps up to the closest user message even from the middle of an assistant reply", () => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
  const message = (id: string, role: "user" | "assistant", text: string, timestamp: number): ChatMessage => ({
    id, role, blocks: [{ kind: "text", text }], timestamp, streaming: false,
  });
  const messages: ChatMessage[] = [
    message("user-0", "user", "Question 0", 0),
    message("assistant-0", "assistant", "Answer 0", 1),
    message("user-1", "user", "Question 1", 2),
    message("assistant-1", "assistant", "Answer 1", 3),
    message("user-2", "user", "Question 2", 4),
  ];
  const props = { messages, tools: {}, loadingHistory: false, emptyHint: "", thinkingLabel: null, connecting: false };
  const view = render(<MessageList {...props} previousUserMessageRequest={0} nextUserMessageRequest={0} />);
  const log = view.getByRole("log");
  Object.defineProperties(log, { scrollHeight: { configurable: true, value: 4000 }, clientHeight: { configurable: true, value: 400 } });
  Array.from(log.querySelectorAll(".message-user")).forEach((element, index) => {
    Object.defineProperty(element, "offsetTop", { configurable: true, value: index * 1200 });
  });
  // The viewport sits inside the second answer, past user-1's top but well above user-2.
  log.scrollTop = 1800;

  view.rerender(<MessageList {...props} previousUserMessageRequest={1} nextUserMessageRequest={0} />);
  expect(view.getByRole("button", { name: "Jump to user message 2: Question 1" }).getAttribute("aria-current")).toBe("location");

  // From user-1's top, the step walks back to user-0 instead of stalling.
  log.scrollTop = 1200;
  view.rerender(<MessageList {...props} previousUserMessageRequest={2} nextUserMessageRequest={0} />);
  expect(view.getByRole("button", { name: "Jump to user message 1: Question 0" }).getAttribute("aria-current")).toBe("location");
});

it("steps down to the closest user message below the viewport", () => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
  const message = (id: string, role: "user" | "assistant", text: string, timestamp: number): ChatMessage => ({
    id, role, blocks: [{ kind: "text", text }], timestamp, streaming: false,
  });
  const messages: ChatMessage[] = [
    message("user-0", "user", "Question 0", 0),
    message("assistant-0", "assistant", "Answer 0", 1),
    message("user-1", "user", "Question 1", 2),
    message("assistant-1", "assistant", "Answer 1", 3),
    message("user-2", "user", "Question 2", 4),
  ];
  const props = { messages, tools: {}, loadingHistory: false, emptyHint: "", thinkingLabel: null, connecting: false };
  const view = render(<MessageList {...props} previousUserMessageRequest={0} nextUserMessageRequest={0} />);
  const log = view.getByRole("log");
  Object.defineProperties(log, { scrollHeight: { configurable: true, value: 4000 }, clientHeight: { configurable: true, value: 400 } });
  Array.from(log.querySelectorAll(".message-user")).forEach((element, index) => {
    Object.defineProperty(element, "offsetTop", { configurable: true, value: index * 1200 });
  });
  log.scrollTop = 600;

  view.rerender(<MessageList {...props} previousUserMessageRequest={0} nextUserMessageRequest={1} />);
  expect(view.getByRole("button", { name: "Jump to user message 2: Question 1" }).getAttribute("aria-current")).toBe("location");

  // The viewport top rests just above user-2; the step lands on it.
  log.scrollTop = 2350;
  view.rerender(<MessageList {...props} previousUserMessageRequest={0} nextUserMessageRequest={2} />);
  expect(view.getByRole("button", { name: "Jump to user message 3: Question 2" }).getAttribute("aria-current")).toBe("location");

  // Past the last user message there is nowhere further to go.
  log.scrollTop = 2500;
  view.rerender(<MessageList {...props} previousUserMessageRequest={0} nextUserMessageRequest={3} />);
  expect(view.getByRole("button", { name: "Jump to user message 3: Question 2" }).getAttribute("aria-current")).toBe("location");
});

it("does not move past the first or last user message", () => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
  const messages: ChatMessage[] = [
    { id: "user-0", role: "user", blocks: [{ kind: "text", text: "Question 0" }], timestamp: 0, streaming: false },
  ];
  const props = { messages, tools: {}, loadingHistory: false, emptyHint: "", thinkingLabel: null, connecting: false };
  const view = render(<MessageList {...props} previousUserMessageRequest={0} nextUserMessageRequest={0} />);
  const log = view.getByRole("log");
  Object.defineProperties(log, { scrollHeight: { configurable: true, value: 600 }, clientHeight: { configurable: true, value: 400 } });
  log.scrollTop = 0;
  Array.from(log.querySelectorAll(".message-user")).forEach((element) => {
    Object.defineProperty(element, "offsetTop", { configurable: true, value: 0 });
  });
  expect(view.getByRole("button", { name: "Jump to user message 1: Question 0" }).getAttribute("aria-current")).toBe("location");

  view.rerender(<MessageList {...props} previousUserMessageRequest={1} nextUserMessageRequest={0} />);
  view.rerender(<MessageList {...props} previousUserMessageRequest={1} nextUserMessageRequest={1} />);
  expect(view.getByRole("button", { name: "Jump to user message 1: Question 0" }).getAttribute("aria-current")).toBe("location");
});

const SEARCH_BASE = {
  open: true,
  query: "build",
  caseSensitive: false,
  wholeWord: false,
  regex: false,
};

it("highlights search matches in user and assistant text and reports the counter", () => {
  const messages: ChatMessage[] = [
    { id: "u1", role: "user", blocks: [{ kind: "text", text: "帮我看看 Build 失败" }], timestamp: 1, streaming: false },
    { id: "a1", role: "assistant", blocks: [{ kind: "text", text: "build 失败原因如下" }], timestamp: 2, streaming: false },
  ];
  const view = render(
    <MessageList messages={messages} tools={{}} loadingHistory={false} emptyHint="" thinkingLabel={null}
      connecting={false} search={SEARCH_BASE} onSearchChange={() => {}} onSearchClose={() => {}} />,
  );
  expect(view.container.querySelectorAll("mark.search-hit")).toHaveLength(2);
  expect(view.getByText("1/2")).toBeDefined();
  // The Ctrl+F cursor starts on the first match, in the user message.
  expect(view.container.querySelector('[data-message-id="u1"]')?.classList.contains("message-search-active")).toBe(true);
  expect(view.container.querySelector('[data-message-id="a1"]')?.classList.contains("message-search-active")).toBe(false);
});

it("steps through matches and updates the active message outline", () => {
  const messages: ChatMessage[] = [
    { id: "u1", role: "user", blocks: [{ kind: "text", text: "帮我看看 build 失败" }], timestamp: 1, streaming: false },
    { id: "a1", role: "assistant", blocks: [{ kind: "text", text: "build 失败原因如下" }], timestamp: 2, streaming: false },
  ];
  const view = render(
    <MessageList messages={messages} tools={{}} loadingHistory={false} emptyHint="" thinkingLabel={null}
      connecting={false} search={SEARCH_BASE} onSearchChange={() => {}} onSearchClose={() => {}} />,
  );
  fireEvent.click(view.getByRole("button", { name: "下一个匹配" }));
  expect(view.getByText("2/2")).toBeDefined();
  expect(view.container.querySelector('[data-message-id="a1"]')?.classList.contains("message-search-active")).toBe(true);
  // Wrap-around back to the first match.
  fireEvent.click(view.getByRole("button", { name: "下一个匹配" }));
  expect(view.getByText("1/2")).toBeDefined();
});

it("forwards option toggles and close to the host callbacks", () => {
  const onSearchChange = vi.fn();
  const onSearchClose = vi.fn();
  const messages: ChatMessage[] = [
    { id: "u1", role: "user", blocks: [{ kind: "text", text: "build" }], timestamp: 1, streaming: false },
  ];
  const view = render(
    <MessageList messages={messages} tools={{}} loadingHistory={false} emptyHint="" thinkingLabel={null}
      connecting={false} search={SEARCH_BASE} onSearchChange={onSearchChange} onSearchClose={onSearchClose} />,
  );
  fireEvent.click(view.getByRole("button", { name: "区分大小写" }));
  expect(onSearchChange).toHaveBeenCalledWith({ ...SEARCH_BASE, caseSensitive: true });
  fireEvent.click(view.getByRole("button", { name: "关闭搜索" }));
  expect(onSearchClose).toHaveBeenCalledTimes(1);
});

it("shows 无结果 and no marks when the query matches nothing", () => {
  const messages: ChatMessage[] = [
    { id: "u1", role: "user", blocks: [{ kind: "text", text: "build" }], timestamp: 1, streaming: false },
  ];
  const view = render(
    <MessageList messages={messages} tools={{}} loadingHistory={false} emptyHint="" thinkingLabel={null}
      connecting={false} search={{ ...SEARCH_BASE, query: "missing" }} onSearchChange={() => {}} onSearchClose={() => {}} />,
  );
  expect(view.getByText("无结果")).toBeDefined();
  expect(view.container.querySelectorAll("mark.search-hit")).toHaveLength(0);
  expect(view.container.querySelector(".message-search-active")).toBeNull();
});
