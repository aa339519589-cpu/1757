import type { ConnectionPublic, ModelManifest } from "@/lib/types";
import { listConnections } from "./repository";

export const demoManifests: ModelManifest[] = [
  {
    id: "demo:still",
    providerId: "demo",
    modelId: "demo-still-v1",
    displayName: "Studio Still",
    providerName: "Demo",
    capability: "image",
    description: "A local, deterministic image study for exploring the complete workflow.",
    mode: "sync",
    supportedInputs: ["text"],
    supportedOutputs: ["image"],
    inputSchema: [
      { id: "prompt", label: "Describe the image", type: "textarea", required: true, placeholder: "A quiet architectural study at blue hour" },
      { id: "aspectRatio", label: "Frame", type: "select", defaultValue: "4:3", options: [
        { label: "Landscape 4:3", value: "4:3" },
        { label: "Square 1:1", value: "1:1" },
        { label: "Portrait 3:4", value: "3:4" },
      ] },
      { id: "variation", label: "Variation", type: "slider", min: 1, max: 8, step: 1, defaultValue: 3, advanced: true },
    ],
    actions: ["video", "transform", "analyze"],
    badges: ["Demo"],
  },
  {
    id: "demo:motion",
    providerId: "demo",
    modelId: "demo-motion-v1",
    displayName: "Studio Motion",
    providerName: "Demo",
    capability: "video",
    description: "A local asynchronous motion study that produces a real MP4 asset.",
    mode: "async",
    supportedInputs: ["text", "image"],
    supportedOutputs: ["video"],
    inputSchema: [
      { id: "image", label: "Starting image", type: "asset", accept: ["image"] },
      { id: "prompt", label: "Describe the motion", type: "textarea", required: true, placeholder: "A slow, deliberate camera push" },
      { id: "duration", label: "Duration", type: "select", defaultValue: "4", options: [
        { label: "4 seconds", value: "4" },
      ], advanced: true },
    ],
    actions: ["analyze", "transform"],
    badges: ["Demo", "Async"],
  },
  {
    id: "demo:talk",
    providerId: "demo",
    modelId: "demo-dialogue-v1",
    displayName: "Studio Dialogue",
    providerName: "Demo",
    capability: "talk",
    description: "A deterministic local response for testing conversation history.",
    mode: "sync",
    supportedInputs: ["text", "image", "file"],
    supportedOutputs: ["text"],
    inputSchema: [
      { id: "prompt", label: "Message", type: "textarea", required: true, placeholder: "Ask anything" },
      { id: "system", label: "System instruction", type: "textarea", advanced: true },
    ],
    actions: ["image", "analyze"],
    badges: ["Demo"],
  },
  {
    id: "demo:analyze",
    providerId: "demo",
    modelId: "demo-analysis-v1",
    displayName: "Studio Analysis",
    providerName: "Demo",
    capability: "analyze",
    description: "Inspects persisted asset metadata without sending data off-device.",
    mode: "sync",
    supportedInputs: ["text", "image", "video", "audio", "file"],
    supportedOutputs: ["text", "json"],
    inputSchema: [
      { id: "asset", label: "Asset", type: "asset", accept: ["image", "video", "audio", "file"] },
      { id: "prompt", label: "What should be analyzed?", type: "textarea", required: true, defaultValue: "Summarize this asset" },
    ],
    actions: ["talk", "image"],
    badges: ["Demo", "Local"],
  },
];

function connectionManifests(connection: ConnectionPublic): ModelManifest[] {
  const config = connection.config ?? {};
  if (connection.kind === "openai_compatible") {
    const models = Array.isArray(config.models) ? config.models.map(String) : [String(config.modelId ?? "")].filter(Boolean);
    return models.map((modelId) => ({
      id: `${connection.id}:${modelId}`,
      connectionId: connection.id,
      providerId: connection.id,
      modelId,
      displayName: modelId,
      providerName: connection.name,
      capability: "talk",
      description: `Chat through ${connection.name}.`,
      mode: "sync",
      supportedInputs: ["text"],
      supportedOutputs: ["text"],
      inputSchema: [
        { id: "prompt", label: "Message", type: "textarea", required: true, placeholder: "Ask anything" },
        { id: "system", label: "System instruction", type: "textarea", advanced: true },
        { id: "temperature", label: "Temperature", type: "slider", min: 0, max: 2, step: 0.1, defaultValue: 0.7, advanced: true },
        { id: "maxTokens", label: "Max tokens", type: "number", min: 1, max: 32768, defaultValue: 2048, advanced: true },
      ],
      actions: ["image", "analyze"],
    }));
  }
  if (connection.kind === "openai_images") {
    const modelId = String(config.modelId ?? "gpt-image-2");
    return [{
      id: `${connection.id}:${modelId}`,
      connectionId: connection.id,
      providerId: connection.id,
      modelId,
      displayName: String(config.modelName ?? "GPT Image 2"),
      providerName: connection.name,
      capability: "image",
      description: "Generate a persisted image with the official OpenAI Image API.",
      mode: "sync",
      supportedInputs: ["text"],
      supportedOutputs: ["image"],
      inputSchema: [
        { id: "prompt", label: "Describe the image", type: "textarea", required: true, placeholder: "A precise product photograph" },
        { id: "size", label: "Size", type: "select", defaultValue: "auto", options: [
          { label: "Auto", value: "auto" },
          { label: "Square · 1024", value: "1024x1024" },
          { label: "Landscape · 1536×1024", value: "1536x1024" },
          { label: "Portrait · 1024×1536", value: "1024x1536" },
        ] },
        { id: "quality", label: "Quality", type: "select", defaultValue: "auto", options: [
          { label: "Auto", value: "auto" }, { label: "Low", value: "low" }, { label: "Medium", value: "medium" }, { label: "High", value: "high" },
        ], advanced: true },
      ],
      actions: ["video", "transform", "analyze"],
      badges: ["Official API"],
    }];
  }
  if (connection.kind === "custom" && config.manifest && typeof config.manifest === "object") {
    return [{ ...(config.manifest as ModelManifest), id: `${connection.id}:${String((config.manifest as ModelManifest).modelId)}`, providerId: connection.id, providerName: connection.name, connectionId: connection.id }];
  }
  return [];
}

export function listModelManifests(): ModelManifest[] {
  return [...demoManifests, ...listConnections().flatMap(connectionManifests)];
}

export function getManifest(id: string): ModelManifest | null {
  return listModelManifests().find((manifest) => manifest.id === id) ?? null;
}
