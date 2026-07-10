import { z } from "zod";
import { errorResponse, PlatformError } from "@/server/errors";
import { getManifest } from "@/server/manifests";
import { createRun, getAsset, getConnection, getRun, getRunByIdempotencyKey, listRuns } from "@/server/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.object({
  manifestId: z.string().min(1).max(320),
  values: z.record(z.string(), z.unknown()),
  idempotencyKey: z.string().min(8).max(100).optional(),
  parentRunId: z.string().uuid().optional(),
});

function validateValues(manifestId: string, values: Record<string, unknown>): void {
  const manifest = getManifest(manifestId);
  if (!manifest) throw new PlatformError("MODEL_NOT_FOUND", "This model is no longer available. Choose another model.", 404);
  for (const field of manifest.inputSchema) {
    const value = values[field.id];
    if (field.required && (value === undefined || value === null || value === "")) {
      throw new PlatformError("MISSING_INPUT", `${field.label} is required.`, 422);
    }
    if ((field.type === "number" || field.type === "slider") && value !== undefined && value !== "") {
      const number = Number(value);
      if (!Number.isFinite(number) || (field.min !== undefined && number < field.min) || (field.max !== undefined && number > field.max)) {
        throw new PlatformError("INVALID_INPUT", `${field.label} is outside its supported range.`, 422);
      }
    }
    if ((field.type === "asset" || field.type === "file") && typeof value === "string" && value) {
      const asset = getAsset(value);
      if (!asset) throw new PlatformError("ASSET_NOT_FOUND", `${field.label} refers to an asset that no longer exists.`, 422);
      if (field.accept?.length && !field.accept.includes(asset.kind)) {
        throw new PlatformError("UNSUPPORTED_INPUT", `${asset.kind} assets are not supported by this model.`, 422);
      }
    }
  }
}

function conversationHistory(parentRunId: string | undefined): Array<{ role: "user" | "assistant"; content: string }> {
  if (!parentRunId) return [];
  const chain = [];
  let cursor = getRun(parentRunId);
  while (cursor && chain.length < 12) {
    if (cursor.capability !== "talk" || cursor.status !== "succeeded") break;
    chain.unshift(cursor);
    cursor = cursor.parentRunId ? getRun(cursor.parentRunId) : null;
  }
  return chain.flatMap((run) => {
    const prompt = typeof run.input.prompt === "string" ? run.input.prompt : "";
    const reply = run.assets.find((asset) => asset.kind === "text")?.text ?? "";
    return [
      { role: "user" as const, content: prompt },
      { role: "assistant" as const, content: reply },
    ].filter((message) => message.content);
  });
}

export async function GET(request: Request) {
  const limit = Number(new URL(request.url).searchParams.get("limit") ?? 50);
  return Response.json({ runs: listRuns(Number.isFinite(limit) ? limit : 50) });
}

export async function POST(request: Request) {
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw) > 256 * 1024) throw new PlatformError("INPUT_TOO_LARGE", "Run inputs are limited to 256 KB. Upload files as assets instead.", 413);
    const parsed = createSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) throw new PlatformError("INVALID_RUN", "The run request is incomplete.", 422, parsed.error.message);
    if (parsed.data.idempotencyKey) {
      const existing = getRunByIdempotencyKey(parsed.data.idempotencyKey);
      if (existing) return Response.json({ run: existing, reused: true });
    }
    const manifest = getManifest(parsed.data.manifestId);
    if (!manifest) throw new PlatformError("MODEL_NOT_FOUND", "This model is no longer available. Choose another model.", 404);
    validateValues(parsed.data.manifestId, parsed.data.values);
    const connection = manifest.connectionId ? getConnection(manifest.connectionId) : null;
    if (manifest.connectionId && !connection) throw new PlatformError("CONNECTION_NOT_FOUND", "This model's connection was removed.", 404);
    if (connection?.status === "error") throw new PlatformError("CONNECTION_UNHEALTHY", "Test this connection again before creating a run.", 409);
    const values = { ...parsed.data.values };
    if (manifest.capability === "talk" && parsed.data.parentRunId) values.history = conversationHistory(parsed.data.parentRunId);
    const run = createRun({
      capability: manifest.capability,
      adapterId: connection?.kind ?? "demo",
      connectionId: connection?.id ?? null,
      modelId: manifest.modelId,
      modelName: manifest.displayName,
      values,
      idempotencyKey: parsed.data.idempotencyKey,
      parentRunId: parsed.data.parentRunId,
    });
    return Response.json({ run }, { status: 202 });
  } catch (error) {
    return errorResponse(error);
  }
}
