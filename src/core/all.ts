/** Parallel fan-out over every registered provider, for side-by-side comparison. */

import type { Provider } from "./provider.ts";
import type { GeoAddress, GeoLocation, GeocodeOptions, ReverseOptions } from "./types.ts";
import {
  AuthError,
  MapsError,
  PaymentError,
  RateLimitError,
  UnsupportedOperationError,
  normalizeError,
} from "./errors.ts";
import { requireOperation } from "./provider.ts";
import { create, providers } from "./registry.ts";
import { resolveProvider } from "./resolve.ts";

/**
 * One provider's contribution to a comparison: either its result or its normalized failure.
 *
 * Failures stay in the list on purpose - a provider that needs a missing API key or does not
 * serve the operation is itself useful signal when comparing backends.
 */
export type ProviderOutcome<T> =
  | { provider: string; result: T; error?: never }
  | { provider: string; error: MapsError; result?: never };

/** JSON-safe view of outcomes: errors reduced to their messages. */
export interface SerializedOutcome<T> {
  provider: string;
  result?: T;
  error?: string;
}

async function runAll<T>(
  run: (provider: Provider) => Promise<T>,
  signal?: AbortSignal,
): Promise<ProviderOutcome<T>[]> {
  return Promise.all(
    providers().map(async (name): Promise<ProviderOutcome<T>> => {
      try {
        return { provider: name, result: await run(create(name, { signal })) };
      } catch (error) {
        return { provider: name, error: normalizeError(error, name) };
      }
    }),
  );
}

/**
 * Geocode one query on every registered provider in parallel.
 *
 * Each provider receives one request, so a single call stays within the public Nominatim
 * usage policy. Aborting `signal` cancels every request.
 *
 * @example
 *   ```ts
 *   import { geocodeAll } from "@agntn/maps";
 *
 *   const outcomes = await geocodeAll("Pałac Kultury i Nauki", { limit: 1 });
 *   ```
 */
export function geocodeAll(
  query: string,
  options?: GeocodeOptions,
  signal?: AbortSignal,
): Promise<ProviderOutcome<GeoLocation[]>[]> {
  return runAll((provider) => requireOperation(provider, "geocode")(query, options), signal);
}

/** Geocode one structured address on every registered provider in parallel. */
export function geocodeAddressAll(
  address: GeoAddress,
  options?: GeocodeOptions,
  signal?: AbortSignal,
): Promise<ProviderOutcome<GeoLocation[]>[]> {
  return runAll(
    (provider) => requireOperation(provider, "geocodeAddress")(address, options),
    signal,
  );
}

/** Reverse-geocode one coordinate pair on every registered provider in parallel. */
export function reverseAll(
  latitude: number,
  longitude: number,
  options?: ReverseOptions,
  signal?: AbortSignal,
): Promise<ProviderOutcome<GeoLocation>[]> {
  return runAll(
    (provider) => requireOperation(provider, "reverse")(latitude, longitude, options),
    signal,
  );
}

/** JSON-safe outcomes for the MCP and AI tools; every success goes through `view` first. */
export function serializeOutcomes<T>(
  outcomes: ProviderOutcome<T>[],
  view: (result: T) => T = (result) => result,
): SerializedOutcome<T>[] {
  return outcomes.map((outcome) =>
    outcome.error
      ? { provider: outcome.provider, error: outcome.error.message }
      : { provider: outcome.provider, result: view(outcome.result) },
  );
}

/** A failure worth falling past: missing or rejected credentials, billing, or a rate limit. */
function isSkippable(error: MapsError): boolean {
  return (
    error instanceof AuthError ||
    error instanceof PaymentError ||
    error instanceof RateLimitError ||
    error instanceof UnsupportedOperationError
  );
}

/**
 * Run one operation on the auto-selected provider, falling past providers whose failure is
 * about access rather than the request: missing keys, billing, rate limits, and unsupported
 * operations. Anything else (bad input, not found, transport) propagates immediately, and when
 * every provider is skipped the first skip reason is thrown - that is the error of the provider
 * auto-selection actually picked. An aborted `signal` ends the walk at the provider it reached.
 */
async function runWithFallback<T>(
  run: (provider: Provider) => Promise<T>,
  signal?: AbortSignal,
): Promise<{ provider: string; result: T }> {
  const candidates = [...new Set([resolveProvider(), ...providers()])];
  let firstSkipped: MapsError | undefined;
  for (const name of candidates) {
    try {
      return { provider: name, result: await run(create(name, { signal })) };
    } catch (error) {
      const normalized = normalizeError(error, name);
      if (signal?.aborted || !isSkippable(normalized)) throw normalized;
      firstSkipped ??= normalized;
    }
  }
  throw firstSkipped ?? new MapsError("No provider is registered");
}

/** Geocode on the auto-selected provider, falling past auth, billing, and rate-limit failures. */
export function geocodeWithFallback(
  query: string,
  options?: GeocodeOptions,
  signal?: AbortSignal,
): Promise<{ provider: string; result: GeoLocation[] }> {
  return runWithFallback(
    (provider) => requireOperation(provider, "geocode")(query, options),
    signal,
  );
}

/** Structured-address variant of `geocodeWithFallback`. */
export function geocodeAddressWithFallback(
  address: GeoAddress,
  options?: GeocodeOptions,
  signal?: AbortSignal,
): Promise<{ provider: string; result: GeoLocation[] }> {
  return runWithFallback(
    (provider) => requireOperation(provider, "geocodeAddress")(address, options),
    signal,
  );
}

/** Reverse-geocoding variant of `geocodeWithFallback`. */
export function reverseWithFallback(
  latitude: number,
  longitude: number,
  options?: ReverseOptions,
  signal?: AbortSignal,
): Promise<{ provider: string; result: GeoLocation }> {
  return runWithFallback(
    (provider) => requireOperation(provider, "reverse")(latitude, longitude, options),
    signal,
  );
}
