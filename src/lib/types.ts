export type Capability =
  | "talk"
  | "image"
  | "video"
  | "audio"
  | "transform"
  | "analyze";

export type OutputKind = "text" | "image" | "video" | "audio" | "file" | "json";
export type RunStatus = "created" | "queued" | "running" | "succeeded" | "failed" | "cancelled";
export type ConnectionKind = "demo" | "openai_compatible" | "openai_images" | "custom";

export interface FieldOption {
  label: string;
  value: string;
}

export interface InputField {
  id: string;
  label: string;
  type: "text" | "textarea" | "number" | "slider" | "select" | "boolean" | "asset" | "file";
  required?: boolean;
  advanced?: boolean;
  description?: string;
  placeholder?: string;
  defaultValue?: string | number | boolean;
  min?: number;
  max?: number;
  step?: number;
  options?: FieldOption[];
  accept?: OutputKind[];
  mapping?: {
    target: "body" | "query" | "header" | "path";
    key: string;
    encoding?: "value" | "base64" | "data-url" | "binary";
  };
}

export interface ModelManifest {
  id: string;
  providerId: string;
  connectionId?: string;
  modelId: string;
  displayName: string;
  providerName: string;
  capability: Capability;
  description: string;
  mode: "sync" | "async";
  inputSchema: InputField[];
  supportedInputs: Array<"text" | OutputKind>;
  supportedOutputs: OutputKind[];
  actions: Capability[];
  badges?: string[];
  costLabel?: string;
}

export interface ConnectionPublic {
  id: string;
  kind: ConnectionKind;
  name: string;
  description: string;
  capability: Capability | "multi";
  baseUrl: string | null;
  status: "connected" | "error" | "untested";
  keyHint: string | null;
  modelCount: number;
  lastTestedAt: string | null;
  lastError: string | null;
  createdAt: string;
  config?: Record<string, unknown>;
}

export interface RunEventRecord {
  id: number;
  runId: string;
  stage: string;
  message: string;
  createdAt: string;
}

export interface AssetRecord {
  id: string;
  kind: OutputKind;
  name: string;
  mimeType: string;
  size: number;
  width: number | null;
  height: number | null;
  duration: number | null;
  sourceRunId: string | null;
  parentAssetId: string | null;
  prompt: string | null;
  text: string | null;
  url: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface RunRecord {
  id: string;
  idempotencyKey: string;
  capability: Capability;
  adapterId: string;
  connectionId: string | null;
  modelId: string;
  modelName: string;
  input: Record<string, unknown>;
  status: RunStatus;
  upstreamTaskId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  errorDetail: string | null;
  parentRunId: string | null;
  attempt: number;
  pollAttempts: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
  assets: AssetRecord[];
  events: RunEventRecord[];
}

export interface NormalizedOutput {
  kind: OutputKind;
  name?: string;
  mimeType?: string;
  text?: string;
  json?: unknown;
  base64?: string;
  url?: string;
  localPath?: string;
  metadata?: Record<string, unknown>;
  parentAssetId?: string;
}

export interface CustomConnectorConfig {
  capability: Capability;
  modelId: string;
  modelName: string;
  description?: string;
  endpoint: string;
  method: "GET" | "POST" | "PUT" | "PATCH";
  contentType: "application/json" | "multipart/form-data" | "application/x-www-form-urlencoded";
  bodyTemplate?: unknown;
  inputSchema: InputField[];
  response: Partial<Record<OutputKind | "taskId", string>>;
  async?: {
    enabled: boolean;
    pollEndpoint: string;
    pollMethod: "GET" | "POST";
    intervalMs: number;
    statusPath: string;
    pendingValues: string[];
    successValues: string[];
    failureValues: string[];
    errorPath?: string;
    maxAttempts: number;
    cancelEndpoint?: string;
    cancelMethod?: "POST" | "DELETE";
  };
}
