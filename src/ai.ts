/** Vercel AI SDK tool surface over the normalized geocoding operations. */

import { tool, type Tool } from "ai";
import { z } from "zod";
import type { GeoLocation } from "./core/types.ts";
import type { SerializedOutcome } from "./core/all.ts";
import {
  geocodeAddressAll,
  geocodeAddressWithFallback,
  geocodeAll,
  geocodeWithFallback,
  reverseAll,
  reverseWithFallback,
  serializeOutcomes,
} from "./core/all.ts";
import { convertCoordinates, type CoordinateConversion } from "./core/convert.ts";
import { bearingBetween, distanceBetween } from "./core/coordinates.ts";
import { formatDistance } from "./core/format.ts";
import { requireOperation } from "./core/provider.ts";
import { providers } from "./core/registry.ts";
import { isAllProviders, selectProvider } from "./core/resolve.ts";
import {
  addressInput,
  convertInput,
  coordinatesInput,
  countryCodesInput,
  granularityInput,
  languageInput,
  latitudeInput,
  layersInput,
  limitInput,
  longitudeInput,
  providerInput,
  queryInput,
  rawInput,
} from "./core/schemas.ts";
import { trimLocation, trimLocations } from "./core/types.ts";
import "./providers/index.ts";

const geocodeInputSchema = z.object({
  query: queryInput,
  limit: limitInput,
  language: languageInput,
  countryCodes: countryCodesInput,
  layers: layersInput,
  ...providerInput,
  ...rawInput,
});

const reverseInputSchema = z.object({
  latitude: latitudeInput,
  longitude: longitudeInput,
  language: languageInput,
  granularity: granularityInput,
  ...providerInput,
  ...rawInput,
});

type GeocodeToolOutput =
  | { provider: string; locations: GeoLocation[] }
  | { comparison: SerializedOutcome<GeoLocation[]>[] };

export const geocodeTool: Tool<z.infer<typeof geocodeInputSchema>, GeocodeToolOutput> = tool({
  description:
    "Resolve an address or place to geographic coordinates, best match first. Pass provider 'all' to compare every provider.",
  inputSchema: geocodeInputSchema,
  execute: async ({ query, limit, language, countryCodes, layers, provider, raw }) => {
    const options = { limit, language, countryCodes, layers };
    if (isAllProviders(provider)) {
      const outcomes = await geocodeAll(query, options);
      return {
        comparison: serializeOutcomes(outcomes, (locations) => trimLocations(locations, raw)),
      };
    }
    if (provider?.trim()) {
      const selected = selectProvider(provider);
      const geocode = requireOperation(selected.provider, "geocode");
      const locations = trimLocations(await geocode(query, options), raw);
      return { provider: selected.name, locations };
    }
    const fallback = await geocodeWithFallback(query, options);
    return { provider: fallback.provider, locations: trimLocations(fallback.result, raw) };
  },
});

const geocodeAddressInputSchema = z.object({
  ...addressInput,
  limit: limitInput,
  language: languageInput,
  ...providerInput,
  ...rawInput,
});

export const geocodeAddressTool: Tool<
  z.infer<typeof geocodeAddressInputSchema>,
  GeocodeToolOutput
> = tool({
  description:
    "Resolve a structured postal address (street, city, postcode, ...) to coordinates. Pass provider 'all' to compare every provider.",
  inputSchema: geocodeAddressInputSchema,
  execute: async ({
    houseNumber,
    road,
    city,
    state,
    postcode,
    country,
    limit,
    language,
    provider,
    raw,
  }) => {
    const address = { houseNumber, road, city, state, postcode, country };
    const options = { limit, language };
    if (isAllProviders(provider)) {
      const outcomes = await geocodeAddressAll(address, options);
      return {
        comparison: serializeOutcomes(outcomes, (locations) => trimLocations(locations, raw)),
      };
    }
    if (provider?.trim()) {
      const selected = selectProvider(provider);
      const geocodeAddress = requireOperation(selected.provider, "geocodeAddress");
      const locations = trimLocations(await geocodeAddress(address, options), raw);
      return { provider: selected.name, locations };
    }
    const fallback = await geocodeAddressWithFallback(address, options);
    return { provider: fallback.provider, locations: trimLocations(fallback.result, raw) };
  },
});

type ReverseToolOutput =
  | { provider: string; location: GeoLocation }
  | { comparison: SerializedOutcome<GeoLocation>[] };

export const reverseTool: Tool<z.infer<typeof reverseInputSchema>, ReverseToolOutput> = tool({
  description:
    "Resolve a latitude/longitude pair to the place at or nearest to it. Pass provider 'all' to compare every provider.",
  inputSchema: reverseInputSchema,
  execute: async ({ latitude, longitude, language, granularity, provider, raw }) => {
    const options = { language, granularity };
    if (isAllProviders(provider)) {
      const outcomes = await reverseAll(latitude, longitude, options);
      return { comparison: serializeOutcomes(outcomes, (location) => trimLocation(location, raw)) };
    }
    if (provider?.trim()) {
      const selected = selectProvider(provider);
      const reverse = requireOperation(selected.provider, "reverse");
      const location = trimLocation(await reverse(latitude, longitude, options), raw);
      return { provider: selected.name, location };
    }
    const fallback = await reverseWithFallback(latitude, longitude, options);
    return { provider: fallback.provider, location: trimLocation(fallback.result, raw) };
  },
});

const distanceInputSchema = z.object({
  from: coordinatesInput.describe("Start point"),
  to: coordinatesInput.describe("End point"),
});

export const distanceTool: Tool<
  z.infer<typeof distanceInputSchema>,
  { meters: number; formatted: string; bearing: number }
> = tool({
  description:
    "Great-circle distance in meters and initial bearing between two coordinate pairs (haversine, computed locally).",
  inputSchema: distanceInputSchema,
  execute: async ({ from, to }) => {
    const meters = distanceBetween(from, to);
    return {
      meters,
      formatted: formatDistance(meters),
      bearing: Math.round(bearingBetween(from, to) * 10) / 10,
    };
  },
});

const convertInputSchema = z.object(convertInput);

export const convertTool: Tool<z.infer<typeof convertInputSchema>, CoordinateConversion> = tool({
  description:
    "Convert a location between coordinate formats: decimal degrees, DMS, DDM, geohash, Maidenhead locator, Plus Code, UTM, MGRS and what3words. Detects the input format and returns the center, cell bounds for grid codes, and every requested format. Local except what3words, which needs WHAT3WORDS_API_KEY.",
  inputSchema: convertInputSchema,
  execute: async ({ input, from, to, precision, reference, language }) =>
    convertCoordinates(input, { from, to, precision, reference, language }),
});

export const providersTool: Tool<Record<string, never>, { providers: string[] }> = tool({
  description: "List registered maps provider keys accepted by the other maps tools.",
  inputSchema: z.object({}),
  execute: async () => {
    return { providers: providers() };
  },
});
