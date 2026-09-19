/** Zod fragments shared by the MCP server and the AI SDK tools. */

import { z } from "zod";
import { GEOCODE_LAYERS } from "./types.ts";

/** Optional provider selector; empty-like strings are rejected before selection. */
export const providerInput = {
  provider: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe("Maps provider key, or 'all' to query every provider and compare"),
};

/** Free-form place or address query for forward geocoding. */
export const queryInput = z.string().trim().min(1).describe("Address or place to geocode");

/** Latitude in decimal degrees. */
export const latitudeInput = z
  .number()
  .min(-90)
  .max(90)
  .describe("Latitude in decimal degrees, -90 through 90");

/** Longitude in decimal degrees. */
export const longitudeInput = z
  .number()
  .min(-180)
  .max(180)
  .describe("Longitude in decimal degrees, -180 through 180");

/** Geocoding result bound; providers clamp to their own maximum. */
export const limitInput = z
  .number()
  .int()
  .positive()
  .max(40)
  .optional()
  .describe("Max results; providers cap this at 20-40 and silently truncate");

/** Opt-in provider record; the normalized fields already carry what a caller usually needs. */
export const rawInput = {
  raw: z
    .boolean()
    .optional()
    .describe(
      "Include the provider's own record of each result as raw, for fields the normalized shape leaves out, such as Nominatim's osm_id, name and importance or Google's place_id and location_type. Defaults to false.",
    ),
};

/** Preferred result language. */
export const languageInput = z
  .string()
  .trim()
  .min(1)
  .optional()
  .describe("Preferred language for result names (BCP 47, for example 'pl')");

/**
 * Structured address fields for component geocoding. Every field is optional; the provider
 * rejects an address whose every field is absent.
 */
export const addressInput = {
  houseNumber: z.string().trim().min(1).optional().describe("House or building number"),
  road: z.string().trim().min(1).optional().describe("Street name"),
  city: z.string().trim().min(1).optional().describe("City, town, or village name"),
  state: z.string().trim().min(1).optional().describe("State, province, or region name"),
  postcode: z.string().trim().min(1).optional().describe("Postal code"),
  country: z.string().trim().min(1).optional().describe("Country name or ISO code"),
};

/** Reverse-result granularity; omitted means the most detailed result available. */
export const granularityInput = z
  .enum(["country", "state", "city", "street", "building"])
  .optional()
  .describe("How coarse the reverse result should be; omit for the most detailed one");

/** One coordinate pair, reusable for distance endpoints. */
export const coordinatesInput = z.object({
  latitude: latitudeInput,
  longitude: longitudeInput,
});

/** Country filter for forward geocoding. */
export const countryCodesInput = z
  .array(z.string().trim().length(2))
  .optional()
  .describe("Restrict results to these ISO 3166-1 alpha-2 country codes");

/** Layer filter for forward geocoding; omitted or empty means every layer. */
export const layersInput = z
  .array(z.enum(GEOCODE_LAYERS))
  .optional()
  .describe(
    "Keep only these place layers: address (streets, house numbers, cities, boundaries), poi (named buildings, shops, stations), natural (rivers, lakes, mountains); use ['poi'] when a landmark query drowns in street names",
  );
