interface ApiErrorLike {
  status?: unknown;
  message?: unknown;
  data?: unknown;
}

function responseDetail(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const record = data as Record<string, unknown>;
  for (const key of ["error", "message", "detail"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

export function formatProtectedApiError(error: unknown, action: string): string {
  const apiError = error as ApiErrorLike;
  const status = typeof apiError?.status === "number" ? apiError.status : null;

  if (status === 401) {
    return `Your session is missing or has expired. Sign out and sign in again to ${action}.`;
  }
  if (status === 403) {
    return `Your account is not authorized to ${action}.`;
  }

  const detail = responseDetail(apiError?.data);
  if (detail) return `${action[0].toUpperCase()}${action.slice(1)} failed: ${detail}`;
  if (status !== null && status >= 500) {
    return `${action[0].toUpperCase()}${action.slice(1)} failed because the server returned an error. Please try again.`;
  }
  if (typeof apiError?.message === "string" && apiError.message.trim()) {
    return `${action[0].toUpperCase()}${action.slice(1)} failed: ${apiError.message}`;
  }
  return `${action[0].toUpperCase()}${action.slice(1)} failed. Please try again.`;
}
