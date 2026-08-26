import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import { Readable } from "node:stream";

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BYTES = 1_000_000;
const DEFAULT_MAX_REDIRECTS = 3;

export interface SafePublicTextResponse {
  ok: boolean;
  status: number;
  text: string;
  finalUrl: string;
}

interface LookupAddress {
  address: string;
  family: number;
}

interface PinnedRequestInput {
  url: URL;
  address: LookupAddress;
  headers?: Record<string, string>;
  signal: AbortSignal;
}

type PinnedRequest = (input: PinnedRequestInput) => Promise<Response>;

interface SafePublicFetchOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  lookupImpl?: (hostname: string) => Promise<LookupAddress[]>;
  requestImpl?: PinnedRequest;
}

export function isPublicIpAddress(rawAddress: string): boolean {
  const address = rawAddress.toLowerCase().replace(/^\[|\]$/g, "");
  const version = isIP(address);
  if (version === 4) {
    const octets = address.split(".").map(Number);
    return !(
      octets[0] === 0 || octets[0] === 10 || octets[0] === 127 ||
      (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127) ||
      (octets[0] === 169 && octets[1] === 254) ||
      (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] === 192 && (octets[1] === 0 || octets[1] === 168)) ||
      (octets[0] === 198 && (octets[1] === 18 || octets[1] === 19 || octets[1] === 51)) ||
      (octets[0] === 203 && octets[1] === 0 && octets[2] === 113) ||
      octets[0] >= 224
    );
  }
  if (version === 6) {
    return !(
      address === "::" || address === "::1" || address.startsWith("fc") ||
      address.startsWith("fd") || /^fe[89ab]/.test(address) || address.startsWith("2001:db8") ||
      address.startsWith("::ffff:")
    );
  }
  return false;
}

async function validatePublicUrl(
  rawUrl: string,
  lookupImpl: (hostname: string) => Promise<LookupAddress[]>,
): Promise<{ url: URL; address: LookupAddress }> {
  const url = new URL(rawUrl);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Unsafe URL protocol");
  if (url.username || url.password) throw new Error("Credential-bearing URL rejected");
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (hostname === "localhost" || hostname.endsWith(".local")) throw new Error("Private hostname rejected");
  if (isIP(hostname)) {
    if (!isPublicIpAddress(hostname)) throw new Error("Private IP rejected");
    return { url, address: { address: hostname, family: isIP(hostname) } };
  }
  const addresses = await lookupImpl(hostname);
  if (addresses.length === 0 || addresses.some(({ address }) => !isPublicIpAddress(address))) {
    throw new Error("Hostname resolved to a private or reserved address");
  }
  return { url, address: addresses[0] };
}

function pinnedRequest({ url, address, headers, signal }: PinnedRequestInput): Promise<Response> {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === "https:" ? https : http;
    const request = transport.request(url, {
      headers,
      signal,
      // The URL hostname remains untouched, so Node preserves the Host header,
      // TLS SNI, and certificate verification while connecting to this address.
      lookup: (_hostname, options, callback) => {
        if (typeof options === "object" && options.all) {
          callback(null, [address]);
          return;
        }
        callback(null, address.address, address.family);
      },
    }, (response) => {
      const responseHeaders = new Headers();
      for (const [name, value] of Object.entries(response.headers)) {
        if (Array.isArray(value)) value.forEach((item) => responseHeaders.append(name, item));
        else if (value !== undefined) responseHeaders.set(name, value);
      }
      const status = response.statusCode ?? 500;
      const body = status === 204 || status === 205 || status === 304
        ? null
        : Readable.toWeb(response) as ReadableStream;
      resolve(new Response(body, {
        status,
        statusText: response.statusMessage,
        headers: responseHeaders,
      }));
    });
    request.on("error", reject);
    request.end();
  });
}

async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) throw new Error("Response body exceeds limit");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel("Response body exceeds limit");
      throw new Error("Response body exceeds limit");
    }
    chunks.push(value);
  }
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(combined);
}

export async function safeFetchPublicText(
  rawUrl: string,
  options: SafePublicFetchOptions = {},
): Promise<SafePublicTextResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const lookupImpl = options.lookupImpl ?? (async (hostname: string) => lookup(hostname, { all: true }));
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const requestImpl = options.requestImpl ?? pinnedRequest;
  let currentUrl = rawUrl;

  try {
    for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount++) {
      const validated = await validatePublicUrl(currentUrl, lookupImpl);
      const response = await requestImpl({
        url: validated.url,
        address: validated.address,
        signal: controller.signal,
        headers: options.headers,
      });
      if (response.status >= 300 && response.status < 400) {
        if (redirectCount >= maxRedirects) throw new Error("Redirect limit exceeded");
        const location = response.headers.get("location");
        if (!location) throw new Error("Redirect missing location");
        currentUrl = new URL(location, validated.url).toString();
        continue;
      }
      return {
        ok: response.ok,
        status: response.status,
        text: await readBoundedText(response, maxBytes),
        finalUrl: validated.url.toString(),
      };
    }
    throw new Error("Redirect limit exceeded");
  } finally {
    clearTimeout(timer);
  }
}
