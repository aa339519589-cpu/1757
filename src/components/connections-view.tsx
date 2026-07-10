"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Check, ChevronRight, CircleAlert, FlaskConical, KeyRound, Plus, RefreshCw, Server, Settings2, Trash2, X } from "lucide-react";
import type { Capability, ConnectionPublic, InputField, OutputKind } from "@/lib/types";
import { api, ApiError, relativeTime } from "@/lib/client-api";

type DraftKind = "openai_compatible" | "openai_images" | "custom";
type FieldType = InputField["type"];
type MappingTarget = NonNullable<InputField["mapping"]>["target"];

interface EditableField {
  id: string;
  label: string;
  type: FieldType;
  required: boolean;
  advanced: boolean;
  defaultValue: string;
  optionsText: string;
  accept: OutputKind;
  target: MappingTarget;
  mappingKey: string;
}

const presetOptions: Array<{ kind: DraftKind; title: string; description: string; mark: string }> = [
  { kind: "openai_compatible", title: "OpenAI-compatible", description: "Base URL, API key, and model IDs for chat.", mark: "OC" },
  { kind: "openai_images", title: "OpenAI Images", description: "Official Image API using GPT Image models.", mark: "OI" },
  { kind: "custom", title: "Custom API", description: "Map any HTTP API into a capability.", mark: "CA" },
];

const customSteps = ["Basics", "Request", "Inputs", "Response", "Async"];

function initialField(): EditableField {
  return { id: "prompt", label: "Prompt", type: "textarea", required: true, advanced: false, defaultValue: "A quiet architectural study", optionsText: "", accept: "image", target: "body", mappingKey: "prompt" };
}

function parseHeaders(value: string): Record<string, string> {
  return Object.fromEntries(value.split("\n").map((line) => {
    const index = line.indexOf(":");
    return index > 0 ? [line.slice(0, index).trim(), line.slice(index + 1).trim()] : null;
  }).filter((entry): entry is [string, string] => Boolean(entry?.[0])));
}

function ConnectionWizard({ onClose, onSaved }: { onClose: () => void; onSaved: (connection: ConnectionPublic) => void }) {
  const [kind, setKind] = useState<DraftKind | null>(null);
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("");
  const [description, setDescription] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [modelId, setModelId] = useState("");
  const [modelsText, setModelsText] = useState("");
  const [capability, setCapability] = useState<Capability>("image");
  const [endpoint, setEndpoint] = useState("/generate");
  const [method, setMethod] = useState<"GET" | "POST" | "PUT" | "PATCH">("POST");
  const [contentType, setContentType] = useState<"application/json" | "multipart/form-data" | "application/x-www-form-urlencoded">("application/json");
  const [bodyTemplate, setBodyTemplate] = useState("{}");
  const [authType, setAuthType] = useState("bearer");
  const [headerName, setHeaderName] = useState("x-api-key");
  const [queryName, setQueryName] = useState("api_key");
  const [username, setUsername] = useState("");
  const [fields, setFields] = useState<EditableField[]>([initialField()]);
  const [response, setResponse] = useState<Record<string, string>>({ text: "$.output" });
  const [testInputs, setTestInputs] = useState('{"prompt":"A connection test"}');
  const [asyncEnabled, setAsyncEnabled] = useState(false);
  const [pollEndpoint, setPollEndpoint] = useState("/tasks/{{taskId}}");
  const [pollMethod, setPollMethod] = useState<"GET" | "POST">("GET");
  const [pollInterval, setPollInterval] = useState(2000);
  const [statusPath, setStatusPath] = useState("$.status");
  const [pendingValues, setPendingValues] = useState("queued,pending,processing");
  const [successValues, setSuccessValues] = useState("succeeded,completed");
  const [failureValues, setFailureValues] = useState("failed,error,cancelled");
  const [errorPath, setErrorPath] = useState("$.error.message");
  const [maxAttempts, setMaxAttempts] = useState(120);
  const [cancelEndpoint, setCancelEndpoint] = useState("");
  const [busy, setBusy] = useState<"test" | "save" | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string; detail?: string } | null>(null);
  const knownKeyRef = useRef<HTMLInputElement>(null);
  const bearerRef = useRef<HTMLInputElement>(null);
  const customKeyRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const customHeadersRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);

  function chooseKind(next: DraftKind) {
    setKind(next);
    setMessage(null);
    if (next === "openai_compatible") {
      setName("OpenAI-compatible"); setBaseUrl("http://127.0.0.1:8080/v1"); setModelId(""); setModelsText(""); setIcon("OC");
    } else if (next === "openai_images") {
      setName("OpenAI Images"); setBaseUrl("https://api.openai.com/v1"); setModelId("gpt-image-2"); setIcon("OI");
    } else {
      setName("My API"); setBaseUrl(""); setModelId("custom-model"); setIcon("CA");
    }
  }

  function updateField(index: number, patch: Partial<EditableField>) {
    setFields((current) => current.map((field, fieldIndex) => fieldIndex === index ? { ...field, ...patch } : field));
  }

  function credentials(): Record<string, unknown> {
    if (authType === "bearer") return { authType, token: bearerRef.current?.value ?? "" };
    if (authType === "api_key_header") return { authType, apiKey: customKeyRef.current?.value ?? "", headerName };
    if (authType === "api_key_query") return { authType, apiKey: customKeyRef.current?.value ?? "", queryName };
    if (authType === "basic") return { authType, username, password: passwordRef.current?.value ?? "" };
    if (authType === "custom_headers") return { authType: "none", customHeaders: parseHeaders(customHeadersRef.current?.value ?? "") };
    return { authType: "none" };
  }

  function payload() {
    if (!kind) throw new Error("Choose a connection type.");
    if (!name.trim() || !baseUrl.trim()) throw new Error("Name and base URL are required.");
    if (kind !== "custom") {
      return {
        kind, name: name.trim(), icon: icon.trim(), description: description.trim(), baseUrl: baseUrl.trim(), apiKey: knownKeyRef.current?.value ?? "",
        modelId: kind === "openai_images" ? modelId.trim() : undefined,
        models: kind === "openai_compatible" ? modelsText.split(/[\n,]/).map((value) => value.trim()).filter(Boolean) : undefined,
      };
    }
    let template: unknown;
    let parsedTestInputs: Record<string, unknown>;
    try { template = bodyTemplate.trim() ? JSON.parse(bodyTemplate) : {}; }
    catch { throw new Error("Request body template must be valid JSON."); }
    try { parsedTestInputs = testInputs.trim() ? JSON.parse(testInputs) : {}; }
    catch { throw new Error("Test inputs must be a valid JSON object."); }
    const inputSchema: InputField[] = fields.map((field) => ({
      id: field.id, label: field.label, type: field.type, required: field.required, advanced: field.advanced,
      defaultValue: field.type === "number" || field.type === "slider" ? Number(field.defaultValue || 0) : field.type === "boolean" ? field.defaultValue === "true" : field.defaultValue,
      options: field.type === "select" ? field.optionsText.split(",").map((value) => value.trim()).filter(Boolean).map((value) => ({ label: value, value })) : undefined,
      accept: field.type === "asset" || field.type === "file" ? [field.accept] : undefined,
      mapping: { target: field.target, key: field.mappingKey || field.id, encoding: field.type === "asset" || field.type === "file" ? (contentType === "multipart/form-data" ? "binary" : "data-url") : "value" },
    }));
    const responseMappings = Object.fromEntries(Object.entries(response).filter(([, value]) => value.trim()).map(([key, value]) => [key, value.trim()]));
    return {
      kind, name: name.trim(), icon: icon.trim(), description: description.trim(), baseUrl: baseUrl.trim(), credentials: credentials(), testInput: parsedTestInputs,
      custom: {
        capability, modelId: modelId.trim(), modelName: modelId.trim(), description: description.trim(), endpoint: endpoint.trim(), method, contentType, bodyTemplate: template, inputSchema, response: responseMappings,
        async: asyncEnabled ? {
          enabled: true, pollEndpoint: pollEndpoint.trim(), pollMethod, intervalMs: pollInterval, statusPath: statusPath.trim(),
          pendingValues: pendingValues.split(",").map((value) => value.trim()).filter(Boolean), successValues: successValues.split(",").map((value) => value.trim()).filter(Boolean), failureValues: failureValues.split(",").map((value) => value.trim()).filter(Boolean), errorPath: errorPath.trim() || undefined, maxAttempts,
          cancelEndpoint: cancelEndpoint.trim() || undefined, cancelMethod: "POST" as const,
        } : undefined,
      },
    };
  }

  async function submit(action: "test" | "save") {
    setBusy(action); setMessage(null);
    try {
      const body = payload();
      if (action === "test") {
        const result = await api<{ message: string }>("/api/connections/test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
        setMessage({ type: "success", text: result.message });
      } else {
        const result = await api<{ connection: ConnectionPublic }>("/api/connections", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
        if (knownKeyRef.current) knownKeyRef.current.value = "";
        if (bearerRef.current) bearerRef.current.value = "";
        if (customKeyRef.current) customKeyRef.current.value = "";
        if (passwordRef.current) passwordRef.current.value = "";
        if (customHeadersRef.current) customHeadersRef.current.value = "";
        onSaved(result.connection);
      }
    } catch (requestError) {
      const normalized = requestError instanceof ApiError ? requestError : new ApiError(requestError instanceof Error ? requestError.message : "The connection could not be tested.");
      setMessage({ type: "error", text: normalized.message, detail: normalized.detail });
    } finally { setBusy(null); }
  }

  const isCustom = kind === "custom";
  const canBack = isCustom && step > 0;
  const canNext = isCustom && step < customSteps.length - 1;

  return (
    <div className="modal-backdrop connection-modal" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <section className="connection-dialog" role="dialog" aria-modal="true" aria-labelledby="connection-dialog-title">
        <header className="dialog-header connection-dialog-head">
          <div>
            <h2 id="connection-dialog-title">{kind ? (isCustom ? customSteps[step] : kind === "openai_images" ? "OpenAI Images" : "OpenAI-compatible") : "Add a connection"}</h2>
            <p>{kind ? "Credentials are encrypted and used only by the server." : "Choose the shortest path that matches the API."}</p>
          </div>
          <button className="button icon ghost" onClick={onClose} aria-label="Close connection dialog"><X size={18} /></button>
        </header>
        {!kind ? (
          <div className="preset-picker">
            {presetOptions.map((option) => (
              <button key={option.kind} onClick={() => chooseKind(option.kind)}>
                <span className="connection-mark">{option.mark}</span>
                <span><strong>{option.title}</strong><small>{option.description}</small></span>
                <ChevronRight size={18} />
              </button>
            ))}
          </div>
        ) : (
          <>
            {isCustom && <nav className="wizard-steps" aria-label="Custom connector setup">{customSteps.map((label, index) => <button key={label} className={index === step ? "active" : index < step ? "done" : ""} onClick={() => setStep(index)}><span>{index < step ? <Check size={12} /> : index + 1}</span>{label}</button>)}</nav>}
            <div className="connection-form-scroll">
              {!isCustom && (
                <div className="form-stack simple-connection-form">
                  <div className="form-grid"><div className="field"><label htmlFor="connection-name">Name</label><input id="connection-name" className="input" value={name} onChange={(event) => setName(event.target.value)} /></div><div className="field"><label htmlFor="connection-icon">Mark</label><input id="connection-icon" className="input" maxLength={2} value={icon} onChange={(event) => setIcon(event.target.value.toUpperCase())} /></div></div>
                  <div className="field"><label htmlFor="connection-url">Base URL</label><input id="connection-url" className="input" type="url" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} /></div>
                  <div className="field"><label htmlFor="connection-key">API key</label><input ref={knownKeyRef} id="connection-key" className="input secret-input" type="password" autoComplete="new-password" spellCheck={false} placeholder="Stored encrypted on save" /></div>
                  {kind === "openai_compatible" ? <div className="field"><label htmlFor="connection-models">Model IDs</label><textarea id="connection-models" className="textarea" value={modelsText} onChange={(event) => setModelsText(event.target.value)} placeholder="gpt-5.4-mini, your-model-id" /><p className="field-help">Comma or newline separated. Model discovery remains available through the provider&apos;s /models endpoint.</p></div> : <div className="field"><label htmlFor="connection-model">Model ID</label><input id="connection-model" className="input" value={modelId} onChange={(event) => setModelId(event.target.value)} /></div>}
                </div>
              )}
              {isCustom && step === 0 && (
                <div className="form-stack">
                  <div className="form-grid"><div className="field"><label>Name</label><input className="input" value={name} onChange={(event) => setName(event.target.value)} /></div><div className="field"><label>Mark</label><input className="input" maxLength={2} value={icon} onChange={(event) => setIcon(event.target.value.toUpperCase())} /></div></div>
                  <div className="field"><label>Description</label><input className="input" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What this API is best at" /></div>
                  <div className="form-grid"><div className="field"><label>Capability</label><select className="select" value={capability} onChange={(event) => setCapability(event.target.value as Capability)}>{["talk","image","video","audio","transform","analyze"].map((value) => <option key={value} value={value}>{value[0].toUpperCase() + value.slice(1)}</option>)}</select></div><div className="field"><label>Model ID</label><input className="input" value={modelId} onChange={(event) => setModelId(event.target.value)} /></div></div>
                  <div className="field"><label>Base URL</label><input className="input" type="url" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://api.example.com/v1" /></div>
                </div>
              )}
              {isCustom && step === 1 && (
                <div className="form-stack">
                  <div className="form-grid"><div className="field"><label>Endpoint</label><input className="input" value={endpoint} onChange={(event) => setEndpoint(event.target.value)} /></div><div className="field"><label>Method</label><select className="select" value={method} onChange={(event) => setMethod(event.target.value as typeof method)}>{["GET","POST","PUT","PATCH"].map((value) => <option key={value}>{value}</option>)}</select></div></div>
                  <div className="field"><label>Content type</label><select className="select" value={contentType} onChange={(event) => setContentType(event.target.value as typeof contentType)}><option>application/json</option><option>multipart/form-data</option><option>application/x-www-form-urlencoded</option></select></div>
                  <div className="field"><label>Authentication</label><select className="select" value={authType} onChange={(event) => setAuthType(event.target.value)}><option value="bearer">Bearer token</option><option value="api_key_header">API key header</option><option value="api_key_query">API key query parameter</option><option value="basic">Basic Auth</option><option value="custom_headers">Custom headers</option><option value="none">No authentication</option></select></div>
                  {authType === "bearer" && <div className="field"><label>Token</label><input ref={bearerRef} className="input secret-input" type="password" autoComplete="new-password" spellCheck={false} /></div>}
                  {(authType === "api_key_header" || authType === "api_key_query") && <div className="form-grid"><div className="field"><label>{authType === "api_key_header" ? "Header name" : "Query name"}</label><input className="input" value={authType === "api_key_header" ? headerName : queryName} onChange={(event) => authType === "api_key_header" ? setHeaderName(event.target.value) : setQueryName(event.target.value)} /></div><div className="field"><label>API key</label><input ref={customKeyRef} className="input secret-input" type="password" autoComplete="new-password" spellCheck={false} /></div></div>}
                  {authType === "basic" && <div className="form-grid"><div className="field"><label>Username</label><input className="input" value={username} onChange={(event) => setUsername(event.target.value)} /></div><div className="field"><label>Password</label><input ref={passwordRef} className="input secret-input" type="password" autoComplete="new-password" spellCheck={false} /></div></div>}
                  {authType === "custom_headers" && <div className="field"><label>Headers</label><textarea ref={customHeadersRef} className="textarea secret-input" autoComplete="off" spellCheck={false} placeholder={'X-API-Key: secret\nX-Version: 2026-01-01'} /></div>}
                  <div className="field"><label>JSON body template</label><textarea className="textarea code-input" value={bodyTemplate} onChange={(event) => setBodyTemplate(event.target.value)} /><p className="field-help">Use values such as {"{{prompt}}"}. Field mappings are applied after the template.</p></div>
                </div>
              )}
              {isCustom && step === 2 && (
                <div className="field-builder">
                  {fields.map((field, index) => (
                    <div className="field-definition" key={`${field.id}-${index}`}>
                      <div className="field-definition-head"><strong>Input {index + 1}</strong><button className="button icon ghost" onClick={() => setFields((current) => current.filter((_, itemIndex) => itemIndex !== index))} aria-label="Remove input"><Trash2 size={15} /></button></div>
                      <div className="form-grid"><div className="field"><label>Key</label><input className="input" value={field.id} onChange={(event) => updateField(index, { id: event.target.value, mappingKey: field.mappingKey === field.id ? event.target.value : field.mappingKey })} /></div><div className="field"><label>Label</label><input className="input" value={field.label} onChange={(event) => updateField(index, { label: event.target.value })} /></div></div>
                      <div className="form-grid"><div className="field"><label>Control</label><select className="select" value={field.type} onChange={(event) => updateField(index, { type: event.target.value as FieldType })}>{["text","textarea","number","slider","select","boolean","asset","file"].map((value) => <option key={value} value={value}>{value}</option>)}</select></div><div className="field"><label>Default / test value</label><input className="input" value={field.defaultValue} onChange={(event) => updateField(index, { defaultValue: event.target.value })} /></div></div>
                      {field.type === "select" && <div className="field"><label>Options</label><input className="input" value={field.optionsText} onChange={(event) => updateField(index, { optionsText: event.target.value })} placeholder="square, landscape, portrait" /></div>}
                      {(field.type === "asset" || field.type === "file") && <div className="field"><label>Accepted asset</label><select className="select" value={field.accept} onChange={(event) => updateField(index, { accept: event.target.value as OutputKind })}>{["image","video","audio","file"].map((value) => <option key={value}>{value}</option>)}</select></div>}
                      <div className="mapping-row"><select className="select" value={field.target} onChange={(event) => updateField(index, { target: event.target.value as MappingTarget })}><option value="body">JSON / form body</option><option value="query">Query</option><option value="header">Header</option><option value="path">URL path</option></select><input className="input" value={field.mappingKey} onChange={(event) => updateField(index, { mappingKey: event.target.value })} placeholder="request field" /><label><input type="checkbox" checked={field.required} onChange={(event) => updateField(index, { required: event.target.checked })} />Required</label><label><input type="checkbox" checked={field.advanced} onChange={(event) => updateField(index, { advanced: event.target.checked })} />Advanced</label></div>
                    </div>
                  ))}
                  <button className="button" onClick={() => setFields((current) => [...current, { ...initialField(), id: `field${current.length + 1}`, label: `Field ${current.length + 1}`, required: false, mappingKey: `field${current.length + 1}` }])}><Plus size={15} />Add input</button>
                  <div className="field"><label>Test inputs (JSON)</label><textarea className="textarea code-input" value={testInputs} onChange={(event) => setTestInputs(event.target.value)} /><p className="field-help">Used only when testing or saving. Asset inputs should contain an existing Asset ID.</p></div>
                </div>
              )}
              {isCustom && step === 3 && (
                <div className="form-stack">
                  <p className="step-intro">Map response values with simple JSON paths. Only mapped outputs enter the platform.</p>
                  {(["text","image","video","audio","file","json"] as const).map((kind) => <div className="mapping-output" key={kind}><label>{kind}</label><input className="input" value={response[kind] ?? ""} onChange={(event) => setResponse((current) => ({ ...current, [kind]: event.target.value }))} placeholder={`$.data.${kind}_url`} /></div>)}
                  {asyncEnabled && <div className="mapping-output important"><label>task ID</label><input className="input" value={response.taskId ?? ""} onChange={(event) => setResponse((current) => ({ ...current, taskId: event.target.value }))} placeholder="$.task.id" /></div>}
                </div>
              )}
              {isCustom && step === 4 && (
                <div className="form-stack">
                  <label className="toggle-field async-toggle"><input type="checkbox" checked={asyncEnabled} onChange={(event) => setAsyncEnabled(event.target.checked)} /><span className="toggle-track"><span /></span><span><strong>Asynchronous task</strong><small>Submit now, then poll with the returned task ID.</small></span></label>
                  {asyncEnabled && <>
                    <div className="mapping-output important"><label>Task ID path</label><input className="input" value={response.taskId ?? ""} onChange={(event) => setResponse((current) => ({ ...current, taskId: event.target.value }))} placeholder="$.task.id" /></div>
                    <div className="form-grid"><div className="field"><label>Poll endpoint</label><input className="input" value={pollEndpoint} onChange={(event) => setPollEndpoint(event.target.value)} /></div><div className="field"><label>Method</label><select className="select" value={pollMethod} onChange={(event) => setPollMethod(event.target.value as typeof pollMethod)}><option>GET</option><option>POST</option></select></div></div>
                    <div className="form-grid"><div className="field"><label>Interval (ms)</label><input className="input" type="number" min="500" value={pollInterval} onChange={(event) => setPollInterval(Number(event.target.value))} /></div><div className="field"><label>Maximum checks</label><input className="input" type="number" min="1" value={maxAttempts} onChange={(event) => setMaxAttempts(Number(event.target.value))} /></div></div>
                    <div className="field"><label>Status path</label><input className="input" value={statusPath} onChange={(event) => setStatusPath(event.target.value)} /></div>
                    <div className="field"><label>Pending values</label><input className="input" value={pendingValues} onChange={(event) => setPendingValues(event.target.value)} /></div>
                    <div className="field"><label>Success values</label><input className="input" value={successValues} onChange={(event) => setSuccessValues(event.target.value)} /></div>
                    <div className="field"><label>Failure values</label><input className="input" value={failureValues} onChange={(event) => setFailureValues(event.target.value)} /></div>
                    <div className="form-grid"><div className="field"><label>Error path</label><input className="input" value={errorPath} onChange={(event) => setErrorPath(event.target.value)} /></div><div className="field"><label>Cancel endpoint (optional)</label><input className="input" value={cancelEndpoint} onChange={(event) => setCancelEndpoint(event.target.value)} /></div></div>
                  </>}
                </div>
              )}
              {message && <div className={`connection-message ${message.type}`} role="alert">{message.type === "success" ? <Check size={16} /> : <CircleAlert size={16} />}<span><strong>{message.text}</strong>{message.detail && <small>{message.detail}</small>}</span></div>}
            </div>
            <footer className="wizard-footer">
              <div>{kind && <button className="button ghost" onClick={() => { if (canBack) setStep((value) => value - 1); else setKind(null); }}><ArrowLeft size={15} />Back</button>}</div>
              <div className="wizard-actions">
                {canNext ? <button className="button primary" onClick={() => setStep((value) => value + 1)}>Continue<ArrowRight size={15} /></button> : <>
                  <button className="button" onClick={() => void submit("test")} disabled={Boolean(busy)}><FlaskConical size={15} />{busy === "test" ? "Testing" : isCustom ? "Send test request" : "Test"}</button>
                  <button className="button primary" onClick={() => void submit("save")} disabled={Boolean(busy)}><KeyRound size={15} />{busy === "save" ? "Saving" : "Test and save"}</button>
                </>}
              </div>
            </footer>
          </>
        )}
      </section>
    </div>
  );
}

export function ConnectionsView() {
  const [connections, setConnections] = useState<ConnectionPublic[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [newId, setNewId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const realConnections = useMemo(() => connections.filter((connection) => connection.kind !== "demo"), [connections]);

  useEffect(() => { api<{ connections: ConnectionPublic[] }>("/api/connections").then((data) => setConnections(data.connections)).catch((requestError) => setError(requestError instanceof Error ? requestError.message : "Connections could not be loaded.")).finally(() => setLoading(false)); }, []);

  async function retest(id: string) {
    setBusyId(id); setError(null);
    try {
      const result = await api<{ message: string }>(`/api/connections/${id}/test`, { method: "POST" });
      setNotice(result.message);
      setConnections((current) => current.map((connection) => connection.id === id ? { ...connection, status: "connected", lastError: null, lastTestedAt: new Date().toISOString() } : connection));
    } catch (requestError) { setError(requestError instanceof ApiError ? requestError.message : "The connection test failed."); }
    finally { setBusyId(null); }
  }
  async function remove(connection: ConnectionPublic) {
    if (!window.confirm(`Remove ${connection.name}? Existing runs and assets will remain.`)) return;
    setBusyId(connection.id); setError(null);
    try { await api(`/api/connections/${connection.id}`, { method: "DELETE" }); setConnections((current) => current.filter((item) => item.id !== connection.id)); }
    catch (requestError) { setError(requestError instanceof ApiError ? requestError.message : "The connection could not be removed."); }
    finally { setBusyId(null); }
  }

  return (
    <div className="page-shell connections-page">
      <header className="page-header"><div><h1>Connections</h1><p>Providers live here. Capabilities appear in Create after a connection passes its server-side test.</p></div><button className="button primary" onClick={() => { setOpen(true); setNotice(null); }}><Plus size={16} />Add connection</button></header>
      {notice && <div className="connection-success"><Check size={17} /><span>{notice}</span><Link href="/">Open Create</Link></div>}
      {error && <div className="page-error" role="alert">{error}</div>}
      <section className="connection-list" aria-label="Provider connections">
        {connections.map((connection) => (
          <article key={connection.id} className={`connection-row ${connection.id === newId ? "new-connection" : ""}`}>
            <span className="connection-mark">{String(connection.config?.icon ?? (connection.kind === "demo" ? "D" : connection.name.slice(0, 2))).toUpperCase()}</span>
            <div className="connection-copy"><strong>{connection.name}</strong><small>{connection.description || connection.baseUrl}</small></div>
            <span className="connection-kind">{connection.kind === "openai_compatible" ? "Compatible" : connection.kind === "openai_images" ? "Images" : connection.kind === "custom" ? "Custom" : "Local demo"}</span>
            <div className="connection-health"><span className={`run-status status-${connection.status === "connected" ? "succeeded" : "failed"}`}><i />{connection.status}</span>{connection.keyHint && <small>Key {connection.keyHint}</small>}</div>
            <div className="connection-meta"><strong>{connection.modelCount}</strong><small>{connection.modelCount === 1 ? "model" : "models"}</small></div>
            <div className="connection-actions">
              {connection.kind !== "demo" && <button className="button icon ghost" onClick={() => void retest(connection.id)} disabled={busyId === connection.id} title="Test connection" aria-label={`Test ${connection.name}`}><RefreshCw size={16} /></button>}
              {connection.kind !== "demo" && <button className="button icon ghost" onClick={() => void remove(connection)} disabled={busyId === connection.id} title="Remove connection" aria-label={`Remove ${connection.name}`}><Trash2 size={16} /></button>}
            </div>
          </article>
        ))}
        {!loading && !realConnections.length && <div className="connection-invitation"><Server size={20} /><div><strong>Demo Mode is ready</strong><span>Add one real API when you are ready. The Create surface will update automatically.</span></div></div>}
      </section>
      <div className="connection-security"><Settings2 size={16} /><span>Secrets are AES-256-GCM encrypted at rest. Public connection responses contain only status and a key ending.</span></div>
      {open && <ConnectionWizard onClose={() => setOpen(false)} onSaved={(connection) => { setConnections((current) => [current[0], connection, ...current.slice(1)]); setNewId(connection.id); setOpen(false); setNotice(`${connection.name} is connected. Its capability is now available in Create.`); window.setTimeout(() => setNewId(null), 1600); }} />}
    </div>
  );
}
