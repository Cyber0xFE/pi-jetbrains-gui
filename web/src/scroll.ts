import { useEffect, useRef, type RefObject } from "react";

const WHEEL_MULTIPLIER = 1.75;
const RESPONSE_MS = 45;

/** One animation owns each wheel gesture; never mix scrollTop jumps with native scrolling. */
export function installSmoothWheelScroll(root: HTMLElement, onIntent?: (delta: number) => void): () => void {
  let frame: number | null = null;
  let scroller = root;
  let target = 0;
  let lastTop = 0;
  let lastTime = 0;
  let direction = 0;
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  const clamp = (value: number): number => Math.max(0, Math.min(value, scroller.scrollHeight - scroller.clientHeight));

  const stop = (): void => {
    if (frame !== null) window.cancelAnimationFrame(frame);
    frame = null;
  };

  const animate = (now: number): void => {
    // Keyboard navigation, a scrollbar drag or a programmatic jump takes priority.
    if (Math.abs(scroller.scrollTop - lastTop) > 1) {
      stop();
      return;
    }
    target = clamp(target);
    const remaining = target - scroller.scrollTop;
    const elapsed = Math.max(0, now - lastTime);
    lastTime = now;
    scroller.scrollTop = Math.abs(remaining) <= 1
      ? target
      : scroller.scrollTop + Math.sign(remaining) * Math.max(1, Math.abs(remaining) * (1 - Math.exp(-elapsed / RESPONSE_MS)));
    lastTop = scroller.scrollTop;
    if (Math.abs(target - lastTop) <= 1) {
      scroller.scrollTop = target;
      frame = null;
    } else {
      frame = window.requestAnimationFrame(animate);
    }
  };

  const wheel = (event: WheelEvent): void => {
    if (event.defaultPrevented || !event.cancelable || event.ctrlKey || event.metaKey || event.shiftKey ||
        event.deltaY === 0 || Math.abs(event.deltaX) > Math.abs(event.deltaY) || reducedMotion?.matches) {
      stop();
      return;
    }

    // Code blocks and tool output keep their own scrolling, including containment at the edges.
    let next: HTMLElement | null = event.target instanceof HTMLElement ? event.target :
      event.target instanceof Element ? event.target.parentElement : root;
    while (next && next !== root) {
      if (next.scrollHeight > next.clientHeight) {
        const style = window.getComputedStyle(next);
        if (/^(auto|scroll)$/.test(style.overflowY)) {
          const canScroll = event.deltaY < 0 ? next.scrollTop > 0 : next.scrollTop + next.clientHeight < next.scrollHeight;
          if (canScroll) break;
          if (/^(contain|none)$/.test(style.overscrollBehaviorY)) {
            stop();
            return;
          }
        }
      }
      next = next.parentElement;
    }
    next ??= root;
    const nextDirection = Math.sign(event.deltaY);
    if (frame === null || next !== scroller || nextDirection !== direction || Math.abs(scroller.scrollTop - lastTop) > 1) {
      stop();
      scroller = next;
      target = scroller.scrollTop;
    }
    direction = nextDirection;
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? scroller.clientHeight : 1;
    target = clamp(target + event.deltaY * unit * WHEEL_MULTIPLIER);
    if (target === scroller.scrollTop && frame === null) return;

    event.preventDefault();
    if (scroller === root) onIntent?.(event.deltaY);
    if (frame === null) {
      lastTop = scroller.scrollTop;
      lastTime = performance.now();
      frame = window.requestAnimationFrame(animate);
    }
  };

  // React's delegated wheel listener is passive in Chromium; cancellation needs a native listener.
  root.addEventListener("wheel", wheel, { passive: false });
  root.addEventListener("pointerdown", stop, true);
  root.addEventListener("keydown", stop, true);
  return () => {
    stop();
    root.removeEventListener("wheel", wheel);
    root.removeEventListener("pointerdown", stop, true);
    root.removeEventListener("keydown", stop, true);
  };
}

export function useSmoothWheelScroll(ref: RefObject<HTMLElement>, onIntent?: (delta: number) => void): void {
  const intent = useRef(onIntent);
  intent.current = onIntent;
  useEffect(() => {
    if (ref.current) return installSmoothWheelScroll(ref.current, (delta) => intent.current?.(delta));
  }, [ref]);
}
