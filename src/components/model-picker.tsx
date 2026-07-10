"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Check, ChevronDown, Search, X } from "lucide-react";
import type { ModelManifest } from "@/lib/types";

export function ModelPicker({
  models,
  selectedId,
  onSelect,
}: {
  models: ModelManifest[];
  selectedId: string;
  onSelect: (model: ModelManifest) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = models.find((model) => model.id === selectedId) ?? models[0];
  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return term ? models.filter((model) => `${model.displayName} ${model.providerName} ${model.description}`.toLowerCase().includes(term)) : models;
  }, [models, query]);

  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);

  return (
    <>
      <button className="model-trigger" type="button" onClick={() => setOpen(true)} disabled={!selected}>
        <span className="model-trigger-copy">
          <strong>{selected?.displayName ?? "No compatible model"}</strong>
          <small>{selected?.providerName ?? "Add a connection"}</small>
        </span>
        {selected?.badges?.includes("Demo") && <span className="badge demo">Demo</span>}
        <ChevronDown size={15} />
      </button>
      {open && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setOpen(false); }}>
          <section className="model-dialog" role="dialog" aria-modal="true" aria-labelledby="model-dialog-title">
            <header className="dialog-header">
              <div>
                <h2 id="model-dialog-title">Choose a model</h2>
                <p>Recommended models stay first. Providers remain secondary.</p>
              </div>
              <button className="button icon ghost" onClick={() => setOpen(false)} aria-label="Close model picker"><X size={18} /></button>
            </header>
            <div className="model-search">
              <Search size={17} />
              <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search models or providers" aria-label="Search models" />
            </div>
            <div className="model-list">
              {filtered.map((model) => (
                <button
                  key={model.id}
                  type="button"
                  className={`model-row ${model.id === selected?.id ? "selected" : ""}`}
                  onClick={() => { onSelect(model); setOpen(false); setQuery(""); }}
                >
                  <span className="model-symbol">{model.displayName.slice(0, 1).toUpperCase()}</span>
                  <span className="model-row-copy">
                    <strong>{model.displayName}</strong>
                    <small>{model.providerName} · {model.description}</small>
                  </span>
                  <span className="model-meta">{model.mode === "async" ? "Async" : "Direct"}</span>
                  {model.id === selected?.id && <Check size={17} className="model-check" />}
                </button>
              ))}
              {!filtered.length && <div className="model-empty">No matching models.</div>}
            </div>
            <footer className="dialog-footer">
              <span>Connected models appear here automatically.</span>
              <Link href="/connections" onClick={() => setOpen(false)}>Manage connections</Link>
            </footer>
          </section>
        </div>
      )}
    </>
  );
}
