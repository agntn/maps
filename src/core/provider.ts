import type {
  GeoAddress,
  GeoLocation,
  GeocodeLayer,
  GeocodeOptions,
  ProviderCapabilities,
  ProviderConfig,
  ReverseOptions,
} from "./types.ts";
import { getJSON } from "./client.ts";
import type { ClientOptions } from "./client.ts";
import { InvalidInputError, UnsupportedOperationError } from "./errors.ts";
import { GEOCODE_LAYERS } from "./types.ts";

/**
 * Common API for geocoding backends.
 *
 * A provider holds backend configuration, not a place. Pass queries and coordinates to the
 * relevant methods and check `capabilities` before using an operation.
 */
export abstract class Provider {
  private readonly timeout: number | undefined;
  private readonly signal: AbortSignal | undefined;

  constructor(config: ProviderConfig = {}) {
    this.timeout = config.timeout;
    this.signal = config.signal;
  }

  /** Registry key owned by the concrete class. */
  get name(): string {
    return (this.constructor as ProviderConstructor).key;
  }

  /** Operations this provider can actually serve. */
  abstract get capabilities(): ProviderCapabilities;

  /** Resolve a free-form place or address query to coordinates, best match first. */
  abstract geocode(query: string, options?: GeocodeOptions): Promise<GeoLocation[]>;

  /** Resolve a structured postal address (street, city, postcode, ...) to coordinates. */
  abstract geocodeAddress(address: GeoAddress, options?: GeocodeOptions): Promise<GeoLocation[]>;

  /** Resolve a coordinate pair to the place at or nearest to it. */
  abstract reverse(
    latitude: number,
    longitude: number,
    options?: ReverseOptions,
  ): Promise<GeoLocation>;

  /** A provider-attributed GET: its own signal and the configured one both cancel it. */
  protected getJSON<T>(
    url: string,
    options?: Omit<ClientOptions, "provider" | "timeout">,
  ): Promise<T> {
    const signals = [options?.signal, this.signal].filter((signal) => signal !== undefined);
    return getJSON<T>(url, {
      ...options,
      signal: signals.length > 1 ? AbortSignal.any(signals) : signals[0],
      timeout: this.timeout,
      provider: this.name,
    });
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

/**
 * Reject a structured address with no usable field before any request is sent.
 *
 * @throws {InvalidInputError} When every address field is absent or whitespace-only.
 */
export function assertAddress(address: GeoAddress, provider: string): void {
  const hasContent = Object.values(address).some(
    (value) => typeof value === "string" && value.trim() !== "",
  );
  if (!hasContent) {
    throw new InvalidInputError("address needs at least one non-empty field", provider);
  }
}

/**
 * Reject a layer outside `GEOCODE_LAYERS` before any request is sent, so a host that skips
 * schema validation gets the same answer as one that enforces it.
 *
 * @throws {InvalidInputError} When `layers` names a layer the library does not define.
 */
export function assertLayers(layers: readonly string[] | undefined, provider: string): void {
  const unknown = layers?.find((layer) => !GEOCODE_LAYERS.includes(layer as GeocodeLayer));
  if (unknown !== undefined) {
    throw new InvalidInputError(
      `unknown layer: ${unknown} (use ${GEOCODE_LAYERS.join(", ")})`,
      provider,
    );
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
