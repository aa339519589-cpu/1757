import { PlatformError } from "../errors";
import { customAdapter } from "./custom";
import { demoAdapter } from "./demo";
import { openAiCompatibleAdapter, openAiImagesAdapter } from "./openai";
import type { ProviderAdapter } from "./types";

const adapters = new Map<string, ProviderAdapter>([
  [demoAdapter.id, demoAdapter],
  [openAiCompatibleAdapter.id, openAiCompatibleAdapter],
  [openAiImagesAdapter.id, openAiImagesAdapter],
  [customAdapter.id, customAdapter],
]);

export function getAdapter(id: string): ProviderAdapter {
  const adapter = adapters.get(id);
  if (!adapter) throw new PlatformError("ADAPTER_NOT_FOUND", "This provider adapter is not installed.", 422);
  return adapter;
}
