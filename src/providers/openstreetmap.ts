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
  GeoLocation,
  GeocodeOptions,
  ProviderCapabilities,
  ProviderConfig,
  ReverseOptions,
} from "../core/types.ts";
import { Provider, assertQuery } from "../core/provider.ts";
import { buildQuery } from "../core/client.ts";
import { assertCoordinates } from "../core/coordinates.ts";
import { NotFoundError } from "../core/errors.ts";
import { register } from "../core/registry.ts";
import { clampMaxResults } from "../core/types.ts";

const MAX_RESULTS = 40;

interface NominatimPlace {
  lat?: string;
  lon?: string;
  display_name?: string;
  category?: string;
  type?: string;
  /** [south, north, west, east] as decimal-degree strings */
  boundingbox?: string[];
  address?: { country_code?: string };
  /** Reverse lookups report failures in the body with HTTP 200 */
  error?: string;
}

function mapPlace(raw: NominatimPlace): GeoLocation {
  const box = raw.boundingbox?.map(Number);
  return {
    latitude: Number(raw.lat),
    longitude: Number(raw.lon),
    displayName: raw.display_name,
    category: raw.type ?? raw.category,
    countryCode: raw.address?.country_code,
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
      reverse: true,
    };
  }

  async geocode(query: string, options?: GeocodeOptions): Promise<GeoLocation[]> {
    assertQuery(query, "openstreetmap");
    const countryCodes = options?.countryCodes?.map((code) => code.toLowerCase()).join(",");
    const url = `${this.baseUrl}/search${buildQuery({
      q: query,
      format: "jsonv2",
      addressdetails: 1,
      limit: clampMaxResults(options?.limit, MAX_RESULTS),
      "accept-language": options?.language,
      countrycodes: countryCodes || undefined,
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
