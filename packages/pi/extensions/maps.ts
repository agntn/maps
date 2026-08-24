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
            "Registered provider key, for example openstreetmap or googlemaps; use maps_providers to list all providers",
          minLength: 1,
        }),
      ),
    }),
    async execute(_toolCallId, params): Promise<MapsToolResult> {
      const lib = await loadLibrary();
      const { name, provider } = lib.selectProvider(params.provider);
      const geocode = lib.requireOperation(provider, "geocode");
      const locations = await geocode(params.query, {
        limit: params.limit,
        language: params.language,
        countryCodes: params.countryCodes,
      });
      return textResult(lib.formatLocations(name, params.query, locations));
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
      provider: Type.Optional(Type.String({ description: "Provider", minLength: 1 })),
    }),
    async execute(_toolCallId, params): Promise<MapsToolResult> {
      const lib = await loadLibrary();
      const { name, provider } = lib.selectProvider(params.provider);
      const reverse = lib.requireOperation(provider, "reverse");
      const location = await reverse(params.latitude, params.longitude, {
        language: params.language,
      });
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
      "Great-circle distance in meters between two coordinate pairs (haversine, computed locally)",
    promptSnippet: "Use maps_distance to measure how far apart two coordinate pairs are.",
    promptGuidelines: [
      "Use maps_distance with two latitude/longitude pairs; it computes locally without any network call.",
      "maps_distance returns the great-circle distance in meters plus a human-readable form.",
    ],
    parameters: Type.Object({
      from: pointSchema("Start point"),
      to: pointSchema("End point"),
    }),
    async execute(_toolCallId, params): Promise<MapsToolResult> {
      const lib = await loadLibrary();
      const meters = lib.distanceBetween(params.from, params.to);
      return textResult(`Distance: ${lib.formatDistance(meters)}`);
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
