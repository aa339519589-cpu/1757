import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export const dataRoot = path.resolve(process.cwd(), ".data");
export const assetRoot = path.join(dataRoot, "assets");

mkdirSync(assetRoot, { recursive: true, mode: 0o700 });

const globalForDb = globalThis as unknown as { __relayDb?: DatabaseSync };
const buildMode = process.env.RELAY_BUILD_MODE === "1";
const databasePath = buildMode ? ":memory:" : path.join(dataRoot, "platform.sqlite");

export const db = globalForDb.__relayDb ?? new DatabaseSync(databasePath);

if (process.env.NODE_ENV !== "production" && !buildMode) {
  globalForDb.__relayDb = db;
}

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS provider_connections (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    capability TEXT NOT NULL DEFAULT 'multi',
    base_url TEXT,
    status TEXT NOT NULL DEFAULT 'untested',
    config_json TEXT NOT NULL DEFAULT '{}',
    credentials_enc TEXT,
    key_hint TEXT,
    last_tested_at TEXT,
    last_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    idempotency_key TEXT NOT NULL UNIQUE,
    capability TEXT NOT NULL,
    adapter_id TEXT NOT NULL,
    connection_id TEXT REFERENCES provider_connections(id) ON DELETE SET NULL,
    model_id TEXT NOT NULL,
    model_name TEXT NOT NULL,
    input_json TEXT NOT NULL,
    status TEXT NOT NULL,
    upstream_task_id TEXT,
    output_json TEXT,
    error_code TEXT,
    error_message TEXT,
    error_detail TEXT,
    parent_run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
    attempt INTEGER NOT NULL DEFAULT 1,
    poll_attempts INTEGER NOT NULL DEFAULT 0,
    next_poll_at TEXT,
    lock_until TEXT,
    created_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS run_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    stage TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS assets (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    storage_key TEXT,
    content_text TEXT,
    size INTEGER NOT NULL DEFAULT 0,
    width INTEGER,
    height INTEGER,
    duration REAL,
    source_run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
    parent_asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
    prompt TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS run_assets (
    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'output',
    PRIMARY KEY (run_id, asset_id, role)
  );

  CREATE INDEX IF NOT EXISTS idx_runs_status_poll ON runs(status, next_poll_at);
  CREATE INDEX IF NOT EXISTS idx_runs_created ON runs(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_events_run ON run_events(run_id, id);
  CREATE INDEX IF NOT EXISTS idx_assets_created ON assets(created_at DESC);
`);

export function nowIso(): string {
  return new Date().toISOString();
}
