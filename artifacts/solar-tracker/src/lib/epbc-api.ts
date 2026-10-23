export const EPBC_AUTH_ERROR =
  "Your session is missing or has expired. Sign out and sign in again to load EPBC data.";

type FetchImplementation = typeof fetch;

export function createEpbcApiFetch(
  accessToken: string | null,
  baseUrl = "",
  fetchImplementation: FetchImplementation = fetch,
) {
  const normalizedBaseUrl = baseUrl.replace(/\/$/, "");

  return async function epbcApiFetch<T>(
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    if (!accessToken) {
      throw new Error(EPBC_AUTH_ERROR);
    }

    const headers = new Headers(options.headers);
    headers.set("Authorization", `Bearer ${accessToken}`);

    if (typeof options.body === "string" && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    const response = await fetchImplementation(`${normalizedBaseUrl}${path}`, {
      ...options,
      headers,
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error(EPBC_AUTH_ERROR);
      }

      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      throw new Error(body.error ?? `HTTP ${response.status}`);
    }

    return response.json() as Promise<T>;
  };
}
