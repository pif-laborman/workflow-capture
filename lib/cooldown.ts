/** Module-level cooldown state — tracks the last time Claude spoke */
let lastInterjectionTimestamp = 0;

export function getLastInterjectionTimestamp(): number {
  return lastInterjectionTimestamp;
}

export function setLastInterjectionTimestamp(ts: number): void {
  lastInterjectionTimestamp = ts;
}

export function resetCooldown(): void {
  lastInterjectionTimestamp = 0;
}
