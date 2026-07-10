import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Capability, ConnectionKind, ConnectionPublic, CustomConnectorConfig, ModelManifest } from "@/lib/types";
import { getAdapter } from "./adapters/registry";
import { PlatformError, normalizeError } from "./errors";
import { insertConnection, markConnectionResult, type ConnectionInternal } from "./repository";
import { assertSafeUrl } from "./security";
import { credentialHint, encryptCredentials } from "./vault";

const capabilitySchema = z.enum(["talk", "image", "video", "audio", "transform", "analyze"]);
const fieldSchema = z.object({
  id: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/),
  label: z.string().min(1).max(80),
  type: z.enum(["text", "textarea", "number", "slider", "select", "boolean", "asset", "file"]),
  required: z.boolean().optional(),
  advanced: z.boolean().optional(),
  description: z.string().max(240).optional(),
  icon: z.string().max(2).optional(),
  placeholder: z.string().max(240).optional(),
  defaultValue: z.union([z.string(), z.number(), z.boolean()]).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().optional(),
  options: z.array(z.object({ label: z.string().min(1).max(80), value: z.string().max(120) })).max(40).optional(),
  accept: z.array(z.enum(["text", "image", "video", "audio", "file", "json"])).optional(),
  mapping: z.object({
    target: z.enum(["body", "query", "header", "path"]),
    key: z.string().min(1).max(120),
    encoding: z.enum(["value", "base64", "data-url", "binary"]).optional(),
  }).optional(),
});

const customSchema = z.object({
  capability: capabilitySchema,
  modelId: z.string().min(1).max(160),
  modelName: z.string().min(1).max(100),
  description: z.string().max(240).optional(),
  endpoint: z.string().min(1).max(500),
  method: z.enum(["GET", "POST", "PUT", "PATCH"]),
  contentType: z.enum(["application/json", "multipart/form-data", "application/x-www-form-urlencoded"]),
  bodyTemplate: z.unknown().optional(),
  inputSchema: z.array(fieldSchema).min(1).max(30),
  response: z.record(z.string(), z.string()).refine((value) => Object.keys(value).length > 0, "Add at least one response mapping."),
  async: z.object({
    enabled: z.boolean(),
    pollEndpoint: z.string().min(1).max(500),
    pollMethod: z.enum(["GET", "POST"]),
    intervalMs: z.number().int().min(500).max(60_000),
    statusPath: z.string().min(1).max(200),
    pendingValues: z.array(z.string()).max(20),
    successValues: z.array(z.string()).min(1).max(20),
    failureValues: z.array(z.string()).min(1).max(20),
    errorPath: z.string().max(200).optional(),
    maxAttempts: z.number().int().min(1).max(1_000),
    cancelEndpoint: z.string().max(500).optional(),
    cancelMethod: z.enum(["POST", "DELETE"]).optional(),
  }).optional(),
});

const draftSchema = z.object({
  kind: z.enum(["openai_compatible", "openai_images", "custom"]),
  name: z.string().min(1).max(80),
  description: z.string().max(240).optional(),
  icon: z.string().max(2).optional(),
  baseUrl: z.string().url().max(500),
  apiKey: z.string().max(1_000).optional(),
  modelId: z.string().max(160).optional(),
  models: z.array(z.string().min(1).max(160)).max(100).optional(),
  credentials: z.record(z.string(), z.unknown()).optional(),
  custom: customSchema.optional(),
  testInput: z.record(z.string(), z.unknown()).optional(),
});

export type ConnectionDraft = z.infer<typeof draftSchema>;

function secretValues(value: unknown): string[] {
  if (typeof value === "string") return value.length >= 4 ? [value] : [];
  if (Array.isArray(value)) return value.flatMap(secretValues);
  if (value && typeof value === "object") return Object.values(value).flatMap(secretValues);
  return [];
}

function adapterId(kind: ConnectionDraft["kind"]): string {
  return kind;
}

function preparedDraft(value: unknown): ConnectionDraft {
  const parsed = draftSchema.safeParse(value);
  if (!parsed.success) {
    throw new PlatformError("INVALID_CONNECTION", "Check the highlighted connection fields.", 422, parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "));
  }
  if (parsed.data.kind === "custom" && !parsed.data.custom) throw new PlatformError("INVALID_CONNECTOR", "Custom API details are required.", 422);
  if (parsed.data.kind !== "custom" && !parsed.data.apiKey) throw new PlatformError("MISSING_API_KEY", "Enter an API key to test this connection.", 422);
  return { ...parsed.data, baseUrl: parsed.data.baseUrl.replace(/\/+$/, "") };
}

function preparedConfig(draft: ConnectionDraft): { capability: Capability | "multi"; config: Record<string, unknown>; credentials: Record<string, unknown> } {
  if (draft.kind === "openai_compatible") {
    const models = (draft.models?.length ? draft.models : [draft.modelId ?? ""]).map((model) => model.trim()).filter(Boolean);
    if (!models.length) throw new PlatformError("MISSING_MODEL", "Add at least one model ID.", 422);
    return { capability: "talk", config: { models, icon: draft.icon }, credentials: { apiKey: draft.apiKey } };
  }
  if (draft.kind === "openai_images") {
    const modelId = draft.modelId?.trim() || "gpt-image-2";
    return { capability: "image", config: { modelId, modelName: modelId === "gpt-image-2" ? "GPT Image 2" : modelId, icon: draft.icon }, credentials: { apiKey: draft.apiKey } };
  }
  const custom = draft.custom as CustomConnectorConfig;
  const manifest: ModelManifest = {
    id: "draft",
    providerId: "draft",
    modelId: custom.modelId,
    displayName: custom.modelName,
    providerName: draft.name,
    capability: custom.capability,
    description: custom.description ?? `Run ${draft.name} from the universal composer.`,
    mode: custom.async?.enabled ? "async" : "sync",
    inputSchema: custom.inputSchema,
    supportedInputs: ["text", ...custom.inputSchema.filter((field) => field.type === "asset" || field.type === "file").flatMap((field) => field.accept ?? ["file"])] as ModelManifest["supportedInputs"],
    supportedOutputs: (["text", "image", "video", "audio", "file", "json"] as const).filter((kind) => Boolean(custom.response[kind])),
    actions: custom.capability === "image" ? ["video", "transform", "analyze"] : custom.capability === "video" ? ["analyze", "transform"] : ["analyze"],
    badges: ["Custom"],
  };
  return { capability: custom.capability, config: { custom, manifest, icon: draft.icon }, credentials: draft.credentials ?? { authType: "none" } };
}

function runtimeConnection(draft: ConnectionDraft): ConnectionInternal {
  const prepared = preparedConfig(draft);
  return {
    id: `draft-${randomUUID()}`,
    kind: draft.kind as ConnectionKind,
    name: draft.name,
    description: draft.description ?? "",
    capability: prepared.capability,
    baseUrl: draft.baseUrl,
    status: "untested",
    keyHint: credentialHint(prepared.credentials),
    modelCount: draft.models?.length ?? 1,
    lastTestedAt: null,
    lastError: null,
    createdAt: new Date().toISOString(),
    config: prepared.config,
    credentials: prepared.credentials,
  };
}

export async function testConnectionDraft(value: unknown): Promise<{ message: string }> {
  const draft = preparedDraft(value);
  await assertSafeUrl(draft.baseUrl);
  const runtime = runtimeConnection(draft);
  try {
    return await getAdapter(adapterId(draft.kind)).validate(runtime, draft.testInput);
  } catch (error) {
    throw normalizeError(error, secretValues(runtime.credentials));
  }
}

export async function saveConnectionDraft(value: unknown): Promise<ConnectionPublic> {
  const draft = preparedDraft(value);
  const runtime = runtimeConnection(draft);
  try {
    await getAdapter(adapterId(draft.kind)).validate(runtime, draft.testInput);
  } catch (error) {
    throw normalizeError(error, secretValues(runtime.credentials));
  }
  const prepared = preparedConfig(draft);
  return insertConnection({
    kind: draft.kind,
    name: draft.name,
    description: draft.description,
    capability: prepared.capability,
    baseUrl: draft.baseUrl,
    config: prepared.config,
    encryptedCredentials: encryptCredentials(prepared.credentials),
    keyHint: credentialHint(prepared.credentials),
  });
}

export async function retestConnection(connection: ConnectionInternal): Promise<{ message: string }> {
  try {
    const result = await getAdapter(connection.kind).validate(connection);
    markConnectionResult(connection.id, true);
    return result;
  } catch (error) {
    const normalized = normalizeError(error, secretValues(connection.credentials));
    markConnectionResult(connection.id, false, normalized.userMessage);
    throw normalized;
  }
}
