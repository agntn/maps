/**
 * Google Maps provider - Google Maps Platform Geocoding API
 *
 * Auth: required API key. Env: GOOGLE_MAPS_API_KEY. The key travels in the `key` query param and
 * is redacted from error messages by the shared sanitizer.
 *
 * The API reports failures in the JSON body with HTTP 200; the `status` string is mapped onto
 * the Maps error hierarchy here.
 *
 * API: https://maps.googleapis.com/maps/api/geocode/json (REST)
 */

import type {
  BoundingBox,
  GeoAddress,
  GeoLocation,
  GeocodeLayer,
  GeocodeOptions,
  ProviderCapabilities,
  ProviderConfig,
  ReverseOptions,
} from "../core/types.ts";
import { Provider, assertAddress, assertLayers, assertQuery } from "../core/provider.ts";
import { buildQuery } from "../core/client.ts";
import { assertCoordinates, type GeoPoint } from "../core/coordinates.ts";
import {
  AuthError,
  InvalidInputError,
  MapsError,
  NotFoundError,
  RateLimitError,
} from "../core/errors.ts";
import { register } from "../core/registry.ts";
import { clampMaxResults, compactAddress } from "../core/types.ts";

/** The response is not paginated; the client slices locally. */
const MAX_RESULTS = 20;

/**
 * Result `types` that place a hit in the poi layer, from the Geocoding API's address types table;
 * `premise` is there because a named building can come back with that type alone. The API has no
 * request-side layer filter, so `layers` is applied locally after the response.
 */
const POI_TYPES = new Set([
  "point_of_interest",
  "establishment",
  "premise",
  "airport",
  "park",
  "bus_station",
  "train_station",
  "transit_station",
]);

/** Granularity to the reverse `result_type` filter of the Geocoding API. */
const GRANULARITY_RESULT_TYPE = {
  country: "country",
  state: "administrative_area_level_1",
  city: "locality",
  street: "route",
  building: "street_address",
} as const;

interface GoogleLatLng {
  readonly lat?: number;
  readonly lng?: number;
}

interface GoogleViewport {
  readonly northeast?: GoogleLatLng;
  readonly southwest?: GoogleLatLng;
}

interface GoogleComponent {
  readonly long_name?: string;
  readonly short_name?: string;
  readonly types?: readonly string[];
}

interface GoogleResult {
  readonly formatted_address?: string;
  readonly geometry?: { readonly location?: GoogleLatLng; readonly viewport?: GoogleViewport };
  readonly types?: readonly string[];
  readonly address_components?: readonly GoogleComponent[];
}

interface GoogleResponse {
  readonly status?: string;
  readonly results?: readonly GoogleResult[];
  readonly error_message?: string;
}

/** The body's `status` to the error it stands for. Anything else is a plain `MapsError`. */
const STATUS_ERRORS = new Map<string, (detail: string) => MapsError>([
  ["REQUEST_DENIED", (detail) => new AuthError("googlemaps", detail)],
  ["OVER_QUERY_LIMIT", () => new RateLimitError("googlemaps")],
  ["OVER_DAILY_LIMIT", () => new RateLimitError("googlemaps")],
  ["INVALID_REQUEST", (detail) => new InvalidInputError(detail, "googlemaps")],
]);

/**
 * Map the in-body `status` onto the error hierarchy; OK and ZERO_RESULTS pass through.
 *
 * @param data - The response body.
 * @returns {readonly GoogleResult[]} The results, none for ZERO_RESULTS.
 * @throws {MapsError} For every other status, as the class it stands for.
 */
function assertOkStatus(data: GoogleResponse): readonly GoogleResult[] {
  const status = data.status ?? "UNKNOWN";
  if (status === "OK" || status === "ZERO_RESULTS") return data.results ?? [];
  const detail = data.error_message ? `${status}: ${data.error_message}` : status;
  throw STATUS_ERRORS.get(status)?.(detail) ?? new MapsError(detail, "googlemaps");
}

/**
 * Layer of one result, partitioned the way Nominatim does it: natural, then poi, else address.
 *
 * @param types - The result's `types`.
 * @returns {GeocodeLayer} Its layer.
 */
function layerOf(types: readonly string[] = []): GeocodeLayer {
  if (types.includes("natural_feature")) return "natural";
  if (types.some((type) => POI_TYPES.has(type))) return "poi";
  return "address";
}

/**
 * The address component of one type.
 *
 * @param raw - One result.
 * @param type - Component type, such as `route`.
 * @returns {GoogleComponent | undefined} The component, when the result has it.
 */
function component(raw: GoogleResult, type: string): GoogleComponent | undefined {
  return raw.address_components?.find((entry) => entry.types?.includes(type));
}

/**
 * Address parts of one result, by `long_name`.
 *
 * @param raw - One result.
 * @returns {GeoAddress | undefined} The parts, or nothing when there are none.
 */
function mapAddress(raw: GoogleResult): GeoAddress | undefined {
  return compactAddress({
    houseNumber: component(raw, "street_number")?.long_name,
    road: component(raw, "route")?.long_name,
    city: component(raw, "locality")?.long_name ?? component(raw, "postal_town")?.long_name,
    state: component(raw, "administrative_area_level_1")?.long_name,
    postcode: component(raw, "postal_code")?.long_name,
    country: component(raw, "country")?.long_name,
  });
}

/**
 * A `lat`/`lng` pair as a point, when both are there.
 *
 * @param pair - A pair off the wire.
 * @returns {GeoPoint | undefined} The point, or nothing when half is missing.
 */
function toPoint(pair: GoogleLatLng | undefined): GeoPoint | undefined {
  if (pair?.lat === undefined || pair.lng === undefined) return undefined;
  return { latitude: pair.lat, longitude: pair.lng };
}

/**
 * The viewport as a bounding box, when all four edges are there.
 *
 * @param viewport - The result's viewport.
 * @returns {BoundingBox | undefined} The box, or nothing.
 */
function toBox(viewport: GoogleViewport | undefined): BoundingBox | undefined {
  const northeast = toPoint(viewport?.northeast);
  const southwest = toPoint(viewport?.southwest);
  if (!northeast || !southwest) return undefined;
  return {
    south: southwest.latitude,
    north: northeast.latitude,
    west: southwest.longitude,
    east: northeast.longitude,
  };
}

/**
 * One result as a location.
 *
 * @param raw - One result.
 * @returns {GeoLocation | undefined} The location, or nothing without coordinates.
 */
function mapResult(raw: GoogleResult): GeoLocation | undefined {
  const point = toPoint(raw.geometry?.location);
  if (!point) return undefined;
  return {
    ...point,
    displayName: raw.formatted_address,
    category: raw.types?.[0],
    countryCode: component(raw, "country")?.short_name?.toLowerCase(),
    address: mapAddress(raw),
    boundingBox: toBox(raw.geometry?.viewport),
    raw: raw as unknown as Record<string, unknown>,
  };
}

/**
 * The `components` filter: country codes, and for a structured address its parts.
 *
 * @param countryCodes - ISO country codes to restrict to.
 * @param address - Address parts; street and house number travel elsewhere.
 * @returns {string | undefined} The filter, or nothing when it's empty.
 */
function componentsFilter(
  countryCodes: readonly string[] = [],
  address: GeoAddress = {},
): string | undefined {
  const named = [
    ["locality", address.city],
    ["administrative_area", address.state],
    ["postal_code", address.postcode],
    ["country", address.country],
  ]
    .filter(([, value]) => value)
    .map(([name, value]) => `${name}:${value}`);
  const codes = countryCodes.map((code) => `country:${code.toUpperCase()}`);
  return [...named, ...codes].join("|") || undefined;
}

class GoogleMaps extends Provider {
  static readonly key = "googlemaps";

  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(config: ProviderConfig) {
    super(config);
    this.baseUrl = config.baseUrl ?? "https://maps.googleapis.com/maps/api/geocode/json";
    const key = config.apiKey ?? process.env.GOOGLE_MAPS_API_KEY ?? "";
    if (!key) {
      throw new AuthError("googlemaps", "Set GOOGLE_MAPS_API_KEY or pass apiKey in config");
    }
    this.apiKey = key;
  }

  get capabilities(): ProviderCapabilities {
    return {
      geocode: true,
      geocodeAddress: true,
      reverse: true,
    };
  }

  /**
   * One request to the API, its in-body status checked.
   *
   * @param params - Query parameters; the key is added here.
   * @returns {Promise<readonly GoogleResult[]>} The results.
   */
  private async fetchResults(
    params: Readonly<Record<string, string | number | undefined>>,
  ): Promise<readonly GoogleResult[]> {
    const url = `${this.baseUrl}${buildQuery({ ...params, key: this.apiKey })}`;
    return assertOkStatus(await this.getJSON<GoogleResponse>(url));
  }

  /**
   * Apply the local layer filter, normalize, and cut to the requested limit.
   *
   * @param results - Results as the API sent them.
   * @param options - Layers and limit.
   * @returns {GeoLocation[]} The matches.
   */
  private collect(results: readonly GoogleResult[], options?: GeocodeOptions): GeoLocation[] {
    const layers = options?.layers?.length ? options.layers : undefined;
    return results
      .filter((raw) => !layers || layers.includes(layerOf(raw.types)))
      .map((result) => mapResult(result))
      .filter((location) => location !== undefined)
      .slice(0, clampMaxResults(options?.limit, MAX_RESULTS));
  }

  async geocode(query: string, options?: GeocodeOptions): Promise<GeoLocation[]> {
    assertQuery(query, "googlemaps");
    assertLayers(options?.layers, "googlemaps");
    const results = await this.fetchResults({
      address: query,
      language: options?.language,
      components: componentsFilter(options?.countryCodes),
    });
    return this.collect(results, options);
  }

  /**
   * Street and house number ride in the free-form `address` param (Google's components filter
   * has no street_number type); the remaining fields become `components` entries.
   *
   * @param address - Address parts to look up.
   * @param options - Limit, language and filters.
   * @returns {Promise<GeoLocation[]>} The matches.
   */
  async geocodeAddress(address: GeoAddress, options?: GeocodeOptions): Promise<GeoLocation[]> {
    assertAddress(address, "googlemaps");
    assertLayers(options?.layers, "googlemaps");
    const street = [address.houseNumber, address.road].filter(Boolean).join(" ");
    const results = await this.fetchResults({
      address: street || undefined,
      components: componentsFilter(options?.countryCodes, address),
      language: options?.language,
    });
    return this.collect(results, options);
  }

  async reverse(
    latitude: number,
    longitude: number,
    options?: ReverseOptions,
  ): Promise<GeoLocation> {
    assertCoordinates(latitude, longitude, "googlemaps");
    const results = await this.fetchResults({
      latlng: `${latitude},${longitude}`,
      language: options?.language,
      result_type: options?.granularity ? GRANULARITY_RESULT_TYPE[options.granularity] : undefined,
    });
    for (const raw of results) {
      const location = mapResult(raw);
      if (location) return location;
    }
    throw new NotFoundError(`${latitude}, ${longitude}`, "googlemaps");
  }
}

register(GoogleMaps, "https://maps.googleapis.com/maps/api/geocode/json");
