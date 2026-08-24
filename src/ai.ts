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
import { bearingBetween, distanceBetween } from "./core/coordinates.ts";
import { formatDistance } from "./core/format.ts";
import { requireOperation } from "./core/provider.ts";
import { providers } from "./core/registry.ts";
import { isAllProviders, selectProvider } from "./core/resolve.ts";
import {
  addressInput,
  coordinatesInput,
  countryCodesInput,
  granularityInput,
  languageInput,
  latitudeInput,
  limitInput,
  longitudeInput,
  providerInput,
  queryInput,
} from "./core/schemas.ts";
import "./providers/index.ts";

const geocodeInputSchema = z.object({
  query: queryInput,
  limit: limitInput,
  language: languageInput,
  countryCodes: countryCodesInput,
  ...providerInput,
});

const reverseInputSchema = z.object({
  latitude: latitudeInput,
  longitude: longitudeInput,
  language: languageInput,
  granularity: granularityInput,
  ...providerInput,
});

type GeocodeToolOutput =
  | { provider: string; locations: GeoLocation[] }
  | { comparison: SerializedOutcome<GeoLocation[]>[] };

export const geocodeTool: Tool<z.infer<typeof geocodeInputSchema>, GeocodeToolOutput> = tool({
  description:
    "Resolve an address or place to geographic coordinates, best match first. Pass provider 'all' to compare every provider.",
  inputSchema: geocodeInputSchema,
  execute: async ({ query, limit, language, countryCodes, provider }) => {
    const options = { limit, language, countryCodes };
    if (isAllProviders(provider)) {
      return { comparison: serializeOutcomes(await geocodeAll(query, options)) };
    }
    if (provider?.trim()) {
      const selected = selectProvider(provider);
      const geocode = requireOperation(selected.provider, "geocode");
      return { provider: selected.name, locations: await geocode(query, options) };
    }
    const fallback = await geocodeWithFallback(query, options);
    return { provider: fallback.provider, locations: fallback.result };
  },
});

const geocodeAddressInputSchema = z.object({
  ...addressInput,
  limit: limitInput,
  language: languageInput,
  ...providerInput,
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
  }) => {
    const address = { houseNumber, road, city, state, postcode, country };
    const options = { limit, language };
    if (isAllProviders(provider)) {
      return { comparison: serializeOutcomes(await geocodeAddressAll(address, options)) };
    }
    if (provider?.trim()) {
      const selected = selectProvider(provider);
      const geocodeAddress = requireOperation(selected.provider, "geocodeAddress");
      return { provider: selected.name, locations: await geocodeAddress(address, options) };
    }
    const fallback = await geocodeAddressWithFallback(address, options);
    return { provider: fallback.provider, locations: fallback.result };
  },
});

type ReverseToolOutput =
  | { provider: string; location: GeoLocation }
  | { comparison: SerializedOutcome<GeoLocation>[] };

export const reverseTool: Tool<z.infer<typeof reverseInputSchema>, ReverseToolOutput> = tool({
  description:
    "Resolve a latitude/longitude pair to the place at or nearest to it. Pass provider 'all' to compare every provider.",
  inputSchema: reverseInputSchema,
  execute: async ({ latitude, longitude, language, granularity, provider }) => {
    const options = { language, granularity };
    if (isAllProviders(provider)) {
      return { comparison: serializeOutcomes(await reverseAll(latitude, longitude, options)) };
    }
    if (provider?.trim()) {
      const selected = selectProvider(provider);
      const reverse = requireOperation(selected.provider, "reverse");
      return { provider: selected.name, location: await reverse(latitude, longitude, options) };
    }
    const fallback = await reverseWithFallback(latitude, longitude, options);
    return { provider: fallback.provider, location: fallback.result };
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

export const providersTool: Tool<Record<string, never>, { providers: string[] }> = tool({
  description: "List registered maps provider keys accepted by the other maps tools.",
  inputSchema: z.object({}),
  execute: async () => {
    return { providers: providers() };
  },
});
