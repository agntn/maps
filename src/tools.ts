/** The maps tools, declared once for every host. Executors load on the first call. */

import {
  defineTool,
  Type,
  type TObject,
  type TOptional,
  type TString,
  type ToolDefinition,
} from "@agntn/tools";
import { COORDINATE_FORMATS, GEOCODE_LAYERS, REVERSE_GRANULARITIES } from "./core/types.ts";

type ToolOperations = typeof import("./tool-operations.ts");

let operations: Promise<ToolOperations> | undefined;

/** Loads the executors once. A failed load isn't cached, so a broken `dist` doesn't stick. */
export function loadOperations(): Promise<ToolOperations> {
  operations ??= import("./tool-operations.ts").catch((error: unknown) => {
    operations = undefined;
    throw error;
  });
  return operations;
}

/** Text that has to say something: blank or spaces only fail the schema, the executor trims. */
const FILLED = "\\S";

function text(description: string): TString {
  return Type.String({ pattern: FILLED, description });
}

function optionalText(description: string): TOptional<TString> {
  return Type.Optional(text(description));
}

const latitude = Type.Number({
  minimum: -90,
  maximum: 90,
  description: "Latitude in decimal degrees, -90 through 90",
});

const longitude = Type.Number({
  minimum: -180,
  maximum: 180,
  description: "Longitude in decimal degrees, -180 through 180",
});

function point(
  description: string,
): TObject<{ latitude: typeof latitude; longitude: typeof longitude }> {
  return Type.Object({ latitude, longitude }, { additionalProperties: false, description });
}

const provider = optionalText(
  "Maps provider key, or 'all' to query every provider and compare; maps_providers lists the keys",
);

const language = optionalText("Preferred language for result names (BCP 47, for example 'pl')");

const limit = Type.Optional(
  Type.Integer({
    minimum: 1,
    maximum: 40,
    description: "Max results, 1 to 40; providers cap this at 20-40 and silently truncate",
  }),
);

const raw = Type.Optional(
  Type.Boolean({
    description:
      "Include the provider's own record of each result as raw, for fields the normalized shape leaves out, such as Nominatim's osm_id, name and importance or Google's place_id and location_type. Defaults to false.",
  }),
);

export const providersSchema = Type.Object({});

export const providersTool = defineTool({
  name: "maps_providers",
  title: "List Providers",
  description: "List registered maps providers, their capabilities and endpoints",
  snippet: "Use maps_providers to check which geocoding providers are available.",
  guidelines: ["Use maps_providers to list provider keys accepted by the other maps tools."],
  effect: "read",
  input: providersSchema,
  cli: { description: "List registered maps providers and capabilities" },
  execute: async () => (await loadOperations()).providers(),
});

export const geocodeSchema = Type.Object(
  {
    query: text("Address or place to geocode"),
    limit,
    language,
    countryCodes: Type.Optional(
      Type.Array(Type.String({ pattern: "^\\s*[A-Za-z]{2}\\s*$" }), {
        description: "Restrict results to these ISO 3166-1 alpha-2 country codes",
      }),
    ),
    layers: Type.Optional(
      Type.Array(Type.String({ enum: [...GEOCODE_LAYERS] }), {
        description:
          "Keep only these place layers: address (streets, house numbers, cities, boundaries), poi (named buildings, shops, stations), natural (rivers, lakes, mountains); use ['poi'] when a landmark query drowns in street names",
      }),
    ),
    provider,
    raw,
  },
  { additionalProperties: false },
);

export const geocodeTool = defineTool({
  name: "maps_geocode",
  title: "Geocode a Place",
  description:
    "Resolve an address or place to normalized geographic coordinates, best match first: display name, category, country, address parts and bounds per match",
  snippet: "Use maps_geocode to turn an address or place name into coordinates.",
  guidelines: [
    "Use maps_geocode with a free-form address or place query; results come best match first.",
    "maps_geocode returns normalized coordinates, display name, category, and country per match.",
    "Pass provider 'all' to maps_geocode to compare results from every provider side by side.",
    "Pass layers ['poi'] to maps_geocode when a landmark or building query returns streets named after it.",
  ],
  effect: "read",
  input: geocodeSchema,
  cli: {
    description: "Resolve an address or place to geographic coordinates",
    positional: ["query"],
  },
  execute: async (params) => (await loadOperations()).geocode(params),
});

export const geocodeAddressSchema = Type.Object(
  {
    houseNumber: optionalText("House or building number"),
    road: optionalText("Street name"),
    city: optionalText("City, town, or village name"),
    state: optionalText("State, province, or region name"),
    postcode: optionalText("Postal code"),
    country: optionalText("Country name or ISO code"),
    limit,
    language,
    provider,
    raw,
  },
  { additionalProperties: false },
);

export const geocodeAddressTool = defineTool({
  name: "maps_address_geocode",
  title: "Geocode an Address",
  description:
    "Resolve a structured postal address (street, city, postcode, ...) to normalized coordinates. Needs at least one field",
  snippet:
    "Use maps_address_geocode when you already have address parts instead of a free-form query.",
  guidelines: [
    "Use maps_address_geocode with any subset of houseNumber, road, city, state, postcode, and country.",
    "maps_address_geocode needs at least one field; provider 'all' compares every provider.",
  ],
  effect: "read",
  input: geocodeAddressSchema,
  cli: {
    command: "address",
    description: "Resolve a structured postal address (street, city, postcode, ...) to coordinates",
  },
  execute: async (params) => (await loadOperations()).geocodeAddress(params),
});

export const reverseSchema = Type.Object(
  {
    latitude,
    longitude,
    language,
    granularity: Type.Optional(
      Type.String({
        enum: [...REVERSE_GRANULARITIES],
        description: "How coarse the reverse result should be; omit for the most detailed one",
      }),
    ),
    provider,
    raw,
  },
  { additionalProperties: false },
);

export const reverseTool = defineTool({
  name: "maps_reverse",
  title: "Reverse Geocode",
  description:
    "Resolve a latitude/longitude pair to the place at or nearest to it: display name, category, country, address parts and bounds",
  snippet: "Use maps_reverse to check what lies at a pair of geographic coordinates.",
  guidelines: [
    "Use maps_reverse with decimal-degree latitude and longitude to identify the place there.",
    "maps_reverse returns the normalized display name, category, and country of the place.",
  ],
  effect: "read",
  input: reverseSchema,
  execute: async (params) => (await loadOperations()).reverse(params),
});

export const distanceSchema = Type.Object(
  { from: point("Start point"), to: point("End point") },
  { additionalProperties: false },
);

export const distanceTool = defineTool({
  name: "maps_distance",
  title: "Measure Distance",
  description:
    "Great-circle distance in meters and initial bearing between two coordinate pairs (haversine, computed locally)",
  snippet: "Use maps_distance to measure how far apart two coordinate pairs are.",
  guidelines: [
    "Use maps_distance with two latitude/longitude pairs; it computes locally without any network call.",
    "maps_distance returns the great-circle distance in meters and the initial bearing in degrees from north.",
  ],
  effect: "read",
  input: distanceSchema,
  execute: async (params) => (await loadOperations()).distance(params),
});

const format = Type.String({ enum: [...COORDINATE_FORMATS] });

function digits(minimum: number, maximum: number, description: string) {
  return Type.Optional(Type.Integer({ minimum, maximum, description }));
}

export const convertSchema = Type.Object(
  {
    input: text(
      "Coordinates in any supported format: decimal degrees (52.2297, 21.0122), DMS (52°13'46.9\"N 21°0'43.9\"E), DDM (N 52° 13.782 E 021° 00.732), geohash, Maidenhead locator, Plus Code, UTM (34U 500000 5786000), MGRS or a what3words address",
    ),
    from: Type.Optional(
      Type.String({
        enum: [...COORDINATE_FORMATS],
        description:
          "Format of input; detected when omitted. Needed when a lower case code like jn58td reads as both a geohash and a Maidenhead locator",
      }),
    ),
    to: Type.Optional(
      Type.Array(format, {
        description:
          "Formats to write; omit for every local format, plus what3words when WHAT3WORDS_API_KEY is set. A format that cannot hold the point (UTM past 84°N) fails when asked for and is skipped otherwise",
      }),
    ),
    precision: Type.Optional(
      Type.Object(
        {
          decimal: digits(0, 10, "Decimal places, default 6"),
          dms: digits(0, 4, "Decimal places on seconds, default 1"),
          ddm: digits(0, 5, "Decimal places on minutes, default 3"),
          geohash: digits(1, 20, "Characters, default 9"),
          maidenhead: Type.Optional(
            Type.Integer({
              enum: [2, 4, 6, 8, 10],
              description: "Characters: 2, 4, 6, 8 or 10, default 6",
            }),
          ),
          pluscode: Type.Optional(
            Type.Integer({
              enum: [2, 4, 6, 8, 10, 11, 12, 13, 14, 15],
              description: "Digits: 2, 4, 6, 8 or 10 to 15, default 10",
            }),
          ),
          utm: digits(0, 3, "Decimal places on meters, default 0"),
          mgrs: digits(0, 5, "Digits per axis, 5 is one meter, default 5"),
        },
        {
          additionalProperties: false,
          description:
            "Output precision per format; grid inputs keep their own length unless set here",
        },
      ),
    ),
    reference: Type.Optional(
      point(
        "A point near the place a short Plus Code like 9G8F+6W belongs to; geocode the town written next to the code",
      ),
    ),
    language: optionalText("Language of the what3words output, for example 'pl'"),
  },
  { additionalProperties: false },
);

export const convertTool = defineTool({
  name: "maps_convert",
  title: "Convert Coordinates",
  description:
    "Convert a location between coordinate formats: decimal degrees, DMS, DDM, geohash, Maidenhead locator, Plus Code, UTM, MGRS and what3words. Detects the input format, returns the center and, for grid codes, the cell bounds. Computed locally except what3words, which needs WHAT3WORDS_API_KEY",
  snippet:
    "Use maps_convert to turn DMS, DDM, geohash, Maidenhead, Plus Codes, UTM, MGRS or what3words into decimal degrees and back.",
  guidelines: [
    "Use maps_convert before maps_reverse or maps_distance when a location comes as a grid code or in degrees and minutes; it detects the format itself.",
    "maps_convert returns the cell bounds for geohashes, locators, Plus Codes and MGRS, because a short code names an area, not a point.",
    "For a short Plus Code like 9G8F+6W Warszawa, geocode the town with maps_geocode and pass it to maps_convert as reference.",
  ],
  effect: "read",
  input: convertSchema,
  cli: {
    description:
      "Convert coordinates between decimal degrees, DMS, DDM, geohash, Maidenhead, Plus Code, UTM, MGRS and what3words",
    positional: ["input"],
  },
  execute: async (params) => (await loadOperations()).convert(params),
});

/** Every maps tool, in the order hosts list them. */
export const mapsTools: readonly ToolDefinition[] = [
  providersTool,
  geocodeTool,
  geocodeAddressTool,
  reverseTool,
  distanceTool,
  convertTool,
];
