import dns from "node:dns/promises";
import net from "node:net";
import { PlatformError } from "./errors";

function isPrivateIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

function isPrivateAddress(address: string): boolean {
  if (net.isIPv4(address)) return isPrivateIpv4(address);
  const lower = address.toLowerCase();
  if (lower.startsWith("::ffff:")) return isPrivateIpv4(lower.slice(7));
  return lower === "::1" || lower === "::" || lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb");
}

function isLoopback(address: string): boolean {
  return address === "::1" || address.startsWith("127.") || address.toLowerCase() === "::ffff:127.0.0.1";
}

export async function assertSafeUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new PlatformError("INVALID_ENDPOINT", "Enter a valid provider URL.", 400);
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new PlatformError("UNSAFE_ENDPOINT", "Provider URLs must use HTTP(S) and cannot contain embedded credentials.", 400);
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (hostname === "metadata.google.internal" || hostname.endsWith(".local")) {
    throw new PlatformError("BLOCKED_ENDPOINT", "This endpoint is blocked to protect local services.", 403);
  }

  let addresses: string[];
  if (net.isIP(hostname)) addresses = [hostname];
  else {
    try {
      addresses = (await dns.lookup(hostname, { all: true, verbatim: true })).map((item) => item.address);
    } catch {
      throw new PlatformError("ENDPOINT_DNS_FAILED", "The provider hostname could not be resolved.", 400);
    }
  }
  if (addresses.length === 0) throw new PlatformError("ENDPOINT_DNS_FAILED", "The provider hostname could not be resolved.", 400);

  const onlyLoopback = addresses.every(isLoopback);
  const hasPrivate = addresses.some(isPrivateAddress);
  if (onlyLoopback && process.env.ALLOW_LOCALHOST_CONNECTORS !== "false") {
    return url;
  }
  if (hasPrivate && process.env.ALLOW_PRIVATE_CONNECTORS !== "true") {
    throw new PlatformError(
      "PRIVATE_ENDPOINT_BLOCKED",
      "Private-network endpoints are disabled. Enable ALLOW_PRIVATE_CONNECTORS only in a trusted local deployment.",
      403,
    );
  }
  if (hasPrivate && process.env.ALLOW_PRIVATE_CONNECTORS === "true") return url;
  if (url.protocol !== "https:" && process.env.ALLOW_INSECURE_CONNECTORS !== "true") {
    throw new PlatformError("HTTPS_REQUIRED", "Public provider endpoints must use HTTPS.", 400);
  }
  return url;
}

export interface SafeResponse {
  status: number;
  ok: boolean;
  headers: Headers;
  bytes: Buffer;
  text(): string;
  json(): unknown;
}

export async function safeFetch(
  rawUrl: string,
  init: RequestInit = {},
  options: { timeoutMs?: number; maxBytes?: number; redirects?: number } = {},
): Promise<SafeResponse> {
  const url = await assertSafeUrl(rawUrl);
  const timeoutMs = Math.min(Math.max(options.timeoutMs ?? 45_000, 1_000), 120_000);
  const maxBytes = options.maxBytes ?? Number(process.env.MAX_PROVIDER_RESPONSE_MB ?? 50) * 1024 * 1024;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(url, { ...init, redirect: "manual", signal: controller.signal });

  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location");
    const redirects = options.redirects ?? 0;
    if (!location || redirects >= 2) {
      throw new PlatformError("UNSAFE_REDIRECT", "The provider returned an unsupported redirect.", 502);
    }
    const nextUrl = new URL(location, url);
    if (nextUrl.origin !== url.origin) throw new PlatformError("UNSAFE_REDIRECT", "Cross-origin provider redirects are blocked to protect credentials.", 502);
    clearTimeout(timer);
    return safeFetch(nextUrl.toString(), init, { ...options, redirects: redirects + 1 });
  }

  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > maxBytes) {
    throw new PlatformError("RESPONSE_TOO_LARGE", "The provider response exceeds the configured size limit.", 413);
  }

  const chunks: Uint8Array[] = [];
  let size = 0;
  if (response.body) {
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new PlatformError("RESPONSE_TOO_LARGE", "The provider response exceeds the configured size limit.", 413);
      }
      chunks.push(value);
    }
  }
  const bytes = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
  return {
    status: response.status,
    ok: response.ok,
    headers: response.headers,
    bytes,
    text: () => bytes.toString("utf8"),
    json: () => JSON.parse(bytes.toString("utf8")),
  };
  } finally {
    clearTimeout(timer);
  }
}

export function joinProviderUrl(baseUrl: string, endpoint: string): string {
  if (/^https?:\/\//i.test(endpoint)) return endpoint;
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(endpoint.replace(/^\//, ""), base).toString();
}
