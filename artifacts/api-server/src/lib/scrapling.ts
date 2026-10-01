import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { getSourceRepairStrategy } from "./source-repair-strategies.ts";
import { classifySourceResponse, type SourceResponseProblem } from "./source-repair-parsers.ts";
import type { ExtractionAttempt } from "./source-extraction-outcome.ts";

type Environment = Record<string, string | undefined>;
export type ScraplingMode = "http" | "browser";
export const SCRAPLING_LIMITS = { maxUrls: 2, maxBytes: 2_000_000, timeoutMs: 25_000 } as const;

export function scraplingEnabled(source: string, env: Environment = process.env): boolean {
  return env.SCRAPLING_ENABLED === "true" &&
    (env.SCRAPLING_SOURCES ?? "").split(",").map(value => value.trim()).includes(source);
}

export function planScraplingTargets(source: string, attempts: readonly ExtractionAttempt[], env: Environment = process.env): string[] {
  if (!scraplingEnabled(source, env)) return [];
  const strategy = getSourceRepairStrategy(source);
  if (strategy.auditGroup === "authenticated" || strategy.auditGroup === "inaccessible" ||
      strategy.mode === "aemo-workbook" || strategy.mode === "epbc-arcgis") return [];
  const success = new Set(attempts.filter(a => a.outcome.startsWith("success-")).map(a => a.url));
  const blocked = new Set(attempts.filter(a => ["blocked", "auth-failed", "rate-limited"].includes(a.failureCategory ?? "")).map(a => a.url));
  return [...new Set(attempts.filter(a => a.url && !success.has(a.url) && !blocked.has(a.url) &&
    strategy.officialUrls.includes(a.url) && !/\/feed\/?$/i.test(new URL(a.url).pathname) &&
    !a.outcome.startsWith("success-")).map(a => a.url!))].slice(0, SCRAPLING_LIMITS.maxUrls);
}

export interface ScraplingPage { html: string; url: string; status: number; contentType: string; wwwAuthenticate?: string | null }
export class ScraplingResponseError extends Error {
  readonly problem: SourceResponseProblem;
  readonly status: number;
  constructor(problem: SourceResponseProblem, status: number) {
    super(`Scrapling response rejected: ${problem}`);
    this.name = "ScraplingResponseError";
    this.problem = problem;
    this.status = status;
  }
}
export type ScraplingRunner = (url: string, mode: ScraplingMode) => Promise<string>;

// One child at a time across concurrent scan sources. Busy callers retain their
// existing fallback instead of accumulating an unbounded browser queue.
let running = false;
function runPython(url: string, mode: ScraplingMode): Promise<string> {
  if (running) return Promise.reject(new Error("Scrapling worker busy"));
  running = true;
  return new Promise((accept, reject) => {
    const script = resolve(process.env.SCRAPLING_SCRIPT ?? "../../scripts/scrapling/fetch.py");
    const child = spawn(process.env.SCRAPLING_PYTHON ?? "python3", [script], {
      detached: process.platform !== "win32", stdio: ["pipe", "pipe", "ignore"],
      env: { PATH: process.env.PATH, HOME: "/tmp/usst-scrapling", LANG: "C.UTF-8",
        PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH, PYTHONUNBUFFERED: "1" },
    });
    const chunks: Buffer[] = [];
    let bytes = 0;
    let failure: Error | undefined;
    const stop = () => {
      if (!child.pid) return;
      try { process.kill(process.platform === "win32" ? child.pid : -child.pid, "SIGKILL"); } catch { /* already exited */ }
    };
    const timer = setTimeout(() => { failure = new Error("Scrapling timed out"); stop(); }, SCRAPLING_LIMITS.timeoutMs);
    child.stdout.on("data", (data: Buffer) => {
      bytes += data.length;
      // JSON escaping can expand the bounded HTML body up to sixfold.
      if (bytes > SCRAPLING_LIMITS.maxBytes * 6 + 16_384) { failure = new Error("Scrapling output too large"); stop(); }
      else chunks.push(data);
    });
    child.on("error", () => { failure = new Error("Scrapling runtime unavailable"); });
    child.stdin.on("error", () => { /* child exit is handled below */ });
    child.on("close", code => {
      clearTimeout(timer); stop(); running = false;
      if (failure || code !== 0) reject(failure ?? new Error("Scrapling acquisition failed"));
      else accept(Buffer.concat(chunks).toString("utf8"));
    });
    child.stdin.end(JSON.stringify({ url, mode }));
  });
}

export async function fetchApprovedWithScrapling(source: string, url: string, mode: ScraplingMode,
  runner: ScraplingRunner = runPython): Promise<ScraplingPage> {
  const strategy = getSourceRepairStrategy(source);
  const parsed = new URL(url);
  if (!strategy.officialUrls.includes(url) || parsed.protocol !== "https:" || parsed.username || parsed.password ||
      (parsed.port && parsed.port !== "443") || strategy.auditGroup === "authenticated" || strategy.auditGroup === "inaccessible" ||
      strategy.mode === "aemo-workbook" || strategy.mode === "epbc-arcgis") throw new Error("Unapproved Scrapling URL");
  const page = JSON.parse(await runner(url, mode)) as ScraplingPage;
  if (typeof page.html !== "string" || !page.html.trim() || Buffer.byteLength(page.html) > SCRAPLING_LIMITS.maxBytes ||
      typeof page.url !== "string" || !Number.isInteger(page.status) || typeof page.contentType !== "string") {
    throw new Error("Malformed Scrapling response");
  }
  const final = new URL(page.url);
  if (final.protocol !== "https:" || final.hostname !== parsed.hostname || final.username || final.password ||
      (final.port && final.port !== "443")) throw new Error("Unsafe Scrapling final URL");
  const problem = classifySourceResponse(page.status, page.contentType, page.html, page.wwwAuthenticate ?? null);
  if (problem) throw new ScraplingResponseError(problem, page.status);
  return page;
}
