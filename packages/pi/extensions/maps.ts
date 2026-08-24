/** Pi extension: Maps - unified geocoding tools */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { AgentToolResult, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import type * as MapsModule from "../../../dist/index.d.mts";

const sourceModuleUrl = new URL("../../../src/index.ts", import.meta.url);
const distributionModuleUrl = new URL("../../../dist/index.mjs", import.meta.url);
let mapsModulePromise: Promise<typeof MapsModule> | undefined;

/** Load current source in development and fall back to the built package in distributions. */
function loadLibrary(): Promise<typeof MapsModule> {
  mapsModulePromise ??= import(
    existsSync(fileURLToPath(sourceModuleUrl)) ? sourceModuleUrl.href : distributionModuleUrl.href
  ) as Promise<typeof MapsModule>;

  return mapsModulePromise;
}

type MapsToolResult = AgentToolResult<undefined>;

function textResult(text: string): MapsToolResult {
  return {
    content: [{ type: "text", text }],
    details: undefined,
  };
}

export default function mapsExtension(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "maps_geocode",
    label: "Maps Geocode",
    description: "Resolve an address or place to geographic coordinates",
    promptSnippet: "Use maps_geocode to turn an address or place name into coordinates.",
    promptGuidelines: [
      "Use maps_geocode with a free-form address or place query; results come best match first.",
      "maps_geocode returns normalized coordinates, display name, category, and country per match.",
      "Pass provider 'all' to maps_geocode to compare results from every provider side by side.",
    ],
    parameters: Type.Object({
      query: Type.String({ description: "Address or place to geocode", minLength: 1 }),
      limit: Type.Optional(
        Type.Integer({
          description: "Maximum number of results; defaults to the provider maximum (20-40)",
          minimum: 1,
          maximum: 40,
        }),
      ),
      language: Type.Optional(
        Type.String({
          description: "Preferred language for result names (BCP 47, for example 'pl')",
          minLength: 1,
        }),
      ),
      countryCodes: Type.Optional(
        Type.Array(Type.String({ minLength: 2, maxLength: 2 }), {
          description: "Restrict results to these ISO 3166-1 alpha-2 country codes",
        }),
      ),
      provider: Type.Optional(
        Type.String({
          description:
            "Registered provider key, or 'all' to compare every provider; use maps_providers to list all providers",
          minLength: 1,
        }),
      ),
    }),
    async execute(_toolCallId, params): Promise<MapsToolResult> {
      const lib = await loadLibrary();
      const options = {
        limit: params.limit,
        language: params.language,
        countryCodes: params.countryCodes,
      };
      if (lib.isAllProviders(params.provider)) {
        const outcomes = await lib.geocodeAll(params.query, options);
        return textResult(lib.formatGeocodeAll(params.query, outcomes));
      }
      const { name, provider } = lib.selectProvider(params.provider);
      const geocode = lib.requireOperation(provider, "geocode");
      const locations = await geocode(params.query, options);
      return textResult(lib.formatLocations(name, params.query, locations));
    },
  });

  pi.registerTool({
    name: "maps_geocode_address",
    label: "Maps Geocode Address",
    description: "Resolve a structured postal address (street, city, postcode, ...) to coordinates",
    promptSnippet:
      "Use maps_geocode_address when you already have address parts instead of a free-form query.",
    promptGuidelines: [
      "Use maps_geocode_address with any subset of houseNumber, road, city, state, postcode, and country.",
      "maps_geocode_address needs at least one field; provider 'all' compares every provider.",
    ],
    parameters: Type.Object({
      houseNumber: Type.Optional(
        Type.String({ description: "House or building number", minLength: 1 }),
      ),
      road: Type.Optional(Type.String({ description: "Street name", minLength: 1 })),
      city: Type.Optional(
        Type.String({ description: "City, town, or village name", minLength: 1 }),
      ),
      state: Type.Optional(
        Type.String({ description: "State, province, or region name", minLength: 1 }),
      ),
      postcode: Type.Optional(Type.String({ description: "Postal code", minLength: 1 })),
      country: Type.Optional(
        Type.String({ description: "Country name or ISO code", minLength: 1 }),
      ),
      limit: Type.Optional(
        Type.Integer({
          description: "Maximum number of results; defaults to the provider maximum (20-40)",
          minimum: 1,
          maximum: 40,
        }),
      ),
      language: Type.Optional(
        Type.String({
          description: "Preferred language for result names (BCP 47, for example 'pl')",
          minLength: 1,
        }),
      ),
      provider: Type.Optional(
        Type.String({
          description: "Provider, or 'all' to compare every provider",
          minLength: 1,
        }),
      ),
    }),
    async execute(_toolCallId, params): Promise<MapsToolResult> {
      const lib = await loadLibrary();
      const address = {
        houseNumber: params.houseNumber,
        road: params.road,
        city: params.city,
        state: params.state,
        postcode: params.postcode,
        country: params.country,
      };
      const options = { limit: params.limit, language: params.language };
      const label = lib.formatAddressLabel(address);
      if (lib.isAllProviders(params.provider)) {
        const outcomes = await lib.geocodeAddressAll(address, options);
        return textResult(lib.formatGeocodeAll(label, outcomes));
      }
      const { name, provider } = lib.selectProvider(params.provider);
      const geocodeAddress = lib.requireOperation(provider, "geocodeAddress");
      const locations = await geocodeAddress(address, options);
      return textResult(lib.formatLocations(name, label, locations));
    },
  });

  pi.registerTool({
    name: "maps_reverse",
    label: "Maps Reverse",
    description: "Resolve a latitude/longitude pair to the place at or nearest to it",
    promptSnippet: "Use maps_reverse to check what lies at a pair of geographic coordinates.",
    promptGuidelines: [
      "Use maps_reverse with decimal-degree latitude and longitude to identify the place there.",
      "maps_reverse returns the normalized display name, category, and country of the place.",
    ],
    parameters: Type.Object({
      latitude: Type.Number({
        description: "Latitude in decimal degrees",
        minimum: -90,
        maximum: 90,
      }),
      longitude: Type.Number({
        description: "Longitude in decimal degrees",
        minimum: -180,
        maximum: 180,
      }),
      language: Type.Optional(
        Type.String({
          description: "Preferred language for result names (BCP 47, for example 'pl')",
          minLength: 1,
        }),
      ),
      granularity: Type.Optional(
        Type.Union(
          [
            Type.Literal("country"),
            Type.Literal("state"),
            Type.Literal("city"),
            Type.Literal("street"),
            Type.Literal("building"),
          ],
          { description: "How coarse the reverse result should be" },
        ),
      ),
      provider: Type.Optional(
        Type.String({
          description: "Provider, or 'all' to compare every provider",
          minLength: 1,
        }),
      ),
    }),
    async execute(_toolCallId, params): Promise<MapsToolResult> {
      const lib = await loadLibrary();
      const options = { language: params.language, granularity: params.granularity };
      if (lib.isAllProviders(params.provider)) {
        const outcomes = await lib.reverseAll(params.latitude, params.longitude, options);
        return textResult(lib.formatReverseAll(outcomes));
      }
      const { name, provider } = lib.selectProvider(params.provider);
      const reverse = lib.requireOperation(provider, "reverse");
      const location = await reverse(params.latitude, params.longitude, options);
      return textResult(lib.formatLocation(name, location));
    },
  });

  const pointSchema = (description: string) =>
    Type.Object(
      {
        latitude: Type.Number({
          description: "Latitude in decimal degrees",
          minimum: -90,
          maximum: 90,
        }),
        longitude: Type.Number({
          description: "Longitude in decimal degrees",
          minimum: -180,
          maximum: 180,
        }),
      },
      { description },
    );

  pi.registerTool({
    name: "maps_distance",
    label: "Maps Distance",
    description:
      "Great-circle distance and initial bearing between two coordinate pairs (haversine, computed locally)",
    promptSnippet: "Use maps_distance to measure how far apart two coordinate pairs are.",
    promptGuidelines: [
      "Use maps_distance with two latitude/longitude pairs; it computes locally without any network call.",
      "maps_distance returns the great-circle distance in meters and the initial bearing in degrees from north.",
    ],
    parameters: Type.Object({
      from: pointSchema("Start point"),
      to: pointSchema("End point"),
    }),
    async execute(_toolCallId, params): Promise<MapsToolResult> {
      const lib = await loadLibrary();
      const meters = lib.distanceBetween(params.from, params.to);
      const bearing = lib.bearingBetween(params.from, params.to);
      return textResult(lib.formatDistanceBearing(meters, bearing));
    },
  });

  pi.registerTool({
    name: "maps_providers",
    label: "Maps Providers",
    description: "List registered maps providers",
    promptSnippet: "Use maps_providers to check which geocoding providers are available.",
    promptGuidelines: [
      "Use maps_providers to list provider keys accepted by the other maps tools.",
    ],
    parameters: Type.Object({}),
    async execute(): Promise<MapsToolResult> {
      const lib = await loadLibrary();
      return textResult(lib.formatProviders(lib.listProviders()));
    },
  });
}
