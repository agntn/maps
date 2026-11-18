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
import { Provider, assertAddress, assertLayers, assertQuery } from "../core/provider.ts";
import { buildQuery } from "../core/client.ts";
import { assertCoordinates } from "../core/coordinates.ts";
import { NotFoundError } from "../core/errors.ts";
import { register } from "../core/registry.ts";
import { clampMaxResults, compactAddress } from "../core/types.ts";

const MAX_RESULTS = 40;

/** Granularity to Nominatim reverse `zoom`, per its documented level table. */
const GRANULARITY_ZOOM = {
  country: 3,
  state: 5,
  city: 10,
  street: 16,
  building: 18,
} as const;

interface NominatimAddress {
  readonly house_number?: string;
  readonly road?: string;
  readonly city?: string;
  readonly town?: string;
  readonly village?: string;
  readonly hamlet?: string;
  readonly municipality?: string;
  readonly state?: string;
  readonly postcode?: string;
  readonly country?: string;
  readonly country_code?: string;
}

interface NominatimPlace {
  readonly lat?: string;
  readonly lon?: string;
  readonly display_name?: string;
  readonly category?: string;
  readonly type?: string;
  /** [south, north, west, east] as decimal-degree strings */
  readonly boundingbox?: readonly string[];
  readonly address?: NominatimAddress;
  /** Reverse lookups report failures in the body with HTTP 200 */
  readonly error?: string;
}

/**
 * Address parts of one place; the city falls back down to the municipality.
 *
 * @param address - The place's address details.
 * @returns {GeoAddress | undefined} The parts, or nothing when there are none.
 */
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

/**
 * One place as a location.
 *
 * @param raw - One place.
 * @returns {GeoLocation} The location.
 */
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

  /**
   * Shared query-string tail for both geocoding shapes; `layers` maps 1:1 onto `layer`.
   *
   * @param options - Limit, language and filters.
   * @returns {Record<string, string | number | undefined>} The parameters.
   */
  private searchParams(options?: GeocodeOptions): Record<string, string | number | undefined> {
    const countryCodes = options?.countryCodes?.map((code) => code.toLowerCase()).join(",");
    return {
      format: "jsonv2",
      addressdetails: 1,
      limit: clampMaxResults(options?.limit, MAX_RESULTS),
      "accept-language": options?.language,
      countrycodes: countryCodes || undefined,
      layer: options?.layers?.join(",") || undefined,
    };
  }

  async geocode(query: string, options?: GeocodeOptions): Promise<GeoLocation[]> {
    assertQuery(query, "openstreetmap");
    assertLayers(options?.layers, "openstreetmap");
    const url = `${this.baseUrl}/search${buildQuery({ q: query, ...this.searchParams(options) })}`;
    const data = await this.getJSON<NominatimPlace[]>(url);
    return data.map((place) => mapPlace(place));
  }

  /**
   * Nominatim structured search; `street` carries "housenumber streetname" per its contract.
   *
   * @param address - Address parts to look up.
   * @param options - Limit, language and filters.
   * @returns {Promise<GeoLocation[]>} The matches.
   */
  async geocodeAddress(address: GeoAddress, options?: GeocodeOptions): Promise<GeoLocation[]> {
    assertAddress(address, "openstreetmap");
    assertLayers(options?.layers, "openstreetmap");
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
      zoom: options?.granularity ? GRANULARITY_ZOOM[options.granularity] : undefined,
    })}`;
    const data = await this.getJSON<NominatimPlace>(url);
    if (data.error) {
      throw new NotFoundError(`${latitude}, ${longitude}`, "openstreetmap");
    }
    return mapPlace(data);
  }
}

register(OpenStreetMap, "https://nominatim.openstreetmap.org");
