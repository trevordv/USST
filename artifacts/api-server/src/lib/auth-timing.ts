export const LAST_SEEN_WRITE_INTERVAL_MS = 5 * 60 * 1000;

export function shouldRefreshLastSeen(
  lastSeenAt: Date | null,
  now: Date,
  intervalMs = LAST_SEEN_WRITE_INTERVAL_MS,
): boolean {
  return !lastSeenAt || now.getTime() - lastSeenAt.getTime() >= intervalMs;
}
