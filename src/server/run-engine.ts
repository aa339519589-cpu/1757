import type { NormalizedOutput, RunRecord } from "@/lib/types";
import { getAdapter } from "./adapters/registry";
import type { AdapterContext } from "./adapters/types";
import { normalizeError, PlatformError } from "./errors";
import {
  appendRunEvent,
  cancelRun,
  claimRun,
  createRun,
  findInputAssetIds,
  getConnection,
  getRun,
  linkRunAsset,
  updateRun,
} from "./repository";
import { persistOutput } from "./storage";

function secretStrings(value: unknown): string[] {
  if (typeof value === "string") return value.length >= 4 ? [value] : [];
  if (Array.isArray(value)) return value.flatMap(secretStrings);
  if (value && typeof value === "object") return Object.values(value).flatMap(secretStrings);
  return [];
}

function contextFor(run: RunRecord): AdapterContext {
  const connection = run.connectionId ? getConnection(run.connectionId) : null;
  return {
    run,
    connection,
    input: { ...run.input, _runId: run.id, _idempotencyKey: run.idempotencyKey },
    emit(stage, message) { appendRunEvent(run.id, stage, message); },
  };
}

async function finishRun(run: RunRecord, outputs: NormalizedOutput[], duration?: number): Promise<void> {
  appendRunEvent(run.id, "saving", "Saving output");
  const prompt = typeof run.input.prompt === "string" ? run.input.prompt : null;
  for (const output of outputs) await persistOutput(run.id, output, { prompt, duration });
  const completedAt = new Date().toISOString();
  updateRun(run.id, { status: "succeeded", completedAt, lockUntil: null, nextPollAt: null, outputJson: JSON.stringify({ count: outputs.length }) });
  appendRunEvent(run.id, "completed", "Completed");
}

function failRun(run: RunRecord, error: unknown): void {
  const connection = run.connectionId ? getConnection(run.connectionId) : null;
  const normalized = normalizeError(error, secretStrings(connection?.credentials ?? {}));
  updateRun(run.id, {
    status: "failed",
    completedAt: new Date().toISOString(),
    lockUntil: null,
    nextPollAt: null,
    errorCode: normalized.code,
    errorMessage: normalized.userMessage,
    errorDetail: normalized.detail ?? null,
  });
  appendRunEvent(run.id, "failed", normalized.userMessage);
}

export async function invokeRun(runId: string): Promise<void> {
  if (!claimRun(runId, 150_000)) return;
  const run = getRun(runId);
  if (!run || ["succeeded", "failed", "cancelled"].includes(run.status) || run.upstreamTaskId) {
    updateRun(runId, { lockUntil: null });
    return;
  }
  try {
    const adapter = getAdapter(run.adapterId);
    const inputAssetIds = findInputAssetIds(run.input);
    inputAssetIds.forEach((assetId) => linkRunAsset(run.id, assetId, "input"));
    updateRun(run.id, { status: "running", startedAt: run.startedAt ?? new Date().toISOString() });
    appendRunEvent(run.id, "preparing", "Preparing input");
    const result = await adapter.invoke(contextFor({ ...run, status: "running" }));
    const fresh = getRun(run.id);
    if (!fresh || fresh.status === "cancelled") return;
    if (result.type === "submitted") {
      const nextPollAt = new Date(Date.now() + Math.max(result.pollAfterMs, 500)).toISOString();
      updateRun(run.id, { status: "queued", upstreamTaskId: result.taskId, nextPollAt, lockUntil: null });
      appendRunEvent(run.id, result.stage ?? "queued", result.stage === "running" ? "Provider is processing" : "Queued by provider");
      return;
    }
    await finishRun(run, result.outputs, result.duration);
  } catch (error) {
    const fresh = getRun(run.id);
    if (fresh?.status !== "cancelled") failRun(run, error);
  }
}

export async function pollRun(runId: string): Promise<void> {
  if (!claimRun(runId, 150_000)) return;
  const run = getRun(runId);
  if (!run || !run.upstreamTaskId || !["queued", "running"].includes(run.status)) {
    updateRun(runId, { lockUntil: null });
    return;
  }
  const nextAttempt = run.pollAttempts + 1;
  try {
    const adapter = getAdapter(run.adapterId);
    if (!adapter.poll) throw new PlatformError("POLL_NOT_SUPPORTED", "This provider did not supply a polling adapter.", 422);
    const result = await adapter.poll(contextFor(run));
    const fresh = getRun(run.id);
    if (!fresh || fresh.status === "cancelled") return;
    if (result.state === "pending") {
      updateRun(run.id, {
        status: result.stage,
        pollAttempts: nextAttempt,
        nextPollAt: new Date(Date.now() + Math.max(result.pollAfterMs, 500)).toISOString(),
        lockUntil: null,
      });
      appendRunEvent(run.id, result.stage, result.message);
      return;
    }
    if (result.state === "failed") {
      throw new PlatformError("ASYNC_TASK_FAILED", result.message, 502, result.detail);
    }
    updateRun(run.id, { pollAttempts: nextAttempt });
    await finishRun(run, result.outputs, result.duration);
  } catch (error) {
    const connection = run.connectionId ? getConnection(run.connectionId) : null;
    const normalized = normalizeError(error, secretStrings(connection?.credentials ?? {}));
    if (normalized.retryable && nextAttempt <= 6) {
      const delay = Math.min(30_000, 1_000 * 2 ** nextAttempt);
      updateRun(run.id, { pollAttempts: nextAttempt, nextPollAt: new Date(Date.now() + delay).toISOString(), lockUntil: null });
      appendRunEvent(run.id, "retrying", "Provider check failed; retrying safely");
      return;
    }
    failRun(run, normalized);
  }
}

export async function cancelRunAndUpstream(runId: string): Promise<boolean> {
  const run = getRun(runId);
  if (!run || !cancelRun(runId)) return false;
  try {
    const adapter = getAdapter(run.adapterId);
    if (adapter.cancel) await adapter.cancel(contextFor(run));
  } catch {
    appendRunEvent(runId, "cancelled", "Cancelled locally; the provider did not confirm cancellation");
  }
  return true;
}

export function retryRun(runId: string): RunRecord {
  const original = getRun(runId);
  if (!original) throw new PlatformError("RUN_NOT_FOUND", "This run no longer exists.", 404);
  if (!["failed", "cancelled"].includes(original.status)) {
    throw new PlatformError("RUN_NOT_RETRYABLE", "Only failed or cancelled runs can be retried.", 409);
  }
  return createRun({
    capability: original.capability,
    adapterId: original.adapterId,
    connectionId: original.connectionId,
    modelId: original.modelId,
    modelName: original.modelName,
    values: original.input,
    parentRunId: original.id,
    attempt: original.attempt + 1,
  });
}
