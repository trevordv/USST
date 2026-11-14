export interface BrowseAiResult {
  id?: string;
  status?: string;
  capturedLists?: Record<string, Array<Record<string, string>>>;
  capturedTexts?: Record<string, string>;
}

export function browseAiConfigurationProblem(robotId?: string, apiKey?: string): string | undefined {
  if (!robotId?.trim() && !apiKey?.trim()) return "Browse.AI robot ID and API key are not configured";
  if (!robotId?.trim()) return "Browse.AI robot ID is not configured";
  if (!apiKey?.trim()) return "Browse.AI API key is not configured";
  return undefined;
}

/** Failures must not be represented by a valid empty captured list. */
export async function runBrowseAiTask(
  robotId: string,
  apiKey: string,
  url: string,
  dependencies: {
    fetch?: typeof fetch;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<BrowseAiResult> {
  const problem = browseAiConfigurationProblem(robotId, apiKey);
  if (problem) throw new Error(problem);
  const request = dependencies.fetch ?? fetch;
  const now = dependencies.now ?? (() => performance.now());
  const sleep = dependencies.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  // Includes creation, delays, and HTTP polling, not just the sleep intervals.
  const deadline = now() + 90_000;
  const base = `https://api.browse.ai/v2/robots/${encodeURIComponent(robotId.trim())}/tasks`;
  async function read(endpoint: string, init: RequestInit, timeout: number): Promise<BrowseAiResult> {
    const remaining = Math.floor(deadline - now());
    if (remaining <= 0) throw new Error("Browse.AI task timed out after 90 s");
    const response = await request(endpoint, {
      ...init,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey.trim()}` },
      signal: AbortSignal.timeout(Math.min(timeout, remaining)),
    });
    // Do not log upstream bodies: they can include account or input data.
    if (!response.ok) throw new Error(`Browse.AI request returned HTTP ${response.status}`);
    const data = await response.json() as { result?: BrowseAiResult };
    if (!data?.result || typeof data.result !== "object") throw new Error("Browse.AI response has no result");
    return data.result;
  }
  const created = await read(base, {
    method: "POST", body: JSON.stringify({ inputParameters: { originUrl: url } }),
  }, 15_000);
  if (typeof created.id !== "string" || !created.id.trim()) throw new Error("Browse.AI response has no task ID");
  for (let attempt = 0; attempt < 18; attempt++) {
    const remaining = deadline - now();
    if (remaining <= 5_000) break;
    await sleep(5_000);
    const result = await read(`${base}/${encodeURIComponent(created.id)}`, { method: "GET" }, 10_000);
    if (result.status === "failed") throw new Error("Browse.AI task failed");
    if (result.status === "successful") {
      const lists = result.capturedLists;
      if (!lists || typeof lists !== "object" || Array.isArray(lists) ||
          Object.values(lists).some((rows) => !Array.isArray(rows) || rows.some((row) =>
            !row || typeof row !== "object" || Array.isArray(row) ||
            Object.values(row).some((value) => typeof value !== "string")))) {
        throw new Error("Browse.AI response has invalid captured lists");
      }
      return result;
    }
    if (result.status !== "running" && result.status !== "pending") throw new Error("Browse.AI returned an unknown task status");
  }
  throw new Error("Browse.AI task timed out after 90 s");
}
