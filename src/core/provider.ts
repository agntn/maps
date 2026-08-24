import type {
  GeoLocation,
  GeocodeOptions,
  ProviderCapabilities,
  ProviderConfig,
  ReverseOptions,
} from "./types.ts";
import { getJSON } from "./client.ts";
import type { ClientOptions } from "./client.ts";
import { InvalidInputError, UnsupportedOperationError } from "./errors.ts";

/**
 * Common API for geocoding backends.
 *
 * A provider holds backend configuration, not a place. Pass queries and coordinates to the
 * relevant methods and check `capabilities` before using an operation.
 */
export abstract class Provider {
  private readonly timeout: number | undefined;

  constructor(config: ProviderConfig = {}) {
    this.timeout = config.timeout;
  }

  /** Registry key owned by the concrete class. */
  get name(): string {
    return (this.constructor as ProviderConstructor).key;
  }

  /** Operations this provider can actually serve. */
  abstract get capabilities(): ProviderCapabilities;

  /** Resolve a free-form place or address query to coordinates, best match first. */
  abstract geocode(query: string, options?: GeocodeOptions): Promise<GeoLocation[]>;

  /** Resolve a coordinate pair to the place at or nearest to it. */
  abstract reverse(
    latitude: number,
    longitude: number,
    options?: ReverseOptions,
  ): Promise<GeoLocation>;

  /** Execute a provider-attributed GET request using the configured timeout. */
  protected getJSON<T>(
    url: string,
    options?: Omit<ClientOptions, "provider" | "timeout">,
  ): Promise<T> {
    return getJSON<T>(url, { ...options, timeout: this.timeout, provider: this.name });
  }
}

/** Concrete provider class accepted by the registry. */
export interface ProviderConstructor {
  /** Stable registry key owned by the concrete class. */
  readonly key: string;
  new (config: ProviderConfig): Provider;
}

/**
 * Reject an empty or whitespace-only geocoding query before any request is sent.
 *
 * @throws {InvalidInputError} When `query` carries no content.
 */
export function assertQuery(query: string, provider: string): void {
  if (!query.trim()) {
    throw new InvalidInputError("query is empty", provider);
  }
}

/** Operation names accepted by `requireOperation` - one per capability flag. */
export type ProviderOperation = keyof ProviderCapabilities;

/**
 * Return a bound provider method after checking its capability flag.
 *
 * @throws {UnsupportedOperationError} When the provider does not serve the operation.
 */
export function requireOperation<K extends ProviderOperation>(
  provider: Provider,
  operation: K,
): Provider[K] {
  if (!provider.capabilities[operation]) {
    throw new UnsupportedOperationError(operation, provider.name);
  }
  return provider[operation].bind(provider) as Provider[K];
}
