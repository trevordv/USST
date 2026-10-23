/** Convert database timestamp values to the API's ISO-string-or-null contract. */
export function normalizeTimestamp(value: unknown): string | null {
  const date = value instanceof Date
    ? value
    : typeof value === "string"
      ? new Date(value)
      : null;

  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
}
