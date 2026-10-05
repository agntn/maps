/** Maps error hierarchy */

/**
 * Base class for failures surfaced through Maps.
 *
 * Every message passes through `sanitizeUrl` here, so secret query params - the Google Maps
 * `key` included - are redacted at one boundary instead of at each construction site.
 */
export class MapsError extends Error {
  readonly provider?: string;

  constructor(message: string, provider?: string) {
    super(sanitizeUrl(message));
    this.name = "MapsError";
    this.provider = provider;
  }
}

/** Strip API keys from URLs and URL-bearing text for safe error messages. */
function sanitizeUrl(url: string): string {
  return url.replace(/([?&])(api[-_]?key|key|secret|token)=[^&#]*/gi, "$1$2=REDACTED");
}

/** HTTP failure with a redacted request URL in its message and a redacted response body. */
export class HTTPError extends MapsError {
  readonly statusCode: number;

  /**
   * Request URL with secrets redacted. Non-enumerable to keep serialized errors compact.
   */
  readonly rawUrl: string;

  /** Response body, redacted in case the server echoes the request URL. */
  readonly body?: string;

  constructor(statusCode: number, url: string, body?: string, provider?: string) {
    super(`HTTP ${statusCode} from ${url}`, provider);
    this.statusCode = statusCode;
    if (body !== undefined) this.body = sanitizeUrl(body);
    this.rawUrl = sanitizeUrl(url);
    Object.defineProperty(this, "rawUrl", { enumerable: false });
    this.name = "HTTPError";
  }
}

/** Provider credentials were missing or rejected. */
export class AuthError extends MapsError {
  constructor(provider: string, detail?: string) {
    super(`Authentication failed for ${provider}${detail ? `: ${detail}` : ""}`, provider);
    this.name = "AuthError";
  }
}

/** Provider demands payment or an upgraded plan for the request. */
export class PaymentError extends MapsError {
  readonly statusCode: number;

  constructor(provider: string, statusCode = 402) {
    super(`Payment required by ${provider} (HTTP ${statusCode})`, provider);
    this.statusCode = statusCode;
    this.name = "PaymentError";
  }
}

/** Provider refused a request because its rate limit was reached. */
export class RateLimitError extends MapsError {
  readonly retryAfter?: number;

  constructor(provider: string, retryAfter?: number) {
    super(
      `Rate limited by ${provider}${retryAfter ? ` (retry after ${retryAfter}s)` : ""}`,
      provider,
    );
    this.retryAfter = retryAfter;
    this.name = "RateLimitError";
  }
}

/** Requested place or coordinate pair could not be resolved. */
export class NotFoundError extends MapsError {
  constructor(resource: string, provider?: string) {
    super(`Not found: ${resource}`, provider);
    this.name = "NotFoundError";
  }
}

/** Provider backend does not expose the requested operation. */
export class UnsupportedOperationError extends MapsError {
  constructor(operation: string, provider: string) {
    super(`Operation "${operation}" not supported by ${provider}`, provider);
    this.name = "UnsupportedOperationError";
  }
}

/** Registry does not contain the requested provider name. */
export class UnknownProviderError extends MapsError {
  constructor(provider: string) {
    super(`Unknown provider: ${provider}`, provider);
    this.name = "UnknownProviderError";
  }
}

/** Caller input failed validation before any request was sent. */
export class InvalidInputError extends MapsError {
  constructor(message: string, provider?: string) {
    super(message, provider);
    this.name = "InvalidInputError";
  }
}

/** A 4xx or 5xx before `normalizeError` sorts it into the hierarchy. It never leaves the client. */
export class ResponseError extends Error {
  readonly status: number;
  readonly url: string;
  readonly body: string;

  constructor(status: number, url: string, body: string) {
    super(`HTTP ${status} from ${url}`);
    this.status = status;
    this.url = url;
    this.body = body;
    this.name = "ResponseError";
  }
}

/**
 * Turn an unknown provider or transport failure into the Maps error hierarchy.
 *
 * Existing `MapsError` instances pass through unchanged. Structured HTTP failures retain their
 * status, response body, and redacted request URL.
 */
export function normalizeError(error: unknown, provider?: string, requestUrl?: string): MapsError {
  if (error instanceof MapsError) return error;

  const message = error instanceof Error ? error.message : String(error);
  const lowerMessage = message.toLowerCase();
  const response = error instanceof ResponseError ? error : undefined;
  const statusMatch = message.match(/HTTP (\d{3})/i);
  const status = response?.status ?? Number(statusMatch?.[1] ?? 0);
  const url = requestUrl ?? response?.url;
  const resource = url ?? message;

  if (status === 404 || lowerMessage.includes("not found")) {
    return new NotFoundError(resource, provider);
  }

  if (status === 429 || lowerMessage.includes("rate limit")) {
    return new RateLimitError(provider ?? "unknown");
  }

  if (status === 402) {
    return new PaymentError(provider ?? "unknown", status);
  }

  if (status === 401 || status === 403 || lowerMessage.includes("unauthorized")) {
    const detail = url ? `HTTP ${status} from ${url}` : message;
    return new AuthError(provider ?? "unknown", detail);
  }

  if (
    status > 0 ||
    url ||
    lowerMessage.includes("econnrefused") ||
    lowerMessage.includes("etimedout") ||
    lowerMessage.includes("timeouterror")
  ) {
    return new HTTPError(status, url ?? "unknown", response?.body ?? message, provider);
  }

  return new MapsError(message, provider);
}
