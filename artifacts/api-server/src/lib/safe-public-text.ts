import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";

const DEFAULT_MAX_BYTES = 512 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_REDIRECTS = 3;

export function isUnsafeAddress(address: string): boolean {
  if (!net.isIP(address)) return true;
  if (address.includes(":")) {
    const value = address.toLowerCase();
    const mapped = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
    if (mapped) return isUnsafeAddress(mapped);
    return value === "::" || value === "::1" || value.startsWith("fe80:") || value.startsWith("fc") || value.startsWith("fd") || value.startsWith("ff") || value.startsWith("2001:db8:");
  }
  const [a, b] = address.split(".").map(Number);
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
    (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51) || (a === 203 && b === 0);
}

export interface SafePublicTextOptions {
  allowedHostname: string;
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  resolver?: typeof dns.lookup;
  request?: typeof https.request;
}

export async function safeFetchPublicText(value: string, options: SafePublicTextOptions): Promise<string> {
  const resolver = options.resolver ?? dns.lookup;
  const request = options.request;
  const visit = async (raw: string, redirects: number): Promise<string> => {
    const url = new URL(raw);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.port ||
        url.hostname.toLowerCase() !== options.allowedHostname.toLowerCase() ||
        url.hostname === "localhost" || url.hostname.endsWith(".local")) {
      throw new Error("unsafe-contact-url");
    }
    const addresses = await resolver(url.hostname, { all: true, verbatim: true });
    if (!addresses.length || addresses.some(({ address }) => isUnsafeAddress(address))) throw new Error("unsafe-contact-address");
    const selected = addresses[0];
    return await new Promise<string>((resolve, reject) => {
      const transport = request ?? (url.protocol === "https:" ? https.request : http.request as typeof https.request);
      const req = transport(url, {
        method: "GET",
        headers: { Host: url.host, Accept: "text/html,text/plain;q=0.9", "User-Agent": "USST/1.0 contact-research" },
        servername: url.hostname,
        lookup: (_hostname, _opts, callback) => callback(null, selected.address, selected.family),
        timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      }, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          if (redirects <= 0) return reject(new Error("contact-redirect-limit"));
          const next = new URL(res.headers.location, url).href;
          void visit(next, redirects - 1).then(resolve, reject);
          return;
        }
        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) { res.resume(); reject(new Error("contact-fetch-failed")); return; }
        const chunks: Buffer[] = [];
        let total = 0;
        res.on("data", (chunk: Buffer) => {
          total += chunk.length;
          if (total > (options.maxBytes ?? DEFAULT_MAX_BYTES)) req.destroy(new Error("contact-content-too-large"));
          else chunks.push(chunk);
        });
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        res.on("error", reject);
      });
      req.on("timeout", () => req.destroy(new Error("contact-fetch-timeout")));
      req.on("error", reject);
      req.end();
    });
  };
  return visit(value, options.maxRedirects ?? DEFAULT_REDIRECTS);
}

export const SAFE_CONTACT_FETCH_LIMITS = Object.freeze({ maxBytes: DEFAULT_MAX_BYTES, timeoutMs: DEFAULT_TIMEOUT_MS, maxRedirects: DEFAULT_REDIRECTS });
