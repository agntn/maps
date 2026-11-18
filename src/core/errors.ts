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

/**
 * Strip API keys from URLs and URL-bearing text for safe error messages.
 *
 * @param url - A URL, or text holding one.
 * @returns {string} The text with secret query values redacted.
 */
function sanitizeUrl(url: string): string {
  return url.replaceAll(/([?&])(api[-_]?key|key|secret|token)=[^&#]*/gi, "$1$2=REDACTED");
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

/** What the classifiers read off a thrown value. */
interface Failure {
  readonly message: string;
  readonly lower: string;
  readonly status: number;
  readonly url: string | undefined;
  /** Response body, when a response came back. */
  readonly body: string | undefined;
  readonly provider: string | undefined;
  /** The provider, or `unknown` for the classes that need a name. */
  readonly source: string;
}

/**
 * What a `ResponseError` knows that a bare message doesn't.
 *
 * @param error - The thrown value.
 * @returns {Partial<Failure>} Status, URL and body, or nothing.
 */
function responseParts(error: unknown): Partial<Failure> {
  if (!(error instanceof ResponseError)) return {};
  return { status: error.status, url: error.url, body: error.body };
}

/**
 * Read the status, URL and message off whatever was thrown.
 *
 * @param error - The thrown value.
 * @param provider - Provider the request belonged to.
 * @param requestUrl - URL of the request, when the caller knows it.
 * @returns {Failure} The parts the classifiers read.
 */
function describeFailure(error: unknown, provider?: string, requestUrl?: string): Failure {
  const message = error instanceof Error ? error.message : String(error);
  const sent = responseParts(error);
  return {
    message,
    lower: message.toLowerCase(),
    status: sent.status ?? Number(/HTTP (\d{3})/i.exec(message)?.[1] ?? 0),
    url: requestUrl ?? sent.url,
    body: sent.body,
    provider,
    source: provider ?? "unknown",
  };
}

/**
 * A 404, or a message that says so.
 *
 * @param failure - The failure to sort.
 * @returns {MapsError | undefined} The error, or nothing when this isn't one.
 */
function notFound(failure: Failure): MapsError | undefined {
  if (failure.status !== 404 && !failure.lower.includes("not found")) return undefined;
  return new NotFoundError(failure.url ?? failure.message, failure.provider);
}

/**
 * A 429, or a message that says so.
 *
 * @param failure - The failure to sort.
 * @returns {MapsError | undefined} The error, or nothing when this isn't one.
 */
function rateLimited(failure: Failure): MapsError | undefined {
  if (failure.status !== 429 && !failure.lower.includes("rate limit")) return undefined;
  return new RateLimitError(failure.source);
}

/**
 * A 402.
 *
 * @param failure - The failure to sort.
 * @returns {MapsError | undefined} The error, or nothing when this isn't one.
 */
function paymentRequired(failure: Failure): MapsError | undefined {
  return failure.status === 402 ? new PaymentError(failure.source, failure.status) : undefined;
}

/**
 * A 401 or a 403, or a message that says so.
 *
 * @param failure - The failure to sort.
 * @returns {MapsError | undefined} The error, or nothing when this isn't one.
 */
function unauthorized(failure: Failure): MapsError | undefined {
  const { status, url } = failure;
  if (status !== 401 && status !== 403 && !failure.lower.includes("unauthorized")) {
    return undefined;
  }
  return new AuthError(failure.source, url ? `HTTP ${status} from ${url}` : failure.message);
}

/** Messages of a request that never got an answer. */
const TRANSPORT_HINTS = ["econnrefused", "etimedout", "timeouterror"];

/**
 * Any other status, or a request that died on the wire.
 *
 * @param failure - The failure to sort.
 * @returns {MapsError | undefined} The error, or nothing when this isn't one.
 */
function transport(failure: Failure): MapsError | undefined {
  const { status, url, lower } = failure;
  if (!(status > 0 || url || TRANSPORT_HINTS.some((hint) => lower.includes(hint)))) {
    return undefined;
  }
  return new HTTPError(status, url ?? "unknown", failure.body ?? failure.message, failure.provider);
}

/** First match wins, so a 404 is never read as a plain HTTP error. */
const CLASSIFIERS = [notFound, rateLimited, paymentRequired, unauthorized, transport];

/**
 * Turn an unknown provider or transport failure into the Maps error hierarchy.
 *
 * Existing `MapsError` instances pass through unchanged. Structured HTTP failures retain their
 * status, response body, and redacted request URL.
 *
 * @param error - The thrown value.
 * @param provider - Provider the request belonged to.
 * @param requestUrl - URL of the request, when the caller knows it.
 * @returns {MapsError} The failure as one of the library's classes.
 */
export function normalizeError(error: unknown, provider?: string, requestUrl?: string): MapsError {
  if (error instanceof MapsError) return error;

  const failure = describeFailure(error, provider, requestUrl);
  for (const classify of CLASSIFIERS) {
    const sorted = classify(failure);
    if (sorted) return sorted;
  }
  return new MapsError(failure.message, provider);
}
