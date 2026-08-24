/** Maps - unified geocoding provider types */

/** WGS 84 bounding box in decimal degrees. */
export interface BoundingBox {
  /** Southern latitude bound */
  south: number;
  /** Northern latitude bound */
  north: number;
  /** Western longitude bound */
  west: number;
  /** Eastern longitude bound */
  east: number;
}

/** Normalized geocoding result: a place resolved to WGS 84 coordinates. */
export interface GeoLocation {
  /** Latitude in decimal degrees, -90 through 90 */
  latitude: number;
  /** Longitude in decimal degrees, -180 through 180 */
  longitude: number;
  /** Formatted, human-readable place name or address */
  displayName?: string;
  /** Provider-native place kind, for example "building" or "street_address" */
  category?: string;
  /** ISO 3166-1 alpha-2 country code, lowercase */
  countryCode?: string;
  /** Bounding box of the place when the provider reports one */
  boundingBox?: BoundingBox;
  /** Raw provider data */
  raw?: Record<string, unknown>;
}

/** Options for forward geocoding (place or address to coordinates). */
export interface GeocodeOptions {
  /** Max results; providers clamp to their own maximum */
  limit?: number;
  /** Restrict results to these ISO 3166-1 alpha-2 country codes */
  countryCodes?: string[];
  /** Preferred language for result names (BCP 47, for example "pl") */
  language?: string;
}

/** Options for reverse geocoding (coordinates to place). */
export interface ReverseOptions {
  /** Preferred language for result names (BCP 47, for example "pl") */
  language?: string;
}

/** Feature flags for operations available on a provider at runtime. */
export interface ProviderCapabilities {
  /** Can resolve a place or address to coordinates */
  geocode: boolean;
  /** Can resolve coordinates to a place */
  reverse: boolean;
}

/** Shared construction options. Providers ignore fields they cannot use. */
export interface ProviderConfig {
  /** API key for providers that require one. */
  apiKey?: string;
  /** Custom API base URL when the provider supports an override. */
  baseUrl?: string;
  /** Request timeout in milliseconds. Defaults to 15 seconds. */
  timeout?: number;
}

/**
 * Round a requested result limit and keep it inside the provider's range.
 *
 * A missing or zero limit uses `max`.
 */
export function clampMaxResults(limit?: number, max = 10): number {
  if (!limit) return max;
  return Math.min(Math.max(1, Math.round(limit)), max);
}
