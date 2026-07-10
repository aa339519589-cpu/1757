import { randomUUID } from "node:crypto";
import type {
  AssetRecord,
  Capability,
  ConnectionKind,
  ConnectionPublic,
  OutputKind,
  RunEventRecord,
  RunRecord,
  RunStatus,
} from "@/lib/types";
import { db, nowIso } from "./db";
import { decryptCredentials } from "./vault";

type DbRow = Record<string, unknown>;

export interface ConnectionInternal extends ConnectionPublic {
  credentials: Record<string, unknown>;
}

export interface AssetInternal extends AssetRecord {
  storageKey: string | null;
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || !value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function mapConnection(row: DbRow): ConnectionPublic {
  const config = parseJson<Record<string, unknown>>(row.config_json, {});
  return {
    id: String(row.id),
    kind: String(row.kind) as ConnectionKind,
    name: String(row.name),
    description: String(row.description ?? ""),
    capability: String(row.capability) as Capability | "multi",
    baseUrl: row.base_url ? String(row.base_url) : null,
    status: String(row.status) as ConnectionPublic["status"],
    keyHint: row.key_hint ? String(row.key_hint) : null,
    modelCount: Array.isArray(config.models) ? config.models.length : 1,
    lastTestedAt: row.last_tested_at ? String(row.last_tested_at) : null,
    lastError: row.last_error ? String(row.last_error) : null,
    createdAt: String(row.created_at),
    config,
  };
}

function mapAsset(row: DbRow): AssetInternal {
  return {
    id: String(row.id),
    kind: String(row.kind) as OutputKind,
    name: String(row.name),
    mimeType: String(row.mime_type),
    size: Number(row.size ?? 0),
    width: row.width === null || row.width === undefined ? null : Number(row.width),
    height: row.height === null || row.height === undefined ? null : Number(row.height),
    duration: row.duration === null || row.duration === undefined ? null : Number(row.duration),
    sourceRunId: row.source_run_id ? String(row.source_run_id) : null,
    parentAssetId: row.parent_asset_id ? String(row.parent_asset_id) : null,
    prompt: row.prompt ? String(row.prompt) : null,
    text: row.content_text ? String(row.content_text) : null,
    storageKey: row.storage_key ? String(row.storage_key) : null,
    url: `/api/assets/${String(row.id)}/content`,
    metadata: parseJson<Record<string, unknown>>(row.metadata_json, {}),
    createdAt: String(row.created_at),
  };
}

function mapEvent(row: DbRow): RunEventRecord {
  return {
    id: Number(row.id),
    runId: String(row.run_id),
    stage: String(row.stage),
    message: String(row.message),
    createdAt: String(row.created_at),
  };
}

function mapRun(row: DbRow, includeRelations = true): RunRecord {
  const id = String(row.id);
  const assets = includeRelations
    ? (db.prepare(`
        SELECT a.* FROM assets a
        JOIN run_assets ra ON ra.asset_id = a.id
        WHERE ra.run_id = ? AND ra.role = 'output'
        ORDER BY a.created_at ASC
      `).all(id) as DbRow[]).map(mapAsset)
    : [];
  const events = includeRelations
    ? (db.prepare("SELECT * FROM run_events WHERE run_id = ? ORDER BY id ASC").all(id) as DbRow[]).map(mapEvent)
    : [];
  return {
    id,
    idempotencyKey: String(row.idempotency_key),
    capability: String(row.capability) as Capability,
    adapterId: String(row.adapter_id),
    connectionId: row.connection_id ? String(row.connection_id) : null,
    modelId: String(row.model_id),
    modelName: String(row.model_name),
    input: parseJson<Record<string, unknown>>(row.input_json, {}),
    status: String(row.status) as RunStatus,
    upstreamTaskId: row.upstream_task_id ? String(row.upstream_task_id) : null,
    errorCode: row.error_code ? String(row.error_code) : null,
    errorMessage: row.error_message ? String(row.error_message) : null,
    errorDetail: row.error_detail ? String(row.error_detail) : null,
    parentRunId: row.parent_run_id ? String(row.parent_run_id) : null,
    attempt: Number(row.attempt ?? 1),
    pollAttempts: Number(row.poll_attempts ?? 0),
    createdAt: String(row.created_at),
    startedAt: row.started_at ? String(row.started_at) : null,
    completedAt: row.completed_at ? String(row.completed_at) : null,
    updatedAt: String(row.updated_at),
    assets,
    events,
  };
}

export function listConnections(): ConnectionPublic[] {
  return (db.prepare("SELECT * FROM provider_connections ORDER BY created_at DESC").all() as DbRow[]).map(mapConnection);
}

export function getConnection(id: string): ConnectionInternal | null {
  const row = db.prepare("SELECT * FROM provider_connections WHERE id = ?").get(id) as DbRow | undefined;
  if (!row) return null;
  return { ...mapConnection(row), credentials: decryptCredentials(row.credentials_enc ? String(row.credentials_enc) : null) };
}

export function insertConnection(input: {
  kind: Exclude<ConnectionKind, "demo">;
  name: string;
  description?: string;
  capability: Capability | "multi";
  baseUrl?: string | null;
  config: Record<string, unknown>;
  encryptedCredentials: string;
  keyHint: string | null;
}): ConnectionPublic {
  const id = randomUUID();
  const now = nowIso();
  db.prepare(`
    INSERT INTO provider_connections
      (id, kind, name, description, capability, base_url, status, config_json, credentials_enc, key_hint, last_tested_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'connected', ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.kind,
    input.name,
    input.description ?? "",
    input.capability,
    input.baseUrl ?? null,
    JSON.stringify(input.config),
    input.encryptedCredentials,
    input.keyHint,
    now,
    now,
    now,
  );
  return mapConnection(db.prepare("SELECT * FROM provider_connections WHERE id = ?").get(id) as DbRow);
}

export function markConnectionResult(id: string, ok: boolean, message?: string): void {
  const now = nowIso();
  db.prepare(`UPDATE provider_connections SET status = ?, last_error = ?, last_tested_at = ?, updated_at = ? WHERE id = ?`)
    .run(ok ? "connected" : "error", ok ? null : message?.slice(0, 500) ?? "Connection test failed.", now, now, id);
}

export function removeConnection(id: string): boolean {
  return db.prepare("DELETE FROM provider_connections WHERE id = ?").run(id).changes > 0;
}

export function createRun(input: {
  capability: Capability;
  adapterId: string;
  connectionId?: string | null;
  modelId: string;
  modelName: string;
  values: Record<string, unknown>;
  idempotencyKey?: string;
  parentRunId?: string | null;
  attempt?: number;
}): RunRecord {
  const id = randomUUID();
  const now = nowIso();
  db.prepare(`
    INSERT INTO runs
      (id, idempotency_key, capability, adapter_id, connection_id, model_id, model_name, input_json, status, parent_run_id, attempt, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'created', ?, ?, ?, ?)
  `).run(
    id,
    input.idempotencyKey ?? randomUUID(),
    input.capability,
    input.adapterId,
    input.connectionId ?? null,
    input.modelId,
    input.modelName,
    JSON.stringify(input.values),
    input.parentRunId ?? null,
    input.attempt ?? 1,
    now,
    now,
  );
  appendRunEvent(id, "created", "Run created");
  return getRun(id)!;
}

export function getRun(id: string): RunRecord | null {
  const row = db.prepare("SELECT * FROM runs WHERE id = ?").get(id) as DbRow | undefined;
  return row ? mapRun(row) : null;
}

export function getRunByIdempotencyKey(key: string): RunRecord | null {
  const row = db.prepare("SELECT * FROM runs WHERE idempotency_key = ?").get(key) as DbRow | undefined;
  return row ? mapRun(row) : null;
}

export function listRuns(limit = 50): RunRecord[] {
  return (db.prepare("SELECT * FROM runs ORDER BY created_at DESC LIMIT ?").all(Math.min(limit, 100)) as DbRow[])
    .map((row) => mapRun(row));
}

export function appendRunEvent(runId: string, stage: string, message: string): void {
  const last = db.prepare("SELECT stage, message FROM run_events WHERE run_id = ? ORDER BY id DESC LIMIT 1").get(runId) as DbRow | undefined;
  if (last?.stage === stage && last?.message === message) return;
  db.prepare("INSERT INTO run_events (run_id, stage, message, created_at) VALUES (?, ?, ?, ?)")
    .run(runId, stage, message, nowIso());
}

export function updateRun(
  id: string,
  patch: Partial<{
    status: RunStatus;
    upstreamTaskId: string | null;
    nextPollAt: string | null;
    pollAttempts: number;
    lockUntil: string | null;
    startedAt: string | null;
    completedAt: string | null;
    errorCode: string | null;
    errorMessage: string | null;
    errorDetail: string | null;
    outputJson: string | null;
  }>,
): void {
  const columns: Record<string, string> = {
    status: "status",
    upstreamTaskId: "upstream_task_id",
    nextPollAt: "next_poll_at",
    pollAttempts: "poll_attempts",
    lockUntil: "lock_until",
    startedAt: "started_at",
    completedAt: "completed_at",
    errorCode: "error_code",
    errorMessage: "error_message",
    errorDetail: "error_detail",
    outputJson: "output_json",
  };
  const entries = Object.entries(patch).filter(([key]) => columns[key]);
  if (entries.length === 0) return;
  const sql = entries.map(([key]) => `${columns[key]} = ?`).join(", ");
  db.prepare(`UPDATE runs SET ${sql}, updated_at = ? WHERE id = ?`).run(...entries.map(([, value]) => value ?? null), nowIso(), id);
}

export function claimRun(id: string, leaseMs = 30_000): boolean {
  const now = nowIso();
  const lock = new Date(Date.now() + leaseMs).toISOString();
  return db.prepare(`
    UPDATE runs SET lock_until = ?, updated_at = ?
    WHERE id = ? AND (lock_until IS NULL OR lock_until < ?)
  `).run(lock, now, id, now).changes > 0;
}

export function findInvokableRuns(limit = 4): RunRecord[] {
  const now = nowIso();
  return (db.prepare(`
    SELECT * FROM runs
    WHERE status IN ('created', 'queued', 'running') AND upstream_task_id IS NULL
      AND (lock_until IS NULL OR lock_until < ?)
    ORDER BY created_at ASC LIMIT ?
  `).all(now, limit) as DbRow[]).map((row) => mapRun(row, false));
}

export function findPollableRuns(limit = 8): RunRecord[] {
  const now = nowIso();
  return (db.prepare(`
    SELECT * FROM runs
    WHERE status IN ('queued', 'running') AND upstream_task_id IS NOT NULL
      AND (next_poll_at IS NULL OR next_poll_at <= ?)
      AND (lock_until IS NULL OR lock_until < ?)
    ORDER BY next_poll_at ASC LIMIT ?
  `).all(now, now, limit) as DbRow[]).map((row) => mapRun(row, false));
}

export function cancelRun(id: string): boolean {
  const now = nowIso();
  const result = db.prepare(`
    UPDATE runs SET status = 'cancelled', completed_at = ?, lock_until = NULL, updated_at = ?
    WHERE id = ? AND status NOT IN ('succeeded', 'failed', 'cancelled')
  `).run(now, now, id);
  if (result.changes > 0) appendRunEvent(id, "cancelled", "Run cancelled");
  return result.changes > 0;
}

export function insertAsset(input: {
  kind: OutputKind;
  name: string;
  mimeType: string;
  storageKey?: string | null;
  text?: string | null;
  size?: number;
  width?: number | null;
  height?: number | null;
  duration?: number | null;
  sourceRunId?: string | null;
  parentAssetId?: string | null;
  prompt?: string | null;
  metadata?: Record<string, unknown>;
}): AssetInternal {
  const id = randomUUID();
  db.prepare(`
    INSERT INTO assets
      (id, kind, name, mime_type, storage_key, content_text, size, width, height, duration, source_run_id, parent_asset_id, prompt, metadata_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.kind,
    input.name,
    input.mimeType,
    input.storageKey ?? null,
    input.text ?? null,
    input.size ?? 0,
    input.width ?? null,
    input.height ?? null,
    input.duration ?? null,
    input.sourceRunId ?? null,
    input.parentAssetId ?? null,
    input.prompt ?? null,
    JSON.stringify(input.metadata ?? {}),
    nowIso(),
  );
  return getAsset(id)!;
}

export function linkRunAsset(runId: string, assetId: string, role: "input" | "output" = "output"): void {
  db.prepare("INSERT OR IGNORE INTO run_assets (run_id, asset_id, role) VALUES (?, ?, ?)").run(runId, assetId, role);
}

export function getAsset(id: string): AssetInternal | null {
  const row = db.prepare("SELECT * FROM assets WHERE id = ?").get(id) as DbRow | undefined;
  return row ? mapAsset(row) : null;
}

export function listAssets(limit = 100): AssetRecord[] {
  return (db.prepare("SELECT * FROM assets ORDER BY created_at DESC LIMIT ?").all(Math.min(limit, 200)) as DbRow[]).map(mapAsset);
}

export function findInputAssetIds(input: Record<string, unknown>): string[] {
  return [...new Set(Object.values(input).filter((value): value is string => typeof value === "string" && Boolean(getAsset(value))))];
}
