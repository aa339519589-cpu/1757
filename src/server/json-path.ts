import { PlatformError } from "./errors";

function tokens(path: string): Array<string | number> {
  const normalized = path.trim().replace(/^\$\.?/, "");
  if (!normalized) return [];
  const result: Array<string | number> = [];
  const matcher = /(?:^|\.)([^.[\]]+)|\[(?:(\d+)|["']([^"']+)["'])\]/g;
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(normalized))) {
    if (match[1] !== undefined) result.push(match[1]);
    else if (match[2] !== undefined) result.push(Number(match[2]));
    else if (match[3] !== undefined) result.push(match[3]);
  }
  return result;
}

export function extractJsonPath(value: unknown, path: string | undefined): unknown {
  if (!path) return undefined;
  let current = value;
  for (const token of tokens(path)) {
    if (current === null || current === undefined || typeof current !== "object") return undefined;
    current = (current as Record<string | number, unknown>)[token];
  }
  return current;
}

export function renderTemplate(template: unknown, values: Record<string, unknown>): unknown {
  if (Array.isArray(template)) return template.map((item) => renderTemplate(item, values));
  if (template && typeof template === "object") {
    return Object.fromEntries(
      Object.entries(template).map(([key, value]) => [key, renderTemplate(value, values)]),
    );
  }
  if (typeof template !== "string") return template;
  const exact = template.match(/^\{\{\s*([\w.-]+)\s*\}\}$/);
  if (exact) return values[exact[1]];
  return template.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, key: string) => String(values[key] ?? ""));
}

export function requireMappedValue(value: unknown, path: string, label: string): unknown {
  const mapped = extractJsonPath(value, path);
  if (mapped === undefined || mapped === null || mapped === "") {
    throw new PlatformError(
      "RESPONSE_MAPPING_FAILED",
      `The response did not contain ${label} at ${path}.`,
      422,
      `Mapping '${path}' returned no value.`,
    );
  }
  return mapped;
}
