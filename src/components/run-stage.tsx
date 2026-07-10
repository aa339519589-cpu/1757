"use client";

import { ArrowRight, CircleAlert, Download, FileText, Image as ImageIcon, LoaderCircle, MessageCircle, RefreshCw, Sparkles, Square, Video } from "lucide-react";
import type { AssetRecord, Capability, ModelManifest, RunRecord } from "@/lib/types";

const terminal = new Set(["succeeded", "failed", "cancelled"]);

function AssetOutput({ asset, prompt }: { asset: AssetRecord; prompt?: string }) {
  if (asset.kind === "image") return <img className="primary-media" src={asset.url} alt={prompt || asset.name} />;
  if (asset.kind === "video") return <video className="primary-media" src={asset.url} controls playsInline />;
  if (asset.kind === "audio") return <audio className="audio-result" src={asset.url} controls />;
  if (asset.kind === "json") return <pre className="json-result">{asset.text}</pre>;
  return <article className="text-result">{asset.text}</article>;
}

export function RunStage({
  run,
  manifest,
  handoff,
  onUse,
  onRemix,
  onContinue,
  onRetry,
  onCancel,
}: {
  run: RunRecord;
  manifest: ModelManifest | null;
  handoff: boolean;
  onUse: (capability: Capability, asset: AssetRecord) => void;
  onRemix: () => void;
  onContinue: () => void;
  onRetry: () => void;
  onCancel: () => void;
}) {
  const active = !terminal.has(run.status);
  const primary = run.assets.find((asset) => ["image", "video", "audio"].includes(asset.kind)) ?? run.assets[0];
  const latestEvent = run.events.at(-1);

  if (active) {
    return (
      <section className="run-stage progress-stage" aria-live="polite">
        <div className="progress-heading">
          <span className="progress-mark"><LoaderCircle size={22} /></span>
          <div><span>{run.modelName}</span><h2>{latestEvent?.message ?? "Preparing run"}</h2></div>
        </div>
        <div className="indeterminate-line"><span /></div>
        <ol className="run-events">
          {run.events.slice(-5).map((event, index, events) => (
            <li key={event.id} className={index === events.length - 1 ? "current" : "done"}>
              <span className="event-dot" />
              <span>{event.message}</span>
            </li>
          ))}
        </ol>
        <button className="button ghost" type="button" onClick={onCancel}><Square size={14} fill="currentColor" />Cancel</button>
      </section>
    );
  }

  if (run.status === "failed" || run.status === "cancelled") {
    return (
      <section className="run-stage error-stage" aria-live="polite">
        <CircleAlert size={25} />
        <h2>{run.status === "cancelled" ? "Run cancelled" : run.errorMessage ?? "The run failed"}</h2>
        <p>{run.status === "cancelled" ? "No output was saved. You can start again with the same inputs." : "Check the connection or input, then retry safely."}</p>
        {run.errorDetail && <details><summary>Technical details</summary><pre>{run.errorDetail}</pre></details>}
        <button className="button" type="button" onClick={onRetry}><RefreshCw size={16} />Retry</button>
      </section>
    );
  }

  if (!primary) return null;
  const prompt = typeof run.input.prompt === "string" ? run.input.prompt : undefined;
  return (
    <section className={`run-stage result-stage ${handoff ? "is-handoff" : ""}`} aria-live="polite">
      <div className="result-topline">
        <div><span className="result-kicker">Completed with {run.modelName}</span><h2>{primary.name}</h2></div>
        <span className="badge success">Saved to Assets</span>
      </div>
      <div className={`result-frame result-${primary.kind}`}>
        <AssetOutput asset={primary} prompt={prompt} />
        {handoff && <div className="handoff-overlay"><ArrowRight size={22} /><span>Passing asset forward</span></div>}
      </div>
      {run.assets.length > 1 && (
        <div className="output-strip">
          {run.assets.map((asset) => <span key={asset.id}>{asset.kind === "json" ? <FileText size={14} /> : <ImageIcon size={14} />}{asset.name}</span>)}
        </div>
      )}
      <div className="result-actions">
        {primary.kind === "image" && <button className="button" onClick={onRemix}><RefreshCw size={16} />Remix</button>}
        {primary.kind === "image" && manifest?.actions.includes("video") && <button className="button primary" onClick={() => onUse("video", primary)}><Video size={16} />Animate</button>}
        {primary.kind === "video" && <button className="button" onClick={onRemix}><RefreshCw size={16} />Remix</button>}
        {run.capability === "talk" && <button className="button primary" onClick={onContinue}><MessageCircle size={16} />Continue</button>}
        {primary.kind === "text" && manifest?.actions.includes("image") && <button className="button" onClick={() => onUse("image", primary)}><Sparkles size={16} />Create image</button>}
        {manifest?.actions.includes("analyze") && primary.kind !== "json" && <button className="button" onClick={() => onUse("analyze", primary)}><FileText size={16} />Analyze</button>}
        {primary.kind !== "text" && <a className="button ghost" href={primary.url} download={primary.name}><Download size={16} />Download</a>}
      </div>
    </section>
  );
}
