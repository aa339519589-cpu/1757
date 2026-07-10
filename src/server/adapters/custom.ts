import type { CustomConnectorConfig, InputField, NormalizedOutput, OutputKind } from "@/lib/types";
import { PlatformError } from "../errors";
import { extractJsonPath, renderTemplate, requireMappedValue } from "../json-path";
import type { ConnectionInternal } from "../repository";
import { assetBytes } from "../storage";
import { assertSafeUrl, joinProviderUrl, safeFetch } from "../security";
import type { AdapterContext, PollResult, ProviderAdapter } from "./types";

const forbiddenHeaders = new Set(["host", "content-length", "transfer-encoding", "connection", "proxy-authorization"]);

type EncodedAsset = {
  __asset: true;
  bytes: Buffer;
  name: string;
  mimeType: string;
};

function configOf(connection: ConnectionInternal): CustomConnectorConfig {
  const config = connection.config?.custom;
  if (!config || typeof config !== "object") throw new PlatformError("INVALID_CONNECTOR", "This custom connector configuration is incomplete.", 422);
  return config as CustomConnectorConfig;
}

function isEncodedAsset(value: unknown): value is EncodedAsset {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<EncodedAsset>;
  return candidate.__asset === true && Buffer.isBuffer(candidate.bytes) && typeof candidate.name === "string" && typeof candidate.mimeType === "string";
}

function setNested(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".").filter(Boolean);
  let current = target;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const key = parts[index];
    if (!current[key] || typeof current[key] !== "object") current[key] = {};
    current = current[key] as Record<string, unknown>;
  }
  current[parts.at(-1) ?? path] = value;
}

async function encodeField(field: InputField, value: unknown, contentType: CustomConnectorConfig["contentType"]): Promise<unknown> {
  if (field.type !== "asset" && field.type !== "file") return value;
  if (typeof value !== "string" || !value) return value;
  const { asset, bytes } = await assetBytes(value);
  const encoding = field.mapping?.encoding ?? (contentType === "multipart/form-data" ? "binary" : "data-url");
  if (encoding === "value") return value;
  if (encoding === "base64") return bytes.toString("base64");
  if (encoding === "data-url") return `data:${asset.mimeType};base64,${bytes.toString("base64")}`;
  return { __asset: true, bytes, name: asset.name, mimeType: asset.mimeType } satisfies EncodedAsset;
}

function applyAuth(
  url: URL,
  headers: Headers,
  credentials: Record<string, unknown>,
): void {
  const authType = String(credentials.authType ?? "none");
  if (authType === "bearer" && credentials.token) headers.set("authorization", `Bearer ${String(credentials.token)}`);
  if (authType === "api_key_header" && credentials.apiKey) headers.set(String(credentials.headerName ?? "x-api-key"), String(credentials.apiKey));
  if (authType === "api_key_query" && credentials.apiKey) url.searchParams.set(String(credentials.queryName ?? "api_key"), String(credentials.apiKey));
  if (authType === "basic") {
    headers.set("authorization", `Basic ${Buffer.from(`${String(credentials.username ?? "")}:${String(credentials.password ?? "")}`).toString("base64")}`);
  }
  if (credentials.customHeaders && typeof credentials.customHeaders === "object") {
    for (const [name, value] of Object.entries(credentials.customHeaders as Record<string, unknown>)) {
      if (!forbiddenHeaders.has(name.toLowerCase()) && value !== undefined) headers.set(name, String(value));
    }
  }
}

async function buildRequest(
  connection: ConnectionInternal,
  input: Record<string, unknown>,
  options: { endpoint?: string; method?: string } = {},
): Promise<{ url: string; init: RequestInit }> {
  const config = configOf(connection);
  if (!connection.baseUrl) throw new PlatformError("MISSING_ENDPOINT", "This connector has no base URL.", 422);
  const values = { ...input };
  const endpoint = String(renderTemplate(options.endpoint ?? config.endpoint, values));
  const url = new URL(joinProviderUrl(connection.baseUrl, endpoint));
  const headers = new Headers();
  let bodyObject = renderTemplate(config.bodyTemplate ?? {}, values);
  if (!bodyObject || typeof bodyObject !== "object" || Array.isArray(bodyObject)) bodyObject = {};
  const mappedBody = bodyObject as Record<string, unknown>;

  for (const field of config.inputSchema) {
    if (!(field.id in values) || values[field.id] === undefined || values[field.id] === "") continue;
    const mapping = field.mapping ?? { target: "body" as const, key: field.id };
    const encoded = await encodeField(field, values[field.id], config.contentType);
    if (mapping.target === "body") setNested(mappedBody, mapping.key, encoded);
    if (mapping.target === "query") url.searchParams.set(mapping.key, String(encoded));
    if (mapping.target === "header" && !forbiddenHeaders.has(mapping.key.toLowerCase())) headers.set(mapping.key, String(encoded));
  }
  applyAuth(url, headers, connection.credentials);

  let body: BodyInit | undefined;
  const method = options.method ?? config.method;
  if (method !== "GET") {
    if (config.contentType === "multipart/form-data") {
      const form = new FormData();
      for (const [key, value] of Object.entries(mappedBody)) {
        if (isEncodedAsset(value)) {
          form.append(key, new Blob([new Uint8Array(value.bytes)], { type: value.mimeType }), value.name);
        } else if (value !== undefined) form.append(key, typeof value === "string" ? value : JSON.stringify(value));
      }
      body = form;
    } else if (config.contentType === "application/x-www-form-urlencoded") {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(mappedBody)) if (value !== undefined) params.set(key, String(value));
      headers.set("content-type", config.contentType);
      body = params;
    } else {
      headers.set("content-type", "application/json");
      body = JSON.stringify(mappedBody);
    }
  }
  return { url: url.toString(), init: { method, headers, body } };
}

async function perform(
  connection: ConnectionInternal,
  input: Record<string, unknown>,
  options: { endpoint?: string; method?: string } = {},
): Promise<unknown> {
  const request = await buildRequest(connection, input, options);
  const response = await safeFetch(request.url, request.init);
  const contentType = response.headers.get("content-type") ?? "";
  const rawText = await response.text();
  let parsed: unknown = rawText;
  if (contentType.includes("json")) {
    try { parsed = rawText ? JSON.parse(rawText) : null; } catch { /* handled as raw text */ }
  }
  if (!response.ok) {
    const rawDetail = typeof parsed === "string" ? parsed : JSON.stringify(parsed);
    if (response.status === 401 || response.status === 403) throw new PlatformError("INVALID_API_KEY", "The custom API rejected these credentials.", 401, rawDetail);
    if (response.status === 429) throw new PlatformError("RATE_LIMITED", "The custom API rate limit was reached.", 429, rawDetail, true);
    throw new PlatformError("CUSTOM_API_ERROR", `The custom API returned HTTP ${response.status}.`, 502, rawDetail, response.status >= 500);
  }
  return parsed;
}

function outputFromValue(kind: OutputKind, value: unknown): NormalizedOutput[] {
  if (Array.isArray(value)) return value.flatMap((item) => outputFromValue(kind, item));
  if (kind === "json") return [{ kind, name: "response.json", json: value }];
  if (kind === "text") return [{ kind, name: "response.txt", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }];
  if (typeof value !== "string" || !value) return [];
  if (value.startsWith("data:")) {
    const match = value.match(/^data:([^;,]+);base64,(.+)$/s);
    if (match) return [{ kind, mimeType: match[1], base64: match[2], name: `response.${kind}` }];
  }
  if (/^https?:\/\//i.test(value)) return [{ kind, url: value, name: `response.${kind}` }];
  if (/^[a-z\d+/=_-]{100,}$/i.test(value)) return [{ kind, base64: value, name: `response.${kind}` }];
  return [];
}

function normalizeOutputs(data: unknown, config: CustomConnectorConfig): NormalizedOutput[] {
  const outputs: NormalizedOutput[] = [];
  for (const kind of ["text", "image", "video", "audio", "file", "json"] as OutputKind[]) {
    const path = config.response[kind];
    if (!path) continue;
    outputs.push(...outputFromValue(kind, extractJsonPath(data, path)));
  }
  if (!outputs.length) throw new PlatformError("RESPONSE_MAPPING_FAILED", "The response mappings did not produce an output.", 422);
  return outputs;
}

function defaultInputs(config: CustomConnectorConfig): Record<string, unknown> {
  return Object.fromEntries(config.inputSchema.map((field) => [field.id, field.defaultValue ?? (field.type === "boolean" ? false : "") ]));
}

export const customAdapter: ProviderAdapter = {
  id: "custom",
  async validate(connection, testInput) {
    const config = configOf(connection);
    if (!connection.baseUrl) throw new PlatformError("MISSING_ENDPOINT", "Enter a base URL.", 400);
    await assertSafeUrl(joinProviderUrl(connection.baseUrl, config.endpoint));
    const response = await perform(connection, { ...defaultInputs(config), ...(testInput ?? {}) });
    if (config.async?.enabled) {
      requireMappedValue(response, config.response.taskId ?? "", "a task ID");
      return { message: "Connected. The submit response contained a task ID." };
    }
    normalizeOutputs(response, config);
    return { message: "Connected. The response mappings produced a valid output." };
  },
  async invoke(context: AdapterContext) {
    if (!context.connection) throw new PlatformError("CONNECTION_NOT_FOUND", "This connection no longer exists.", 404);
    const config = configOf(context.connection);
    context.emit("sending", "Sending to custom API");
    const response = await perform(context.connection, context.input);
    if (config.async?.enabled) {
      const taskId = String(requireMappedValue(response, config.response.taskId ?? "", "a task ID"));
      return { type: "submitted", taskId, pollAfterMs: config.async.intervalMs, stage: "queued" };
    }
    return { type: "complete", outputs: normalizeOutputs(response, config) };
  },
  async poll(context: AdapterContext): Promise<PollResult> {
    if (!context.connection) throw new PlatformError("CONNECTION_NOT_FOUND", "This connection no longer exists.", 404);
    const config = configOf(context.connection);
    const asyncConfig = config.async;
    if (!asyncConfig?.enabled || !context.run.upstreamTaskId) throw new PlatformError("POLL_NOT_SUPPORTED", "This connector does not support polling.", 422);
    if (context.run.pollAttempts >= asyncConfig.maxAttempts) {
      return { state: "failed", message: "The async task exceeded its polling limit.", detail: `Stopped after ${asyncConfig.maxAttempts} checks.` };
    }
    const response = await perform(
      context.connection,
      { ...context.input, taskId: context.run.upstreamTaskId },
      { endpoint: asyncConfig.pollEndpoint, method: asyncConfig.pollMethod },
    );
    const status = String(requireMappedValue(response, asyncConfig.statusPath, "a task status"));
    const normalized = status.toLowerCase();
    const success = asyncConfig.successValues.map(String).some((value) => value.toLowerCase() === normalized);
    const failure = asyncConfig.failureValues.map(String).some((value) => value.toLowerCase() === normalized);
    if (success) return { state: "complete", outputs: normalizeOutputs(response, config) };
    if (failure) {
      const detail = asyncConfig.errorPath ? extractJsonPath(response, asyncConfig.errorPath) : undefined;
      return { state: "failed", message: "The custom API reported a failed task.", detail: detail ? String(detail) : status };
    }
    const stage = /queue|pending|submitted|created/i.test(status) ? "queued" : "running";
    return { state: "pending", stage, message: stage === "queued" ? "Waiting in provider queue" : "Provider is processing", pollAfterMs: asyncConfig.intervalMs };
  },
  async cancel(context) {
    if (!context.connection || !context.run.upstreamTaskId) return;
    const config = configOf(context.connection);
    if (!config.async?.cancelEndpoint) return;
    await perform(
      context.connection,
      { ...context.input, taskId: context.run.upstreamTaskId },
      { endpoint: config.async.cancelEndpoint, method: config.async.cancelMethod ?? "POST" },
    );
  },
};
