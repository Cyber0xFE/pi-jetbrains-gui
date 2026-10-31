import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installSmoothWheelScroll } from "./scroll";

let now = 0;
let nextId = 0;
let frames: Map<number, FrameRequestCallback>;
let dispose: () => void;
let root: HTMLElement;

function surface(height = 2000, viewport = 400): HTMLElement {
  const element = document.createElement("div");
  Object.defineProperties(element, {
    scrollHeight: { configurable: true, value: height },
    clientHeight: { configurable: true, value: viewport },
  });
  return element;
}

function wheel(deltaY: number, options: WheelEventInit = {}, element = root): WheelEvent {
  const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY, ...options });
  element.dispatchEvent(event);
  return event;
}

function tick(ms = 16): void {
  now += ms;
  const pending = [...frames.values()];
  frames.clear();
  pending.forEach((callback) => callback(now));
}

function finish(): void {
  for (let count = 0; frames.size && count < 120; count += 1) tick();
  expect(frames.size).toBe(0);
}

beforeEach(() => {
  now = 0;
  nextId = 0;
  frames = new Map();
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    frames.set(++nextId, callback);
    return nextId;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => { frames.delete(id); });
  root = surface();
  document.body.append(root);
  dispose = installSmoothWheelScroll(root);
});

afterEach(() => {
  dispose();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("smooth wheel scrolling", () => {
  it("spreads a notch across frames and prevents a second native scroll", () => {
    expect(wheel(100).defaultPrevented).toBe(true);
    expect(root.scrollTop).toBe(0);
    tick();
    expect(root.scrollTop).toBeGreaterThan(0);
    expect(root.scrollTop).toBeLessThan(175);
    const firstTop = root.scrollTop;
    tick();
    expect(root.scrollTop).toBeGreaterThan(firstTop);
    finish();
    expect(root.scrollTop).toBe(175);
  });

  it("accumulates fast notches without creating multiple animation loops", () => {
    wheel(100);
    tick();
    wheel(100);
    wheel(100);
    expect(frames.size).toBe(1);
    finish();
    expect(root.scrollTop).toBe(525);
  });

  it("reverses immediately instead of finishing the old direction", () => {
    root.scrollTop = 600;
    wheel(100);
    tick();
    const beforeReverse = root.scrollTop;
    wheel(-100);
    tick();
    expect(root.scrollTop).toBeLessThan(beforeReverse);
    finish();
    expect(root.scrollTop).toBeCloseTo(beforeReverse - 175);
  });

  it.each([{ deltaMode: 1, delta: 3, distance: 84 }, { deltaMode: 2, delta: 1, distance: 700 }])(
    "normalizes wheel units in mode $deltaMode",
    ({ deltaMode, delta, distance }) => {
      wheel(delta, { deltaMode });
      finish();
      expect(root.scrollTop).toBe(distance);
    },
  );

  it("clamps at both ends without storing extra momentum", () => {
    root.scrollTop = 1590;
    wheel(1000);
    finish();
    expect(root.scrollTop).toBe(1600);
    wheel(-10);
    finish();
    expect(root.scrollTop).toBe(1582.5);
    wheel(-10000);
    finish();
    expect(root.scrollTop).toBe(0);
    expect(wheel(-10).defaultPrevented).toBe(false);
  });

  it("finishes even when the browser rounds scrollTop to integer pixels", () => {
    let top = 0;
    Object.defineProperty(root, "scrollTop", {
      get: () => top,
      set: (value: number) => { top = Math.round(value); },
    });
    wheel(100);
    finish();
    expect(root.scrollTop).toBe(175);
    wheel(10);
    finish();
    expect(root.scrollTop).toBe(193);
  });

  it("scrolls nested tool output without moving the transcript", () => {
    const output = surface(900, 200);
    output.style.overflowY = "auto";
    root.append(output);
    wheel(100, {}, output);
    finish();
    expect(output.scrollTop).toBe(175);
    expect(root.scrollTop).toBe(0);
    output.scrollTop = 700;
    wheel(100, {}, output);
    finish();
    expect(root.scrollTop).toBe(175);
  });

  it.each([{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { deltaX: 150 }, { cancelable: false }])(
    "preserves native zoom, horizontal gestures and non-cancelable events: %j",
    (options) => {
      expect(wheel(100, options).defaultPrevented).toBe(false);
      expect(frames.size).toBe(0);
    },
  );

  it("respects reduced motion", () => {
    dispose();
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    dispose = installSmoothWheelScroll(root);
    expect(wheel(100).defaultPrevented).toBe(false);
    expect(frames.size).toBe(0);
  });

  it.each(["pointerdown", "keydown"])("yields to %s and cleans up on unmount", (type) => {
    wheel(100);
    root.dispatchEvent(new Event(type));
    expect(frames.size).toBe(0);
    wheel(100);
    dispose();
    expect(frames.size).toBe(0);
    expect(wheel(100).defaultPrevented).toBe(false);
  });

  it("yields to an external scroll jump", () => {
    wheel(100);
    root.scrollTop = 900;
    tick();
    expect(root.scrollTop).toBe(900);
    expect(frames.size).toBe(0);
  });
});
