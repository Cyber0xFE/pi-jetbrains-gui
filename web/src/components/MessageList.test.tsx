import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MessageList } from "./MessageList";
import type { ChatMessage } from "../state/sessionReducer";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
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
