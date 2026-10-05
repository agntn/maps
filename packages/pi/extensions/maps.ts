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
      "Pass layers ['poi'] to maps_geocode when a landmark or building query returns streets named after it.",
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
      layers: Type.Optional(
        Type.Array(
          Type.Union([Type.Literal("address"), Type.Literal("poi"), Type.Literal("natural")]),
          {
            description:
              "Keep only these place layers: address (streets, house numbers, cities, boundaries), poi (named buildings, shops, stations), natural (rivers, lakes, mountains); use ['poi'] when a landmark query drowns in street names",
          },
        ),
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
        layers: params.layers,
      };
      if (lib.isAllProviders(params.provider)) {
        const outcomes = await lib.geocodeAll(params.query, options);
        return textResult(lib.formatGeocodeAll(params.query, outcomes));
      }
      if (params.provider?.trim()) {
        const { name, provider } = lib.selectProvider(params.provider);
        const geocode = lib.requireOperation(provider, "geocode");
        const locations = await geocode(params.query, options);
        return textResult(lib.formatLocations(name, params.query, locations));
      }
      const fallback = await lib.geocodeWithFallback(params.query, options);
      return textResult(lib.formatLocations(fallback.provider, params.query, fallback.result));
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
      if (params.provider?.trim()) {
        const { name, provider } = lib.selectProvider(params.provider);
        const geocodeAddress = lib.requireOperation(provider, "geocodeAddress");
        const locations = await geocodeAddress(address, options);
        return textResult(lib.formatLocations(name, label, locations));
      }
      const fallback = await lib.geocodeAddressWithFallback(address, options);
      return textResult(lib.formatLocations(fallback.provider, label, fallback.result));
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
      if (params.provider?.trim()) {
        const { name, provider } = lib.selectProvider(params.provider);
        const reverse = lib.requireOperation(provider, "reverse");
        const location = await reverse(params.latitude, params.longitude, options);
        return textResult(lib.formatLocation(name, location));
      }
      const fallback = await lib.reverseWithFallback(params.latitude, params.longitude, options);
      return textResult(lib.formatLocation(fallback.provider, fallback.result));
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

  const coordinateFormat = (description: string) =>
    Type.Union(
      [
        Type.Literal("decimal"),
        Type.Literal("dms"),
        Type.Literal("ddm"),
        Type.Literal("geohash"),
        Type.Literal("maidenhead"),
        Type.Literal("pluscode"),
        Type.Literal("utm"),
        Type.Literal("mgrs"),
        Type.Literal("what3words"),
      ],
      { description },
    );

  const precisionField = (minimum: number, maximum: number, description: string) =>
    Type.Optional(Type.Integer({ minimum, maximum, description }));

  const precisionChoice = (values: number[], description: string) =>
    Type.Optional(
      Type.Union(
        values.map((value) => Type.Literal(value)),
        { description },
      ),
    );

  const convertParameters = Type.Object({
    input: Type.String({
      description:
        "Coordinates in any supported format: decimal degrees (52.2297, 21.0122), DMS (52°13'46.9\"N 21°0'43.9\"E), DDM (N 52° 13.782 E 021° 00.732), geohash, Maidenhead locator, Plus Code, UTM (34U 500000 5786000), MGRS or a what3words address",
      minLength: 1,
    }),
    from: Type.Optional(
      coordinateFormat(
        "Format of input; detected when omitted. Needed when a lower case code like jn58td reads as both a geohash and a Maidenhead locator",
      ),
    ),
    to: Type.Optional(
      Type.Array(coordinateFormat("Output format"), {
        description:
          "Formats to write; omit for every local format, plus what3words when WHAT3WORDS_API_KEY is set",
      }),
    ),
    precision: Type.Optional(
      Type.Object(
        {
          decimal: precisionField(0, 10, "Decimal places, default 6"),
          dms: precisionField(0, 4, "Decimal places on seconds, default 1"),
          ddm: precisionField(0, 5, "Decimal places on minutes, default 3"),
          geohash: precisionField(1, 20, "Characters, default 9"),
          maidenhead: precisionChoice([2, 4, 6, 8, 10], "Characters: 2, 4, 6, 8 or 10, default 6"),
          pluscode: precisionChoice(
            [2, 4, 6, 8, 10, 11, 12, 13, 14, 15],
            "Digits: 2, 4, 6, 8 or 10 to 15, default 10",
          ),
          utm: precisionField(0, 3, "Decimal places on meters, default 0"),
          mgrs: precisionField(0, 5, "Digits per axis, 5 is one meter, default 5"),
        },
        {
          additionalProperties: false,
          description:
            "Output precision per format; grid inputs keep their own length unless set here",
        },
      ),
    ),
    reference: Type.Optional(
      pointSchema(
        "A point near the place a short Plus Code like 9G8F+6W belongs to; geocode the town written next to the code",
      ),
    ),
    language: Type.Optional(
      Type.String({
        description: "Language of the what3words output, for example 'pl'",
        minLength: 1,
      }),
    ),
  });

  pi.registerTool({
    name: "maps_convert",
    label: "Maps Convert",
    description:
      "Convert a location between coordinate formats: decimal degrees, DMS, DDM, geohash, Maidenhead locator, Plus Code, UTM, MGRS and what3words. Computed locally except what3words, which needs WHAT3WORDS_API_KEY.",
    promptSnippet:
      "Use maps_convert to turn DMS, DDM, geohash, Maidenhead, Plus Codes, UTM, MGRS or what3words into decimal degrees and back.",
    promptGuidelines: [
      "Use maps_convert before maps_reverse or maps_distance when a location comes as a grid code or in degrees and minutes; it detects the format itself.",
      "maps_convert returns the cell bounds for geohashes, locators, Plus Codes and MGRS, because a short code names an area, not a point.",
      "For a short Plus Code like 9G8F+6W Warszawa, geocode the town with maps_geocode and pass it to maps_convert as reference.",
    ],
    parameters: convertParameters,
    async execute(_toolCallId, params): Promise<MapsToolResult> {
      const lib = await loadLibrary();
      const conversion = await lib.convertCoordinates(params.input, {
        from: params.from,
        to: params.to,
        precision: params.precision,
        reference: params.reference,
        language: params.language,
      });
      return textResult(lib.formatConversion(conversion));
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
