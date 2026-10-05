/** HTTP client wrapper for Maps providers */

import { InvalidInputError, ResponseError, normalizeError } from "./errors.ts";
import { version } from "../version.ts";

/**
 * Identifying User-Agent: the public Nominatim instance rejects anonymous or browser-imitating
 * clients per its usage policy.
 */
const USER_AGENT = `agntn-maps/${version} (https://github.com/agntn/maps)`;

/** Request metadata shared by the HTTP helpers. */
export interface ClientOptions {
  /** Milliseconds before the request gives up: 15 s by default, 0 waits forever. */
  timeout?: number;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  provider?: string;
}

const DEFAULT_TIMEOUT_MS = 15_000;

/** Node's timer ceiling. Past it, `AbortSignal.timeout` fires after 1 ms. */
const MAX_TIMEOUT_MS = 2_147_483_647;

/** Statuses whose response never carries a body. */
const EMPTY_STATUS_CODES = new Set([101, 204, 205, 304]);

/** JSON with the Maps headers and a 15 s deadline, parsed whatever the content type says. */
export async function getJSON<T>(url: string, options?: ClientOptions): Promise<T> {
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: requestHeaders(options?.headers),
      signal: requestSignal(options),
    });
    if (response.status >= 400 && response.status < 600) {
      throw new ResponseError(response.status, url, await response.text());
    }
    return (await readJSON(response)) as T;
  } catch (error) {
    throw normalizeError(error, options?.provider, url);
  }
}

/** Default headers, each replaced by a caller header of the same name in any letter case. */
function requestHeaders(overrides?: Record<string, string>): Headers {
  const headers = new Headers({ Accept: "application/json", "User-Agent": USER_AGENT });
  for (const [name, value] of Object.entries(overrides ?? {})) headers.set(name, value);
  return headers;
}

/** The caller's signal joined with the deadline. A bad timeout fails here, not 1 ms in flight. */
function requestSignal(options?: ClientOptions): AbortSignal | undefined {
  const requested = options?.timeout ?? DEFAULT_TIMEOUT_MS;
  if (!(requested >= 0 && requested <= MAX_TIMEOUT_MS)) {
    throw new InvalidInputError(
      `timeout must be between 0 and ${MAX_TIMEOUT_MS} ms, got ${options?.timeout}`,
      options?.provider,
    );
  }
  const timeout = Math.ceil(requested);
  const signals = [options?.signal, timeout > 0 ? AbortSignal.timeout(timeout) : undefined].filter(
    (signal) => signal !== undefined,
  );
  return signals.length > 1 ? AbortSignal.any(signals) : signals[0];
}

/** JSON when it parses, the raw text when it doesn't, nothing for a bodiless status. */
async function readJSON(response: Response): Promise<unknown> {
  if (!response.body || EMPTY_STATUS_CODES.has(response.status)) return undefined;
  const text = await response.text();
  try {
    return JSON.parse(text, (key, value: unknown) =>
      key === "__proto__" ||
      (key === "constructor" && typeof value === "object" && value !== null && "prototype" in value)
        ? undefined
        : value,
    );
  } catch {
    return text;
  }
}

/**
 * Build a query string while dropping parameters whose value is `undefined`.
 *
 * @example
 *   ```ts
 *   buildQuery({ limit: 2, language: undefined }); // '?limit=2'
 *   ```
 */
export function buildQuery(params: Record<string, string | number | undefined>): string {
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) usp.set(key, String(value));
  }
  const s = usp.toString();
  return s ? `?${s}` : "";
}
