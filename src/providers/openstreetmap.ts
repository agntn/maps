/**
 * OpenStreetMap provider - the public Nominatim geocoder
 *
 * No API key. Usage policy applies: at most one request per second and an identifying
 * User-Agent, which the shared client already sends. Heavy or bulk traffic belongs on a
 * self-hosted Nominatim passed through `baseUrl`.
 *
 * API: https://nominatim.openstreetmap.org (REST, jsonv2 format)
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
import { NotFoundError } from "../core/errors.ts";
import { register } from "../core/registry.ts";
import { clampMaxResults, compactAddress } from "../core/types.ts";

const MAX_RESULTS = 40;

interface NominatimAddress {
  house_number?: string;
  road?: string;
  city?: string;
  town?: string;
  village?: string;
  hamlet?: string;
  municipality?: string;
  state?: string;
  postcode?: string;
  country?: string;
  country_code?: string;
}

interface NominatimPlace {
  lat?: string;
  lon?: string;
  display_name?: string;
  category?: string;
  type?: string;
  /** [south, north, west, east] as decimal-degree strings */
  boundingbox?: string[];
  address?: NominatimAddress;
  /** Reverse lookups report failures in the body with HTTP 200 */
  error?: string;
}

function mapAddress(address?: NominatimAddress): GeoAddress | undefined {
  if (!address) return undefined;
  return compactAddress({
    houseNumber: address.house_number,
    road: address.road,
    city: address.city ?? address.town ?? address.village ?? address.hamlet ?? address.municipality,
    state: address.state,
    postcode: address.postcode,
    country: address.country,
  });
}

function mapPlace(raw: NominatimPlace): GeoLocation {
  const box = raw.boundingbox?.map(Number);
  return {
    latitude: Number(raw.lat),
    longitude: Number(raw.lon),
    displayName: raw.display_name,
    category: raw.type ?? raw.category,
    countryCode: raw.address?.country_code,
    address: mapAddress(raw.address),
    boundingBox:
      box?.length === 4 && box.every(Number.isFinite)
        ? { south: box[0]!, north: box[1]!, west: box[2]!, east: box[3]! }
        : undefined,
    raw: raw as unknown as Record<string, unknown>,
  };
}

class OpenStreetMap extends Provider {
  static readonly key = "openstreetmap";

  private readonly baseUrl: string;

  constructor(config: ProviderConfig) {
    super(config);
    this.baseUrl = config.baseUrl ?? "https://nominatim.openstreetmap.org";
  }

  get capabilities(): ProviderCapabilities {
    return {
      geocode: true,
      geocodeAddress: true,
      reverse: true,
    };
  }

  /** Shared query-string tail for both geocoding shapes. */
  private searchParams(options?: GeocodeOptions): Record<string, string | number | undefined> {
    const countryCodes = options?.countryCodes?.map((code) => code.toLowerCase()).join(",");
    return {
      format: "jsonv2",
      addressdetails: 1,
      limit: clampMaxResults(options?.limit, MAX_RESULTS),
      "accept-language": options?.language,
      countrycodes: countryCodes || undefined,
    };
  }

  async geocode(query: string, options?: GeocodeOptions): Promise<GeoLocation[]> {
    assertQuery(query, "openstreetmap");
    const url = `${this.baseUrl}/search${buildQuery({ q: query, ...this.searchParams(options) })}`;
    const data = await this.getJSON<NominatimPlace[]>(url);
    return data.map((place) => mapPlace(place));
  }

  /** Nominatim structured search; `street` carries "housenumber streetname" per its contract. */
  async geocodeAddress(address: GeoAddress, options?: GeocodeOptions): Promise<GeoLocation[]> {
    assertAddress(address, "openstreetmap");
    const street = [address.houseNumber, address.road].filter(Boolean).join(" ");
    const url = `${this.baseUrl}/search${buildQuery({
      street: street || undefined,
      city: address.city,
      state: address.state,
      postalcode: address.postcode,
      country: address.country,
      ...this.searchParams(options),
    })}`;
    const data = await this.getJSON<NominatimPlace[]>(url);
    return data.map((place) => mapPlace(place));
  }

  async reverse(
    latitude: number,
    longitude: number,
    options?: ReverseOptions,
  ): Promise<GeoLocation> {
    assertCoordinates(latitude, longitude, "openstreetmap");
    const url = `${this.baseUrl}/reverse${buildQuery({
      lat: latitude,
      lon: longitude,
      format: "jsonv2",
      addressdetails: 1,
      "accept-language": options?.language,
    })}`;
    const data = await this.getJSON<NominatimPlace>(url);
    if (data.error) {
      throw new NotFoundError(`${latitude}, ${longitude}`, "openstreetmap");
    }
    return mapPlace(data);
  }
}

register(OpenStreetMap, "https://nominatim.openstreetmap.org");
