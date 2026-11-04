/**
 * Keeps the Debug log from growing for ever. Polling fills it with Bluetooth
 * traffic, so when it is full the oldest traffic goes first and the events of
 * the session stay.
 */
const MAX_LINES = 20000;
const DROP_LINES = 5000;
const TRAFFIC = /^\S+ (TX|RX)\b/;

/** Trims `lines` in place once over `max`: `drop` lines, traffic first, then the oldest. */
export function trimLog(lines, max = MAX_LINES, drop = DROP_LINES) {
  if (lines.length <= max) return;
  let left = drop;
  let kept = 0;
  for (const line of lines) {
    if (left > 0 && TRAFFIC.test(line)) { left -= 1; continue; }
    lines[kept++] = line;
  }
  lines.length = kept;
  if (left > 0) lines.splice(0, left);
}
