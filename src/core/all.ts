/** Parallel fan-out over every registered provider, for side-by-side comparison. */

import type { Provider } from "./provider.ts";
import type { GeoAddress, GeoLocation, GeocodeOptions, ReverseOptions } from "./types.ts";
import { MapsError, normalizeError } from "./errors.ts";
import { requireOperation } from "./provider.ts";
import { create, providers } from "./registry.ts";

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

async function runAll<T>(run: (provider: Provider) => Promise<T>): Promise<ProviderOutcome<T>[]> {
  return Promise.all(
    providers().map(async (name): Promise<ProviderOutcome<T>> => {
      try {
        return { provider: name, result: await run(create(name)) };
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
 * usage policy.
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
): Promise<ProviderOutcome<GeoLocation[]>[]> {
  return runAll((provider) => requireOperation(provider, "geocode")(query, options));
}

/** Geocode one structured address on every registered provider in parallel. */
export function geocodeAddressAll(
  address: GeoAddress,
  options?: GeocodeOptions,
): Promise<ProviderOutcome<GeoLocation[]>[]> {
  return runAll((provider) => requireOperation(provider, "geocodeAddress")(address, options));
}

/** Reverse-geocode one coordinate pair on every registered provider in parallel. */
export function reverseAll(
  latitude: number,
  longitude: number,
  options?: ReverseOptions,
): Promise<ProviderOutcome<GeoLocation>[]> {
  return runAll((provider) => requireOperation(provider, "reverse")(latitude, longitude, options));
}

/** Reduce outcomes to a JSON-safe shape for MCP and AI tool results. */
export function serializeOutcomes<T>(outcomes: ProviderOutcome<T>[]): SerializedOutcome<T>[] {
  return outcomes.map((outcome) =>
    outcome.error
      ? { provider: outcome.provider, error: outcome.error.message }
      : { provider: outcome.provider, result: outcome.result },
  );
}
