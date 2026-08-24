/** Vercel AI SDK tool surface over the normalized geocoding operations. */

import { tool, type Tool } from "ai";
import { z } from "zod";
import type { GeoLocation } from "./core/types.ts";
import { requireOperation } from "./core/provider.ts";
import { providers } from "./core/registry.ts";
import { selectProvider } from "./core/resolve.ts";
import {
  countryCodesInput,
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
  ...providerInput,
});

export const geocodeTool: Tool<
  z.infer<typeof geocodeInputSchema>,
  { provider: string; locations: GeoLocation[] }
> = tool({
  description: "Resolve an address or place to geographic coordinates, best match first.",
  inputSchema: geocodeInputSchema,
  execute: async ({ query, limit, language, countryCodes, provider }) => {
    const selected = selectProvider(provider);
    const geocode = requireOperation(selected.provider, "geocode");
    return {
      provider: selected.name,
      locations: await geocode(query, { limit, language, countryCodes }),
    };
  },
});

export const reverseTool: Tool<
  z.infer<typeof reverseInputSchema>,
  { provider: string; location: GeoLocation }
> = tool({
  description: "Resolve a latitude/longitude pair to the place at or nearest to it.",
  inputSchema: reverseInputSchema,
  execute: async ({ latitude, longitude, language, provider }) => {
    const selected = selectProvider(provider);
    const reverse = requireOperation(selected.provider, "reverse");
    return {
      provider: selected.name,
      location: await reverse(latitude, longitude, { language }),
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
