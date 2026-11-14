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

function wideSurface(width = 900, viewport = 300): HTMLElement {
  const element = document.createElement("div");
  widthOf(element, width, viewport);
  return element;
}

function widthOf(element: HTMLElement, width: number, viewport: number): void {
  Object.defineProperties(element, {
    scrollWidth: { configurable: true, value: width },
    clientWidth: { configurable: true, value: viewport },
  });
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
    expect(root.scrollTop).toBeLessThan(250);
    const firstTop = root.scrollTop;
    tick();
    expect(root.scrollTop).toBeGreaterThan(firstTop);
    finish();
    expect(root.scrollTop).toBe(250);
  });

  it("accumulates fast notches without creating multiple animation loops", () => {
    wheel(100);
    tick();
    wheel(100);
    wheel(100);
    expect(frames.size).toBe(1);
    finish();
    expect(root.scrollTop).toBe(750);
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
    expect(root.scrollTop).toBeCloseTo(beforeReverse - 250);
  });

  it.each([{ deltaMode: 1, delta: 3, distance: 120 }, { deltaMode: 2, delta: 1, distance: 1000 }])(
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
    expect(root.scrollTop).toBe(1575);
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
    expect(root.scrollTop).toBe(250);
    wheel(10);
    finish();
    expect(root.scrollTop).toBe(275);
  });

  it.each([30, 60, 120, 144])("keeps motion consistent at %i frames per second", (fps) => {
    wheel(100);
    const fullFrames = Math.floor(fps / 10);
    for (let step = 0; step < fullFrames; step += 1) tick(1000 / fps);
    if (now < 100) tick(100 - now);
    expect(root.scrollTop).toBeCloseTo(250 * (1 - Math.exp(-100 / 80)));
    finish();
    expect(root.scrollTop).toBe(250);
  });

  it("scrolls nested tool output without moving the transcript", () => {
    const output = surface(900, 200);
    output.style.overflowY = "auto";
    root.append(output);
    wheel(100, {}, output);
    finish();
    expect(output.scrollTop).toBe(250);
    expect(root.scrollTop).toBe(0);
    output.scrollTop = 700;
    wheel(100, {}, output);
    finish();
    expect(root.scrollTop).toBe(250);
  });

  it.each([
    { edge: "bottom", cardTop: 699.5, delta: 100, expectedTop: 750 },
    { edge: "top", cardTop: 0.5, delta: -100, expectedTop: 250 },
  ])("scrolls the transcript at a card's fractional $edge edge", ({ cardTop, delta, expectedTop }) => {
    root.scrollTop = 500;
    const card = surface(900, 200);
    card.style.overflowY = "auto";
    card.scrollTop = cardTop;
    const code = document.createElement("code");
    card.append(code);
    root.append(card);

    expect(wheel(delta, {}, code).defaultPrevented).toBe(true);
    finish();
    expect(root.scrollTop).toBe(expectedTop);
    expect(card.scrollTop).toBe(cardTop);

    wheel(-delta, {}, code);
    finish();
    expect(card.scrollTop).toBeCloseTo(cardTop - delta * 2.5);
    expect(root.scrollTop).toBe(expectedTop);
  });

  it.each(["contain", "none"])("continues scrolling outside a card with %s at its edge", (behavior) => {
    const card = surface(900, 200);
    card.style.overflowY = "auto";
    card.style.overscrollBehaviorY = behavior;
    card.scrollTop = 700;
    root.append(card);

    wheel(100, {}, card);
    finish();
    expect(root.scrollTop).toBe(250);
    expect(card.scrollTop).toBe(700);
  });

  it("keeps vertical scrolling working in a card that also overflows sideways", () => {
    const card = surface(900, 200);
    card.style.overflowY = "auto";
    card.style.overflowX = "auto";
    widthOf(card, 900, 300);
    root.append(card);

    wheel(100, {}, card);
    finish();
    expect(card.scrollTop).toBe(250);
    expect(card.scrollLeft).toBe(0);
  });

  it("hands off from a finishing card animation and notifies transcript scroll intent", () => {
    dispose();
    const onIntent = vi.fn();
    dispose = installSmoothWheelScroll(root, onIntent);
    const card = surface(900, 200);
    card.style.overflowY = "auto";
    card.scrollTop = 690;
    root.append(card);

    wheel(100, {}, card);
    for (let count = 0; card.scrollTop < 699; count += 1) {
      expect(count).toBeLessThan(30);
      tick();
    }
    expect(frames.size).toBe(1);
    expect(onIntent).not.toHaveBeenCalled();
    wheel(100, {}, card);
    finish();
    expect(root.scrollTop).toBe(250);
    expect(onIntent).toHaveBeenCalledWith(100);
  });

  it.each([{ ctrlKey: true }, { metaKey: true }, { deltaX: 150 }, { cancelable: false }])(
    "preserves native zoom, mixed-axis gestures and non-cancelable events: %j",
    (options) => {
      expect(wheel(100, options).defaultPrevented).toBe(false);
      expect(frames.size).toBe(0);
    },
  );

  it("leaves shift-wheel alone when nothing can scroll sideways", () => {
    expect(wheel(100, { shiftKey: true }).defaultPrevented).toBe(false);
    const card = surface(900, 200);
    card.style.overflowY = "auto";
    root.append(card);
    expect(wheel(100, { shiftKey: true }, card).defaultPrevented).toBe(false);
    expect(card.scrollTop).toBe(0);
    expect(frames.size).toBe(0);
  });

  it("scrolls a code card sideways with shift + wheel", () => {
    const card = wideSurface();
    card.style.overflowX = "auto";
    const code = document.createElement("code");
    card.append(code);
    root.append(card);

    expect(wheel(100, { shiftKey: true }, code).defaultPrevented).toBe(true);
    tick();
    expect(card.scrollLeft).toBeGreaterThan(0);
    expect(card.scrollLeft).toBeLessThan(250);
    finish();
    expect(card.scrollLeft).toBe(250);
    expect(root.scrollTop).toBe(0);

    wheel(-100, { shiftKey: true }, code);
    finish();
    expect(card.scrollLeft).toBe(0);
  });

  it("tracks SHIFT from the keyboard for wheel events without the modifier", () => {
    const card = wideSurface();
    card.style.overflowX = "auto";
    const code = document.createElement("code");
    card.append(code);
    root.append(card);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Shift", shiftKey: true }));
    expect(wheel(100, {}, code).defaultPrevented).toBe(true);
    finish();
    expect(card.scrollLeft).toBe(250);
    expect(root.scrollTop).toBe(0);

    window.dispatchEvent(new KeyboardEvent("keyup", { key: "Shift", shiftKey: false }));
    wheel(100, {}, code);
    finish();
    expect(card.scrollLeft).toBe(250);
    expect(root.scrollTop).toBe(250);
  });

  it.each([
    { shiftKey: true, deltaX: -120 },
    { deltaX: -120, deltaY: 0 },
  ])("treats an already-horizontal delta as sideways (deltaX opposes scrollLeft): %j", (options) => {
    const card = wideSurface();
    card.style.overflowX = "auto";
    root.append(card);
    expect(wheel(0, options, card).defaultPrevented).toBe(true);
    finish();
    expect(card.scrollLeft).toBe(300);
    expect(root.scrollTop).toBe(0);
  });

  it("leaves a sideways notch at the left edge to the browser", () => {
    const card = wideSurface();
    card.style.overflowX = "auto";
    root.append(card);
    expect(wheel(0, { shiftKey: true, deltaX: 120 }, card).defaultPrevented).toBe(false);
    expect(card.scrollLeft).toBe(0);
    expect(frames.size).toBe(0);
  });

  it("drops the tracked SHIFT when the window loses focus", () => {
    const card = wideSurface();
    card.style.overflowX = "auto";
    root.append(card);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Shift", shiftKey: true }));
    window.dispatchEvent(new Event("blur"));
    wheel(100, {}, card);
    finish();
    expect(card.scrollLeft).toBe(0);
    expect(root.scrollTop).toBe(250);
  });

  it("clamps the sideways gesture at both card edges", () => {
    const card = wideSurface();
    card.style.overflowX = "auto";
    card.scrollLeft = 550;
    root.append(card);

    wheel(100, { shiftKey: true }, card);
    finish();
    expect(card.scrollLeft).toBe(600);
    wheel(100, { shiftKey: true }, card);
    expect(frames.size).toBe(0);
    expect(card.scrollLeft).toBe(600);
  });

  it("smooths explicit wheel input even when the OS disables decorative animations", () => {
    dispose();
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    dispose = installSmoothWheelScroll(root);
    expect(wheel(100).defaultPrevented).toBe(true);
    tick();
    expect(root.scrollTop).toBeGreaterThan(0);
    expect(root.scrollTop).toBeLessThan(250);
    finish();
    expect(root.scrollTop).toBe(250);
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
