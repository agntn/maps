/** Zod fragments shared by the MCP server and the AI SDK tools. */

import { z } from "zod";

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

/** Preferred result language. */
export const languageInput = z
  .string()
  .trim()
  .min(1)
  .optional()
  .describe("Preferred language for result names (BCP 47, for example 'pl')");

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
