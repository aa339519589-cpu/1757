"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Activity, ChevronDown, CircleAlert, Clock3, RefreshCw, Square } from "lucide-react";
import type { RunRecord, RunStatus } from "@/lib/types";
import { api, ApiError, relativeTime } from "@/lib/client-api";

const activeStatuses = new Set<RunStatus>(["created", "queued", "running"]);

function statusLabel(status: RunStatus): string {
  return { created: "Created", queued: "Queued", running: "Running", succeeded: "Completed", failed: "Failed", cancelled: "Cancelled" }[status];
}

export function RunsView() {
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [filter, setFilter] = useState<"all" | "active" | "succeeded" | "failed">("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await api<{ runs: RunRecord[] }>("/api/runs?limit=100");
      setRuns(data.runs);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Runs could not be loaded.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!runs.some((run) => activeStatuses.has(run.status))) return;
    const timer = window.setInterval(() => void refresh(), 1_000);
    return () => window.clearInterval(timer);
  }, [runs, refresh]);

  const active = runs.find((run) => activeStatuses.has(run.status));
  const visible = useMemo(() => runs.filter((run) => {
    if (filter === "all") return true;
    if (filter === "active") return activeStatuses.has(run.status);
    if (filter === "failed") return run.status === "failed" || run.status === "cancelled";
    return run.status === "succeeded";
  }), [runs, filter]);

  async function cancel(id: string) {
    try { await api(`/api/runs/${id}`, { method: "DELETE" }); await refresh(); }
    catch (requestError) { setError(requestError instanceof ApiError ? requestError.message : "The run could not be cancelled."); }
  }
  async function retry(id: string) {
    try { await api(`/api/runs/${id}/retry`, { method: "POST" }); await refresh(); }
    catch (requestError) { setError(requestError instanceof ApiError ? requestError.message : "The run could not be retried."); }
  }

  return (
    <div className="page-shell runs-page">
      <header className="page-header"><div><h1>Runs</h1><p>Every request has a durable state, its real events, and the assets it produced.</p></div></header>
      {active && (
        <section className="current-run" aria-live="polite">
          <div className="current-run-head"><div><span>Current run</span><h2>{active.modelName}</h2></div><span className={`run-status status-${active.status}`}><i />{statusLabel(active.status)}</span></div>
          <div className="current-run-stage"><span>{active.events.at(-1)?.message ?? "Preparing input"}</span><button className="button ghost" onClick={() => void cancel(active.id)}><Square size={13} fill="currentColor" />Cancel</button></div>
          <div className="indeterminate-line"><span /></div>
        </section>
      )}
      <div className="run-toolbar">
        <div className="filter-tabs" role="tablist" aria-label="Run status">
          {(["all", "active", "succeeded", "failed"] as const).map((item) => <button key={item} className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>{item === "succeeded" ? "Completed" : item[0].toUpperCase() + item.slice(1)}</button>)}
        </div>
        <button className="button icon ghost" onClick={() => void refresh()} aria-label="Refresh runs" title="Refresh"><RefreshCw size={16} /></button>
      </div>
      {error && <div className="page-error" role="alert">{error}</div>}
      {!loading && !runs.length ? (
        <div className="empty-state"><div className="empty-state-inner"><div className="empty-state-icon"><Activity size={22} /></div><h2>No runs yet</h2><p>Your first Demo run will appear here immediately and remain after refresh.</p><Link className="button primary" href="/">Start a run</Link></div></div>
      ) : (
        <div className="run-list">
          {visible.map((run) => {
            const open = expanded === run.id;
            const prompt = typeof run.input.prompt === "string" ? run.input.prompt : "No text input";
            return (
              <article className={`run-row ${open ? "expanded" : ""}`} key={run.id}>
                <button className="run-summary" onClick={() => setExpanded(open ? null : run.id)} aria-expanded={open}>
                  <span className={`run-status status-${run.status}`}><i />{statusLabel(run.status)}</span>
                  <span className="run-main"><strong>{run.modelName}</strong><small>{prompt}</small></span>
                  <span className="run-capability">{run.capability}</span>
                  <span className="run-time"><Clock3 size={13} />{relativeTime(run.createdAt)}</span>
                  <ChevronDown size={16} className="run-chevron" />
                </button>
                {open && (
                  <div className="run-detail">
                    <div className="event-timeline">
                      {run.events.map((event) => <div key={event.id}><i /><span>{event.message}</span><time>{new Date(event.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time></div>)}
                    </div>
                    <div className="run-detail-side">
                      <dl><div><dt>Run ID</dt><dd>{run.id.slice(0, 12)}</dd></div><div><dt>Attempt</dt><dd>{run.attempt}</dd></div><div><dt>Outputs</dt><dd>{run.assets.length}</dd></div></dl>
                      {run.errorMessage && <p className="run-error"><CircleAlert size={14} />{run.errorMessage}</p>}
                      <div className="run-row-actions">
                        {activeStatuses.has(run.status) && <button className="button ghost" onClick={() => void cancel(run.id)}><Square size={13} />Cancel</button>}
                        {(run.status === "failed" || run.status === "cancelled") && <button className="button" onClick={() => void retry(run.id)}><RefreshCw size={15} />Retry</button>}
                        {run.assets[0] && <Link className="button" href={`/?asset=${run.assets[0].id}&capability=analyze`}>Use output</Link>}
                      </div>
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
