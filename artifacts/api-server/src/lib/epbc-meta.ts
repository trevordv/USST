export interface EpbcMetaRow {
  lastScrapedAt?: Date | string | null;
  total?: number | string | null;
}

export interface EpbcMetaResponse {
  lastScrapedAt: string | null;
  total: number;
}

interface EpbcMetaHttpResponse {
  status(code: number): {
    json(body: EpbcMetaResponse): unknown;
  };
}

/**
 * Normalize timestamps returned through PostgreSQL/Drizzle without assuming
 * that the runtime representation matches the schema's TypeScript type.
 */
export function normalizeTimestamp(value: unknown): string | null {
  if (value == null) return null;

  const date =
    value instanceof Date
      ? value
      : typeof value === "string" && value.trim()
        ? new Date(value)
        : null;

  return date && Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function serializeEpbcMeta(meta?: EpbcMetaRow): EpbcMetaResponse {
  return {
    lastScrapedAt: normalizeTimestamp(meta?.lastScrapedAt),
    total: Number(meta?.total ?? 0),
  };
}

export function sendEpbcMetaResponse(
  response: EpbcMetaHttpResponse,
  meta?: EpbcMetaRow,
): void {
  response.status(200).json(serializeEpbcMeta(meta));
}
