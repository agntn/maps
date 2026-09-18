import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
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
import { listProviders } from "./core/registry.ts";
import { isAllProviders, selectProvider } from "./core/resolve.ts";
import {
  addressInput,
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
import { version } from "./version.ts";
import "./providers/index.ts";

function result(value: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
  };
}

function providerResult(provider: string, value: unknown): CallToolResult {
  return result({ provider, data: value });
}

/** Create an MCP server exposing the normalized geocoding operations. */
export function createMcpServer(): McpServer {
  const server = new McpServer({ name: "maps", version });

  server.registerTool(
    "maps_providers",
    {
      description: "List registered maps providers and their capabilities",
      annotations: { readOnlyHint: true },
    },
    () => result(listProviders()),
  );

  server.registerTool(
    "maps_geocode",
    {
      description: "Resolve an address or place to normalized geographic coordinates",
      inputSchema: {
        query: queryInput,
        limit: limitInput,
        language: languageInput,
        countryCodes: countryCodesInput,
        layers: layersInput,
        ...providerInput,
        ...rawInput,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ query, limit, language, countryCodes, layers, provider, raw }) => {
      const options = { limit, language, countryCodes, layers };
      if (isAllProviders(provider)) {
        const outcomes = await geocodeAll(query, options);
        return result(serializeOutcomes(outcomes, (locations) => trimLocations(locations, raw)));
      }
      if (provider?.trim()) {
        const selected = selectProvider(provider);
        const geocode = requireOperation(selected.provider, "geocode");
        return providerResult(selected.name, trimLocations(await geocode(query, options), raw));
      }
      const fallback = await geocodeWithFallback(query, options);
      return providerResult(fallback.provider, trimLocations(fallback.result, raw));
    },
  );

  server.registerTool(
    "maps_geocode_address",
    {
      description:
        "Resolve a structured postal address (street, city, postcode, ...) to normalized coordinates",
      inputSchema: {
        ...addressInput,
        limit: limitInput,
        language: languageInput,
        ...providerInput,
        ...rawInput,
      },
      annotations: { readOnlyHint: true },
    },
    async ({
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
        return result(serializeOutcomes(outcomes, (locations) => trimLocations(locations, raw)));
      }
      if (provider?.trim()) {
        const selected = selectProvider(provider);
        const geocodeAddress = requireOperation(selected.provider, "geocodeAddress");
        const locations = await geocodeAddress(address, options);
        return providerResult(selected.name, trimLocations(locations, raw));
      }
      const fallback = await geocodeAddressWithFallback(address, options);
      return providerResult(fallback.provider, trimLocations(fallback.result, raw));
    },
  );

  server.registerTool(
    "maps_reverse",
    {
      description: "Resolve a latitude/longitude pair to the place at or nearest to it",
      inputSchema: {
        latitude: latitudeInput,
        longitude: longitudeInput,
        language: languageInput,
        granularity: granularityInput,
        ...providerInput,
        ...rawInput,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ latitude, longitude, language, granularity, provider, raw }) => {
      const options = { language, granularity };
      if (isAllProviders(provider)) {
        const outcomes = await reverseAll(latitude, longitude, options);
        return result(serializeOutcomes(outcomes, (location) => trimLocation(location, raw)));
      }
      if (provider?.trim()) {
        const selected = selectProvider(provider);
        const reverse = requireOperation(selected.provider, "reverse");
        const location = await reverse(latitude, longitude, options);
        return providerResult(selected.name, trimLocation(location, raw));
      }
      const fallback = await reverseWithFallback(latitude, longitude, options);
      return providerResult(fallback.provider, trimLocation(fallback.result, raw));
    },
  );

  server.registerTool(
    "maps_distance",
    {
      description:
        "Great-circle distance in meters and initial bearing between two coordinate pairs (haversine, computed locally)",
      inputSchema: {
        from: coordinatesInput.describe("Start point"),
        to: coordinatesInput.describe("End point"),
      },
      annotations: { readOnlyHint: true },
    },
    ({ from, to }) => {
      const meters = distanceBetween(from, to);
      const bearing = Math.round(bearingBetween(from, to) * 10) / 10;
      return result({ meters, formatted: formatDistance(meters), bearing });
    },
  );

  return server;
}
