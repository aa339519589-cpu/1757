import type { NormalizedOutput } from "@/lib/types";
import { PlatformError } from "../errors";
import { joinProviderUrl, safeFetch } from "../security";
import type { AdapterContext, ProviderAdapter } from "./types";

function apiKey(context: { credentials: Record<string, unknown> }): string {
  const key = context.credentials.apiKey;
  if (typeof key !== "string" || !key) throw new PlatformError("MISSING_API_KEY", "This connection has no API key.", 401);
  return key;
}

async function requestJson(url: string, key: string, init: RequestInit): Promise<Record<string, unknown>> {
  const response = await safeFetch(url, {
    ...init,
    headers: { "content-type": "application/json", authorization: `Bearer ${key}`, ...(init.headers ?? {}) },
  });
  let body: Record<string, unknown> = {};
  try { body = response.json() as Record<string, unknown>; } catch { /* normalized below */ }
  if (!response.ok) {
    const upstream = body.error && typeof body.error === "object" ? body.error as Record<string, unknown> : {};
    const detail = String(upstream.message ?? `HTTP ${response.status}`);
    if (response.status === 401 || response.status === 403) throw new PlatformError("INVALID_API_KEY", "The provider rejected this API key.", 401, detail);
    if (response.status === 429) throw new PlatformError("RATE_LIMITED", "The provider rate limit was reached. Try again shortly.", 429, detail, true);
    throw new PlatformError("UPSTREAM_REQUEST_FAILED", `The provider returned HTTP ${response.status}.`, 502, detail, response.status >= 500);
  }
  return body;
}

async function validateModels(baseUrl: string, key: string): Promise<{ message: string }> {
  const body = await requestJson(joinProviderUrl(baseUrl, "models"), key, { method: "GET" });
  const count = Array.isArray(body.data) ? body.data.length : 0;
  return { message: count ? `Connected. ${count} models are visible.` : "Connected. The provider accepted the key." };
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((part) => typeof part === "object" && part && "text" in part ? String((part as { text: unknown }).text) : "").join("\n").trim();
  return "";
}

export const openAiCompatibleAdapter: ProviderAdapter = {
  id: "openai_compatible",
  async validate(connection) {
    if (!connection.baseUrl) throw new PlatformError("MISSING_ENDPOINT", "Enter a base URL.", 400);
    return validateModels(connection.baseUrl, apiKey(connection));
  },
  async invoke(context: AdapterContext) {
    if (!context.connection?.baseUrl) throw new PlatformError("MISSING_ENDPOINT", "This connection has no base URL.", 400);
    context.emit("sending", "Sending to model");
    const prompt = String(context.input.prompt ?? "").trim();
    if (!prompt) throw new PlatformError("MISSING_INPUT", "Add a message before running this model.", 422);
    const system = String(context.input.system ?? "").trim();
    const messages = [
      ...(system ? [{ role: "system", content: system }] : []),
      ...(Array.isArray(context.input.history) ? context.input.history : []),
      { role: "user", content: prompt },
    ];
    const body = await requestJson(joinProviderUrl(context.connection.baseUrl, "chat/completions"), apiKey(context.connection), {
      method: "POST",
      headers: { "idempotency-key": context.run.idempotencyKey },
      body: JSON.stringify({
        model: context.run.modelId,
        messages,
        temperature: Number(context.input.temperature ?? 0.7),
        max_tokens: Number(context.input.maxTokens ?? 2048),
        stream: false,
      }),
    });
    const choices = Array.isArray(body.choices) ? body.choices as Array<Record<string, unknown>> : [];
    const message = choices[0]?.message as Record<string, unknown> | undefined;
    const text = contentText(message?.content);
    if (!text) throw new PlatformError("EMPTY_PROVIDER_OUTPUT", "The provider returned no message content.", 502);
    return { type: "complete", outputs: [{ kind: "text", name: "response.txt", text }] };
  },
};

export const openAiImagesAdapter: ProviderAdapter = {
  id: "openai_images",
  async validate(connection) {
    if (!connection.baseUrl) throw new PlatformError("MISSING_ENDPOINT", "Enter a base URL.", 400);
    return validateModels(connection.baseUrl, apiKey(connection));
  },
  async invoke(context: AdapterContext) {
    if (!context.connection?.baseUrl) throw new PlatformError("MISSING_ENDPOINT", "This connection has no base URL.", 400);
    const prompt = String(context.input.prompt ?? "").trim();
    if (!prompt) throw new PlatformError("MISSING_INPUT", "Describe the image you want to make.", 422);
    context.emit("sending", "Sending to image model");
    const body = await requestJson(joinProviderUrl(context.connection.baseUrl, "images/generations"), apiKey(context.connection), {
      method: "POST",
      headers: { "idempotency-key": context.run.idempotencyKey },
      body: JSON.stringify({
        model: context.run.modelId,
        prompt,
        size: String(context.input.size ?? "auto"),
        quality: String(context.input.quality ?? "auto"),
        n: 1,
      }),
    });
    const data = Array.isArray(body.data) ? body.data as Array<Record<string, unknown>> : [];
    const first = data[0];
    const output: NormalizedOutput | null = typeof first?.b64_json === "string"
      ? { kind: "image", name: "openai-image.png", mimeType: "image/png", base64: first.b64_json }
      : typeof first?.url === "string"
        ? { kind: "image", name: "openai-image.png", mimeType: "image/png", url: first.url }
        : null;
    if (!output) throw new PlatformError("EMPTY_PROVIDER_OUTPUT", "The image provider returned no image data.", 502);
    return { type: "complete", outputs: [output] };
  },
};
