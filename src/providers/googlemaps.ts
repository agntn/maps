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
  GeoAddress,
  GeoLocation,
  GeocodeOptions,
  ProviderCapabilities,
  ProviderConfig,
  ReverseOptions,
} from "../core/types.ts";
import { Provider, assertAddress, assertQuery } from "../core/provider.ts";
import { buildQuery } from "../core/client.ts";
import { assertCoordinates } from "../core/coordinates.ts";
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

/** Granularity to the reverse `result_type` filter of the Geocoding API. */
const GRANULARITY_RESULT_TYPE = {
  country: "country",
  state: "administrative_area_level_1",
  city: "locality",
  street: "route",
  building: "street_address",
} as const;

interface GoogleLatLng {
  lat?: number;
  lng?: number;
}

interface GoogleResult {
  formatted_address?: string;
  geometry?: {
    location?: GoogleLatLng;
    viewport?: { northeast?: GoogleLatLng; southwest?: GoogleLatLng };
  };
  types?: string[];
  address_components?: Array<{ long_name?: string; short_name?: string; types?: string[] }>;
}

interface GoogleResponse {
  status?: string;
  results?: GoogleResult[];
  error_message?: string;
}

/** Map the in-body `status` onto the error hierarchy; OK and ZERO_RESULTS pass through. */
function assertOkStatus(data: GoogleResponse): GoogleResult[] {
  const status = data.status ?? "UNKNOWN";
  if (status === "OK" || status === "ZERO_RESULTS") return data.results ?? [];
  const detail = data.error_message ? `${status}: ${data.error_message}` : status;
  switch (status) {
    case "REQUEST_DENIED": {
      throw new AuthError("googlemaps", detail);
    }
    case "OVER_QUERY_LIMIT":
    case "OVER_DAILY_LIMIT": {
      throw new RateLimitError("googlemaps");
    }
    case "INVALID_REQUEST": {
      throw new InvalidInputError(detail, "googlemaps");
    }
    default: {
      throw new MapsError(detail, "googlemaps");
    }
  }
}

function component(raw: GoogleResult, type: string) {
  return raw.address_components?.find((entry) => entry.types?.includes(type));
}

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

function mapResult(raw: GoogleResult): GeoLocation | undefined {
  const location = raw.geometry?.location;
  if (location?.lat === undefined || location.lng === undefined) return undefined;
  const northeast = raw.geometry?.viewport?.northeast;
  const southwest = raw.geometry?.viewport?.southwest;
  const country = component(raw, "country")?.short_name;

  return {
    latitude: location.lat,
    longitude: location.lng,
    displayName: raw.formatted_address,
    category: raw.types?.[0],
    countryCode: country?.toLowerCase(),
    address: mapAddress(raw),
    boundingBox:
      northeast?.lat !== undefined &&
      northeast.lng !== undefined &&
      southwest?.lat !== undefined &&
      southwest.lng !== undefined
        ? { south: southwest.lat, north: northeast.lat, west: southwest.lng, east: northeast.lng }
        : undefined,
    raw: raw as unknown as Record<string, unknown>,
  };
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

  private async fetchResults(
    params: Record<string, string | number | undefined>,
  ): Promise<GoogleResult[]> {
    const url = `${this.baseUrl}${buildQuery({ ...params, key: this.apiKey })}`;
    return assertOkStatus(await this.getJSON<GoogleResponse>(url));
  }

  async geocode(query: string, options?: GeocodeOptions): Promise<GeoLocation[]> {
    assertQuery(query, "googlemaps");
    const components = options?.countryCodes
      ?.map((code) => `country:${code.toUpperCase()}`)
      .join("|");
    const results = await this.fetchResults({
      address: query,
      language: options?.language,
      components: components || undefined,
    });
    return results
      .map((result) => mapResult(result))
      .filter((location) => location !== undefined)
      .slice(0, clampMaxResults(options?.limit, MAX_RESULTS));
  }

  /**
   * Street and house number ride in the free-form `address` param (Google's components filter
   * has no street_number type); the remaining fields become `components` entries.
   */
  async geocodeAddress(address: GeoAddress, options?: GeocodeOptions): Promise<GeoLocation[]> {
    assertAddress(address, "googlemaps");
    const street = [address.houseNumber, address.road].filter(Boolean).join(" ");
    const components = [
      address.city ? `locality:${address.city}` : undefined,
      address.state ? `administrative_area:${address.state}` : undefined,
      address.postcode ? `postal_code:${address.postcode}` : undefined,
      address.country ? `country:${address.country}` : undefined,
      ...(options?.countryCodes?.map((code) => `country:${code.toUpperCase()}`) ?? []),
    ]
      .filter(Boolean)
      .join("|");
    const results = await this.fetchResults({
      address: street || undefined,
      components: components || undefined,
      language: options?.language,
    });
    return results
      .map((result) => mapResult(result))
      .filter((location) => location !== undefined)
      .slice(0, clampMaxResults(options?.limit, MAX_RESULTS));
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
