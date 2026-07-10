"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowUp, ChevronDown, Paperclip, SlidersHorizontal, X } from "lucide-react";
import type { AssetRecord, Capability, ModelManifest, RunRecord } from "@/lib/types";
import { api, ApiError } from "@/lib/client-api";
import { ModelPicker } from "./model-picker";
import { RunStage } from "./run-stage";
import { SchemaFields } from "./schema-fields";

const capabilityOptions: Array<{ id: Capability; label: string }> = [
  { id: "talk", label: "Talk" },
  { id: "image", label: "Image" },
  { id: "video", label: "Video" },
  { id: "analyze", label: "Analyze" },
];

function inferCapability(prompt: string, asset?: AssetRecord): Capability {
  const value = prompt.toLowerCase();
  if (/\b(video|animate|motion|moving|move)\b|视频|动画|动起来/.test(value)) return "video";
  if (/\b(analy[sz]e|inspect|summari[sz]e|extract|review)\b|分析|总结|提取/.test(value)) return "analyze";
  if (/\b(image|picture|photo|illustration|poster|draw|render)\b|生成.{0,5}(图|海报)|图片|画一/.test(value)) return "image";
  if (asset && asset.kind !== "text") return "analyze";
  return "talk";
}

function defaultValues(manifest: ModelManifest, previous: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const field of manifest.inputSchema) {
    if (field.id in previous) next[field.id] = previous[field.id];
    else if (field.defaultValue !== undefined) next[field.id] = field.defaultValue;
    else if (field.type === "boolean") next[field.id] = false;
    else next[field.id] = "";
  }
  if (typeof previous.prompt === "string") next.prompt = previous.prompt;
  return next;
}

export function CreateStudio() {
  const searchParams = useSearchParams();
  const [models, setModels] = useState<ModelManifest[]>([]);
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [capability, setCapability] = useState<Capability>("talk");
  const [selectedId, setSelectedId] = useState("");
  const [values, setValues] = useState<Record<string, unknown>>({ prompt: "" });
  const [advanced, setAdvanced] = useState(false);
  const [run, setRun] = useState<RunRecord | null>(null);
  const [parentRunId, setParentRunId] = useState<string | null>(null);
  const [pendingAsset, setPendingAsset] = useState<AssetRecord | null>(null);
  const [uploading, setUploading] = useState(false);
  const [handoff, setHandoff] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);
  const manualCapability = useRef(false);

  const capabilityModels = useMemo(() => models.filter((model) => model.capability === capability), [models, capability]);
  const selected = capabilityModels.find((model) => model.id === selectedId) ?? capabilityModels[0] ?? null;
  const formValues = useMemo(() => {
    if (!selected) return values;
    const next = defaultValues(selected, values);
    if (pendingAsset) {
      const field = selected.inputSchema.find((candidate) => (candidate.type === "asset" || candidate.type === "file") && (!candidate.accept?.length || candidate.accept.includes(pendingAsset.kind)));
      if (field) next[field.id] = pendingAsset.id;
      else if (pendingAsset.kind === "text" && pendingAsset.text && selected.inputSchema.some((candidate) => candidate.id === "prompt")) next.prompt = pendingAsset.text;
    }
    return next;
  }, [selected, values, pendingAsset]);
  const attachedAsset = useMemo(() => {
    const assetId = Object.values(formValues).find((value) => typeof value === "string" && assets.some((asset) => asset.id === value));
    return assets.find((asset) => asset.id === assetId) ?? pendingAsset;
  }, [formValues, assets, pendingAsset]);

  useEffect(() => {
    let alive = true;
    Promise.all([
      api<{ models: ModelManifest[] }>("/api/models"),
      api<{ assets: AssetRecord[] }>("/api/assets?limit=100"),
    ]).then(([modelData, assetData]) => {
      if (!alive) return;
      setModels(modelData.models);
      setAssets(assetData.assets);
      const requestedCapability = searchParams.get("capability") as Capability | null;
      if (requestedCapability && capabilityOptions.some((item) => item.id === requestedCapability)) {
        manualCapability.current = true;
        setCapability(requestedCapability);
      }
      const requestedAsset = searchParams.get("asset");
      if (requestedAsset) setPendingAsset(assetData.assets.find((asset) => asset.id === requestedAsset) ?? null);
    }).catch((requestError) => setError(requestError instanceof ApiError ? requestError : new ApiError("Relay could not load its workspace."))).finally(() => setLoading(false));
    return () => { alive = false; };
  }, [searchParams]);

  const runId = run?.id;
  const runStatus = run?.status;
  useEffect(() => {
    if (!runId || !runStatus || ["succeeded", "failed", "cancelled"].includes(runStatus)) return;
    const source = new EventSource(`/api/runs/${runId}/events`);
    source.addEventListener("run", (event) => {
      const next = JSON.parse((event as MessageEvent).data) as RunRecord;
      setRun(next);
      if (["succeeded", "failed", "cancelled"].includes(next.status)) {
        source.close();
        if (next.assets.length) setAssets((current) => [...next.assets.filter((asset) => !current.some((item) => item.id === asset.id)), ...current]);
      }
    });
    source.onerror = () => {
      source.close();
      void api<{ run: RunRecord }>(`/api/runs/${runId}`).then((data) => setRun(data.run)).catch(() => undefined);
    };
    return () => source.close();
  }, [runId, runStatus]);

  const updateValue = useCallback((id: string, value: unknown) => setValues((current) => ({ ...current, [id]: value })), []);

  function updatePrompt(prompt: string) {
    updateValue("prompt", prompt);
    if (!manualCapability.current) {
      const inferred = inferCapability(prompt, attachedAsset ?? undefined);
      if (inferred !== capability) setCapability(inferred);
    }
  }

  function selectCapability(next: Capability) {
    manualCapability.current = true;
    setCapability(next);
    setError(null);
  }

  async function upload(file: File) {
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const { asset } = await api<{ asset: AssetRecord }>("/api/assets", { method: "POST", body: form });
      setAssets((current) => [asset, ...current]);
      setPendingAsset(asset);
      if (!manualCapability.current) setCapability(inferCapability(String(formValues.prompt ?? ""), asset));
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError : new ApiError("The file could not be uploaded."));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function startRun() {
    if (!selected) return;
    setError(null);
    try {
      const result = await api<{ run: RunRecord }>("/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ manifestId: selected.id, values: formValues, parentRunId: parentRunId ?? undefined, idempotencyKey: crypto.randomUUID() }),
      });
      setRun(result.run);
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError : new ApiError("The run could not be created."));
    }
  }

  function useAsset(nextCapability: Capability, asset: AssetRecord) {
    setHandoff(true);
    window.setTimeout(() => {
      setRun(null);
      setParentRunId(null);
      manualCapability.current = true;
      setCapability(nextCapability);
      setPendingAsset(asset);
      setValues((current) => ({ prompt: asset.kind === "text" && asset.text ? asset.text : String(current.prompt ?? "") }));
      setHandoff(false);
      setError(null);
    }, 280);
  }

  function remix() {
    setRun(null);
    setParentRunId(null);
    setValues((current) => ({ ...current, variation: Number(current.variation ?? 2) % 8 + 1 }));
  }

  function continueTalk() {
    if (!run) return;
    setParentRunId(run.id);
    setRun(null);
    setValues((current) => ({ ...current, prompt: "" }));
  }

  async function retry() {
    if (!run) return;
    try {
      const result = await api<{ run: RunRecord }>(`/api/runs/${run.id}/retry`, { method: "POST" });
      setRun(result.run);
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError : new ApiError("The run could not be retried."));
    }
  }

  async function cancel() {
    if (!run) return;
    try {
      const result = await api<{ run: RunRecord }>(`/api/runs/${run.id}`, { method: "DELETE" });
      setRun(result.run);
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError : new ApiError("The run could not be cancelled."));
    }
  }

  const phase = handoff ? "handoff" : run?.status === "succeeded" ? "complete" : run ? (run.status === "failed" || run.status === "cancelled" ? "failed" : "running") : "idle";
  const promptField = selected?.inputSchema.find((field) => field.id === "prompt");
  const hasAdvanced = selected?.inputSchema.some((field) => field.advanced);

  return (
    <div className={`create-page phase-${phase}`}>
      <div className="create-hero">
        <span>{capabilityOptions.find((item) => item.id === capability)?.label ?? "Create"}</span>
        <h1>What do you want to make?</h1>
      </div>
      <div className="studio-grid">
        <section className="composer" aria-label="Universal composer">
          <div className="capability-switch" role="tablist" aria-label="Capability">
            {capabilityOptions.map((item) => <button key={item.id} type="button" role="tab" aria-selected={capability === item.id} className={capability === item.id ? "active" : ""} onClick={() => selectCapability(item.id)}>{item.label}</button>)}
          </div>
          {attachedAsset && (
            <div className="attached-asset">
              {attachedAsset.kind === "image" ? <img src={attachedAsset.url} alt="" /> : <span className={`asset-kind asset-kind-${attachedAsset.kind}`}>{attachedAsset.kind.slice(0, 1).toUpperCase()}</span>}
              <div><strong>{attachedAsset.name}</strong><small>Ready as {attachedAsset.kind} input</small></div>
              <button type="button" aria-label="Remove attached asset" onClick={() => { setPendingAsset(null); setValues((current) => Object.fromEntries(Object.entries(current).map(([key, value]) => [key, value === attachedAsset.id ? "" : value]))); }}><X size={15} /></button>
            </div>
          )}
          <textarea
            className="composer-prompt"
            aria-label={promptField?.label ?? "Prompt"}
            placeholder={promptField?.placeholder ?? "Ask, create, transform, or analyze"}
            value={String(formValues.prompt ?? "")}
            onChange={(event) => updatePrompt(event.target.value)}
            disabled={phase === "running"}
          />
          {selected && <SchemaFields manifest={selected} values={formValues} assets={assets} advanced={false} onChange={updateValue} />}
          {advanced && selected && <SchemaFields manifest={selected} values={formValues} assets={assets} advanced onChange={updateValue} />}
          {error && <div className="inline-error" role="alert"><strong>{error.message}</strong>{error.detail && <span>{error.detail}</span>}</div>}
          <footer className="composer-footer">
            <ModelPicker models={capabilityModels} selectedId={selected?.id ?? ""} onSelect={(model) => { setSelectedId(model.id); setError(null); }} />
            <div className="composer-tools">
              {hasAdvanced && <button className={`tool-button ${advanced ? "active" : ""}`} type="button" onClick={() => setAdvanced((value) => !value)} aria-expanded={advanced}><SlidersHorizontal size={17} /><span>Advanced</span><ChevronDown size={14} /></button>}
              <input ref={fileRef} type="file" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); }} />
              <button className="tool-button attachment-button" type="button" onClick={() => fileRef.current?.click()} disabled={uploading} aria-label="Attach a file"><Paperclip size={17} /><span>{uploading ? "Uploading" : "Attach"}</span></button>
              <button className="run-button" type="button" onClick={() => void startRun()} disabled={loading || !selected || phase === "running" || !String(formValues.prompt ?? "").trim()} aria-label="Run"><ArrowUp size={18} /></button>
            </div>
          </footer>
        </section>
        {run && <RunStage run={run} manifest={selected} handoff={handoff} onUse={useAsset} onRemix={remix} onContinue={continueTalk} onRetry={() => void retry()} onCancel={() => void cancel()} />}
      </div>
      {!run && !loading && <div className="composer-footnote"><span className="status-led" />Demo Mode is local and clearly marked. Connected models stay on the server.</div>}
    </div>
  );
}
