import type { WheelEvent } from "react";

// JCEF can report a much smaller wheel delta than the native IDE viewport. Add only the
// difference here and leave the browser's own wheel handling intact, so trackpad momentum stays
// smooth while a physical mouse reaches a useful distance per notch.
const WHEEL_MULTIPLIER = 1.75;

export function boostWheelScroll(event: WheelEvent<HTMLElement>): void {
  if (event.deltaY === 0) return;

  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? event.currentTarget.clientHeight : 1;
  const extraDistance = event.deltaY * unit * (WHEEL_MULTIPLIER - 1);
  if (extraDistance !== 0) event.currentTarget.scrollTop += extraDistance;
}
