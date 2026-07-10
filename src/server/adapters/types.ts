import type { ConnectionInternal } from "../repository";
import type { NormalizedOutput, RunRecord } from "@/lib/types";

export interface AdapterContext {
  run: RunRecord;
  connection: ConnectionInternal | null;
  input: Record<string, unknown>;
  emit(stage: string, message: string): void;
}

export type InvokeResult =
  | { type: "complete"; outputs: NormalizedOutput[]; duration?: number }
  | { type: "submitted"; taskId: string; pollAfterMs: number; stage?: string };

export type PollResult =
  | { state: "pending"; stage: "queued" | "running"; message: string; pollAfterMs: number }
  | { state: "complete"; outputs: NormalizedOutput[]; duration?: number }
  | { state: "failed"; message: string; detail?: string };

export interface ProviderAdapter {
  id: string;
  validate(connection: ConnectionInternal, testInput?: Record<string, unknown>): Promise<{ message: string }>;
  invoke(context: AdapterContext): Promise<InvokeResult>;
  poll?(context: AdapterContext): Promise<PollResult>;
  cancel?(context: AdapterContext): Promise<void>;
}
