export class ApiError extends Error {
  constructor(
    message: string,
    public readonly code = "REQUEST_FAILED",
    public readonly detail?: string,
    public readonly retryable = false,
  ) {
    super(message);
  }
}

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (response.status === 204) return undefined as T;
  const body = await response.json().catch(() => ({})) as { error?: { code?: string; message?: string; detail?: string; retryable?: boolean } } & T;
  if (!response.ok) {
    throw new ApiError(
      body.error?.message ?? `Request failed with HTTP ${response.status}.`,
      body.error?.code,
      body.error?.detail,
      body.error?.retryable,
    );
  }
  return body;
}

export function relativeTime(value: string): string {
  const seconds = Math.round((new Date(value).getTime() - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (Math.abs(seconds) < 60) return formatter.format(seconds, "second");
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return formatter.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(hours, "hour");
  return formatter.format(Math.round(hours / 24), "day");
}
