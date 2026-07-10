const SECRET_PATTERNS = [
  /bearer\s+[a-z0-9._~+\/-]+=*/gi,
  /(?:api[_-]?key|token|authorization|password)["'\s:=]+[^\s,"'}]+/gi,
  /sk-[a-z0-9_-]{12,}/gi,
];

export class PlatformError extends Error {
  constructor(
    public readonly code: string,
    public readonly userMessage: string,
    public readonly status = 400,
    public readonly detail?: string,
    public readonly retryable = false,
  ) {
    super(userMessage);
    this.name = "PlatformError";
  }
}

export function redact(value: string, knownSecrets: string[] = []): string {
  let clean = value;
  for (const pattern of SECRET_PATTERNS) clean = clean.replace(pattern, "[redacted]");
  for (const secret of knownSecrets.filter((item) => item.length >= 4)) {
    clean = clean.split(secret).join("[redacted]");
  }
  return clean.slice(0, 2_000);
}

export function normalizeError(error: unknown, knownSecrets: string[] = []): PlatformError {
  if (error instanceof PlatformError) {
    return new PlatformError(
      error.code,
      error.userMessage,
      error.status,
      error.detail ? redact(error.detail, knownSecrets) : undefined,
      error.retryable,
    );
  }

  const raw = redact(error instanceof Error ? error.message : String(error), knownSecrets);
  if (/timed?\s*out|abort/i.test(raw)) {
    return new PlatformError("PROVIDER_TIMEOUT", "The provider did not respond in time.", 504, raw, true);
  }
  if (/fetch failed|ECONNREFUSED|ENOTFOUND|network/i.test(raw)) {
    return new PlatformError("PROVIDER_UNREACHABLE", "The provider could not be reached. Check the endpoint and try again.", 502, raw, true);
  }
  return new PlatformError("PROVIDER_ERROR", "The provider could not complete this run.", 502, raw, true);
}

export function errorResponse(error: unknown): Response {
  const normalized = normalizeError(error);
  return Response.json(
    {
      error: {
        code: normalized.code,
        message: normalized.userMessage,
        detail: normalized.detail,
        retryable: normalized.retryable,
      },
    },
    { status: normalized.status },
  );
}
