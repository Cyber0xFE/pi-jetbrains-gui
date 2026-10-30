/**
 * Token formatting copied from pi's TUI footer
 * (`modes/interactive/components/footer.ts: formatTokens`) so both surfaces read the same.
 */
export function formatTokens(count: number): string {
  if (count < 1000) return String(count);
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1_000_000) return `${Math.round(count / 1000)}k`;
  if (count < 10_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  return `${Math.round(count / 1_000_000)}M`;
}

/** `$0.123`, matching the TUI's three-decimal cost. */
export function formatCost(cost: number): string {
  return `$${cost.toFixed(3)}`;
}
