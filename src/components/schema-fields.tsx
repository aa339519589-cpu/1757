"use client";

import type { AssetRecord, InputField, ModelManifest } from "@/lib/types";

function FieldControl({
  field,
  value,
  assets,
  onChange,
}: {
  field: InputField;
  value: unknown;
  assets: AssetRecord[];
  onChange: (value: unknown) => void;
}) {
  const id = `field-${field.id}`;
  if (field.type === "boolean") {
    return (
      <label className="toggle-field" htmlFor={id}>
        <input id={id} type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} />
        <span className="toggle-track"><span /></span>
        <span><strong>{field.label}</strong>{field.description && <small>{field.description}</small>}</span>
      </label>
    );
  }
  if (field.type === "asset" || field.type === "file") {
    const compatible = assets.filter((asset) => !field.accept?.length || field.accept.includes(asset.kind));
    return (
      <div className="field">
        <label htmlFor={id}>{field.label}{field.required ? " *" : ""}</label>
        <select id={id} className="select" value={String(value ?? "")} onChange={(event) => onChange(event.target.value)}>
          <option value="">No asset selected</option>
          {compatible.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}
        </select>
        {field.description && <p className="field-help">{field.description}</p>}
      </div>
    );
  }
  if (field.type === "select") {
    return (
      <div className="field">
        <label htmlFor={id}>{field.label}{field.required ? " *" : ""}</label>
        <select id={id} className="select" value={String(value ?? "")} onChange={(event) => onChange(event.target.value)}>
          {field.options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </div>
    );
  }
  if (field.type === "slider") {
    return (
      <div className="field slider-field">
        <label htmlFor={id}>{field.label}<span>{String(value ?? field.defaultValue ?? "")}</span></label>
        <input id={id} type="range" min={field.min} max={field.max} step={field.step} value={Number(value ?? field.defaultValue ?? 0)} onChange={(event) => onChange(Number(event.target.value))} />
      </div>
    );
  }
  return (
    <div className="field">
      <label htmlFor={id}>{field.label}{field.required ? " *" : ""}</label>
      {field.type === "textarea" ? (
        <textarea id={id} className="textarea" value={String(value ?? "")} placeholder={field.placeholder} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <input
          id={id}
          className="input"
          type={field.type === "number" ? "number" : "text"}
          min={field.min}
          max={field.max}
          step={field.step}
          value={field.type === "number" ? String(value ?? "") : String(value ?? "")}
          placeholder={field.placeholder}
          onChange={(event) => onChange(field.type === "number" ? (event.target.value === "" ? "" : Number(event.target.value)) : event.target.value)}
        />
      )}
      {field.description && <p className="field-help">{field.description}</p>}
    </div>
  );
}

export function SchemaFields({
  manifest,
  values,
  assets,
  advanced,
  onChange,
}: {
  manifest: ModelManifest;
  values: Record<string, unknown>;
  assets: AssetRecord[];
  advanced: boolean;
  onChange: (id: string, value: unknown) => void;
}) {
  const fields = manifest.inputSchema.filter((field) => field.id !== "prompt" && Boolean(field.advanced) === advanced);
  if (!fields.length) return null;
  return (
    <div className={`schema-fields ${advanced ? "advanced-fields" : ""}`}>
      {fields.map((field) => <FieldControl key={field.id} field={field} value={values[field.id]} assets={assets} onChange={(value) => onChange(field.id, value)} />)}
    </div>
  );
}
