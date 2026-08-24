/** HTTP client wrapper for Maps providers */

import { ofetch } from "ofetch";
import { normalizeError } from "./errors.ts";
import { version } from "../version.ts";

/**
 * Identifying User-Agent: the public Nominatim instance rejects anonymous or browser-imitating
 * clients per its usage policy.
 */
const USER_AGENT = `agntn-maps/${version} (https://github.com/agntn/maps)`;

/** Request metadata shared by the HTTP helpers. */
export interface ClientOptions {
  timeout?: number;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  provider?: string;
}

/**
 * Fetch JSON with Maps headers and a 15-second default timeout.
 *
 * Transport failures are normalized before they leave this boundary.
 */
export async function getJSON<T>(url: string, options?: ClientOptions): Promise<T> {
  try {
    return await ofetch<T>(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": USER_AGENT,
        ...options?.headers,
      },
      timeout: options?.timeout ?? 15_000,
      signal: options?.signal,
      retry: false,
    });
  } catch (error) {
    throw normalizeError(error, options?.provider, url);
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
