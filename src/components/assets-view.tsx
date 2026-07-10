"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Boxes, Download, FileText, Image as ImageIcon, Plus, Upload, Video } from "lucide-react";
import type { AssetRecord, OutputKind } from "@/lib/types";
import { api, ApiError, relativeTime } from "@/lib/client-api";

const filters: Array<{ label: string; value: "all" | OutputKind }> = [
  { label: "All", value: "all" }, { label: "Images", value: "image" }, { label: "Video", value: "video" }, { label: "Text", value: "text" }, { label: "Files", value: "file" },
];

function AssetPreview({ asset }: { asset: AssetRecord }) {
  if (asset.kind === "image") return <img src={asset.url} alt={asset.prompt ?? asset.name} />;
  if (asset.kind === "video") return <video src={asset.url} muted playsInline preload="metadata" />;
  if (asset.kind === "audio") return <div className="file-preview"><span>A</span><small>Audio</small></div>;
  if (asset.kind === "text" || asset.kind === "json") return <div className="text-preview"><FileText size={20} /><p>{asset.text?.slice(0, 180) || asset.name}</p></div>;
  return <div className="file-preview"><span>F</span><small>{asset.mimeType.split("/").at(-1)}</small></div>;
}

export function AssetsView() {
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [filter, setFilter] = useState<"all" | OutputKind>("all");
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const visible = useMemo(() => filter === "all" ? assets : assets.filter((asset) => asset.kind === filter), [assets, filter]);

  useEffect(() => {
    api<{ assets: AssetRecord[] }>("/api/assets?limit=200").then((data) => setAssets(data.assets)).catch((requestError) => setError(requestError instanceof Error ? requestError.message : "Assets could not be loaded.")).finally(() => setLoading(false));
  }, []);

  async function upload(file: File) {
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const { asset } = await api<{ asset: AssetRecord }>("/api/assets", { method: "POST", body: form });
      setAssets((current) => [asset, ...current]);
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : "The file could not be uploaded.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="page-shell assets-page">
      <header className="page-header">
        <div><h1>Assets</h1><p>Every output is saved here and can become the input to another capability.</p></div>
        <input ref={fileRef} type="file" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); }} />
        <button className="button primary" onClick={() => fileRef.current?.click()} disabled={uploading}><Upload size={16} />{uploading ? "Uploading" : "Upload"}</button>
      </header>
      <div className="asset-toolbar">
        <div className="filter-tabs" role="tablist" aria-label="Asset type">
          {filters.map((item) => <button key={item.value} role="tab" aria-selected={filter === item.value} className={filter === item.value ? "active" : ""} onClick={() => setFilter(item.value)}>{item.label}</button>)}
        </div>
        <span>{visible.length} {visible.length === 1 ? "asset" : "assets"}</span>
      </div>
      {error && <div className="page-error" role="alert">{error}</div>}
      {!loading && !assets.length ? (
        <div className="empty-state"><div className="empty-state-inner"><div className="empty-state-icon"><Boxes size={22} /></div><h2>Your outputs will collect here</h2><p>Create in Demo Mode or upload an existing file. Assets stay available after refresh.</p><Link className="button primary" href="/"><Plus size={16} />Create something</Link></div></div>
      ) : (
        <div className="asset-grid">
          {visible.map((asset) => (
            <article className="asset-card" key={asset.id}>
              <div className={`asset-preview asset-preview-${asset.kind}`}><AssetPreview asset={asset} /></div>
              <div className="asset-copy">
                <div><strong>{asset.name}</strong><small>{asset.kind} · {relativeTime(asset.createdAt)}</small></div>
                <div className="asset-actions">
                  {asset.kind === "image" && <Link href={`/?asset=${asset.id}&capability=video`} aria-label={`Animate ${asset.name}`} title="Animate"><Video size={16} /></Link>}
                  {asset.kind === "text" && <Link href={`/?asset=${asset.id}&capability=image`} aria-label={`Create image from ${asset.name}`} title="Create image"><ImageIcon size={16} /></Link>}
                  <Link href={`/?asset=${asset.id}&capability=analyze`} aria-label={`Analyze ${asset.name}`} title="Analyze"><ArrowUpRight size={16} /></Link>
                  {!["text", "json"].includes(asset.kind) && <a href={asset.url} download={asset.name} aria-label={`Download ${asset.name}`} title="Download"><Download size={16} /></a>}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
