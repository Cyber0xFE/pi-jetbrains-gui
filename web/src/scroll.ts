import { useEffect, useRef, type RefObject } from "react";

const WHEEL_MULTIPLIER = 2.5;
const RESPONSE_MS = 80;
// scrollTop/scrollLeft can be fractional while scrollHeight/clientHeight are rounded to whole pixels.
const SCROLL_EDGE_TOLERANCE = 1;

type Axis = "x" | "y";

const positionOf = (element: HTMLElement, axis: Axis): number =>
  axis === "y" ? element.scrollTop : element.scrollLeft;

const setPosition = (element: HTMLElement, axis: Axis, value: number): void => {
  if (axis === "y") element.scrollTop = value;
  else element.scrollLeft = value;
};

const rangeOf = (element: HTMLElement, axis: Axis): number => Math.max(0,
  axis === "y" ? element.scrollHeight - element.clientHeight : element.scrollWidth - element.clientWidth);

/**
 * One animation owns each wheel gesture on each axis; never mix scroll position jumps with
 * native scrolling. Wheel input is direct viewport control. Keep it smooth when the OS disables
 * decorative animation, which otherwise turns each physical mouse notch into a visible jump in JCEF.
 */
function createAxisScroller(axis: Axis) {
  let frame: number | null = null;
  let surface: HTMLElement | null = null;
  let target = 0;
  let position = 0;
  let lastPosition = 0;
  let lastTime = 0;
  let direction = 0;

  const stop = (): void => {
    if (frame !== null) window.cancelAnimationFrame(frame);
    frame = null;
  };

  const animate = (now: number): void => {
    if (!surface) {
      frame = null;
      return;
    }
    // Keyboard navigation, a scrollbar drag or a programmatic jump takes priority.
    if (Math.abs(positionOf(surface, axis) - lastPosition) > SCROLL_EDGE_TOLERANCE) {
      stop();
      return;
    }
    const remaining = target - position;
    const elapsed = Math.max(0, now - lastTime);
    lastTime = now;
    // Integrate subpixel positions independently of the browser's integer pixel rounding.
    // This keeps the tail consistent on high refresh rate displays as well as in JCEF.
    position = Math.abs(remaining) <= 0.5 ? target : position + remaining * (1 - Math.exp(-elapsed / RESPONSE_MS));
    setPosition(surface, axis, position);
    lastPosition = positionOf(surface, axis);
    if (Math.abs(target - position) <= 0.5) {
      setPosition(surface, axis, target);
      frame = null;
    } else {
      frame = window.requestAnimationFrame(animate);
    }
  };

  /** Extends the gesture on `element`; false means it is already pinned at that edge. */
  const scroll = (element: HTMLElement, delta: number, mode: number): boolean => {
    const nextDirection = Math.sign(delta);
    if (frame === null || element !== surface || nextDirection !== direction ||
        Math.abs(positionOf(element, axis) - lastPosition) > SCROLL_EDGE_TOLERANCE) {
      stop();
      surface = element;
      target = positionOf(element, axis);
      position = target;
    }
    direction = nextDirection;
    const pageUnit = axis === "y" ? element.clientHeight : element.clientWidth;
    const unit = mode === 1 ? 16 : mode === 2 ? pageUnit : 1;
    const limit = rangeOf(element, axis);
    target = Math.max(0, Math.min(target + delta * unit * WHEEL_MULTIPLIER, limit));
    if (target === positionOf(element, axis) && frame === null) return false;
    if (frame === null) {
      lastPosition = positionOf(element, axis);
      lastTime = performance.now();
      frame = window.requestAnimationFrame(animate);
    }
    return true;
  };

  return { scroll, stop };
}

function targetOf(root: HTMLElement, event: WheelEvent): HTMLElement | null {
  return event.target instanceof HTMLElement
    ? event.target
    : event.target instanceof Element ? event.target.parentElement : root;
}

/**
 * Innermost surface between the wheel target and the transcript root that still has room to
 * scroll on `axis`. Once a card reaches an edge, further wheel input moves its parent even if the
 * card contains native scrolling.
 */
function scrollableSurface(root: HTMLElement, event: WheelEvent, axis: Axis, delta: number): HTMLElement | null {
  const overflow = axis === "y" ? "overflowY" : "overflowX";
  let next = targetOf(root, event);
  while (next && next !== root) {
    const size = axis === "y" ? next.scrollHeight : next.scrollWidth;
    const viewport = axis === "y" ? next.clientHeight : next.clientWidth;
    if (size > viewport) {
      const style = window.getComputedStyle(next);
      if (/^(auto|scroll)$/.test(style[overflow])) {
        const offset = positionOf(next, axis);
        const canScroll = delta < 0
          ? offset > SCROLL_EDGE_TOLERANCE
          : size - viewport - offset > SCROLL_EDGE_TOLERANCE;
        if (canScroll) return next;
      }
    }
    next = next.parentElement;
  }
  return null;
}

export function installSmoothWheelScroll(root: HTMLElement, onIntent?: (delta: number) => void): () => void {
  const vertical = createAxisScroller("y");
  const horizontal = createAxisScroller("x");
  // JCEF does not always forward SHIFT as a wheel modifier, so the modifier is tracked from the
  // keyboard and pointer events. Without it a shift + wheel notch would look like plain vertical
  // scrolling.
  let shiftHeld = false;
  const trackShift = (event: KeyboardEvent): void => {
    shiftHeld = event.shiftKey;
  };
  const trackPointerShift = (event: PointerEvent | MouseEvent): void => {
    if (event.shiftKey) shiftHeld = true;
  };
  const resetShift = (): void => {
    shiftHeld = false;
  };
  const stop = (): void => {
    vertical.stop();
    horizontal.stop();
  };

  // `delta` is expressed in scrollLeft space: positive moves the card to the right.
  const scrollSideways = (event: WheelEvent, delta: number): void => {
    vertical.stop();
    const sideways = delta === 0 ? null : scrollableSurface(root, event, "x", delta);
    if (sideways === null) {
      horizontal.stop();
      return;
    }
    if (horizontal.scroll(sideways, delta, event.deltaMode)) event.preventDefault();
  };

  const wheel = (event: WheelEvent): void => {
    if (event.defaultPrevented || !event.cancelable || event.ctrlKey || event.metaKey) {
      stop();
      return;
    }

    // Shift (or a gesture the browser already turned into horizontal deltas) moves the innermost
    // card that can still scroll sideways. `deltaY` is a wheel direction while `deltaX` is a content
    // offset, which moves opposite to `scrollLeft`, so the two need opposite signs.
    if (event.shiftKey || shiftHeld) {
      scrollSideways(event, event.deltaY !== 0 ? event.deltaY : -event.deltaX);
      return;
    }
    if (event.deltaY === 0) {
      scrollSideways(event, -event.deltaX);
      return;
    }
    if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
      vertical.stop();
      return;
    }

    const next = scrollableSurface(root, event, "y", event.deltaY) ?? root;
    if (!vertical.scroll(next, event.deltaY, event.deltaMode)) return;

    event.preventDefault();
    if (next === root) onIntent?.(event.deltaY);
  };

  // React's delegated wheel listener is passive in Chromium; cancellation needs a native listener.
  root.addEventListener("wheel", wheel, { passive: false });
  root.addEventListener("pointerdown", stop, true);
  root.addEventListener("pointerdown", trackPointerShift, true);
  root.addEventListener("pointermove", trackPointerShift, true);
  root.addEventListener("keydown", stop, true);
  window.addEventListener("keydown", trackShift, true);
  window.addEventListener("keyup", trackShift, true);
  window.addEventListener("blur", resetShift);
  return () => {
    stop();
    resetShift();
    root.removeEventListener("wheel", wheel);
    root.removeEventListener("pointerdown", stop, true);
    root.removeEventListener("pointerdown", trackPointerShift, true);
    root.removeEventListener("pointermove", trackPointerShift, true);
    root.removeEventListener("keydown", stop, true);
    window.removeEventListener("keydown", trackShift, true);
    window.removeEventListener("keyup", trackShift, true);
    window.removeEventListener("blur", resetShift);
  };
}

export function useSmoothWheelScroll(ref: RefObject<HTMLElement>, onIntent?: (delta: number) => void): void {
  const intent = useRef(onIntent);
  intent.current = onIntent;
  useEffect(() => {
    if (ref.current) return installSmoothWheelScroll(ref.current, (delta) => intent.current?.(delta));
  }, [ref]);
}
