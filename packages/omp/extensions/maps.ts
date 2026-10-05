/** OMP extension: Maps - unified geocoding tools. */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";

import type { AgentToolResult, ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { Text } from "@oh-my-pi/pi-coding-agent";
import { renderStatusLine } from "@oh-my-pi/pi-coding-agent/tui";

import type * as MapsModule from "../../../dist/index.d.mts";

const sourceModulePath = fileURLToPath(new URL("../../../src/index.ts", import.meta.url));
let mapsModulePromise: Promise<typeof MapsModule> | undefined;

/**
 * Load current source in development and fall back to the built package in distributions.
 *
 * Both specifiers stay literal: OMP rewrites bare dependencies only for imports
 * it can see statically. existsSync chooses the branch; it does not build a URL
 * for a single import().
 */
function loadLibrary(): Promise<typeof MapsModule> {
  mapsModulePromise ??= existsSync(sourceModulePath)
    ? (import("../../../src/index.ts") as unknown as Promise<typeof MapsModule>)
    : (import("../../../dist/index.mjs") as Promise<typeof MapsModule>);

  return mapsModulePromise;
}

/**
 * Renderer interpolations cross the terminal trust boundary: model arguments and external values
 * may carry ANSI/OSC escape sequences or raw C0/C1 control bytes that OMP's Text component passes
 * through to the terminal unchanged. String() first, because hostile JSON is not bound by the
 * declared parameter types.
 */
// oxlint-disable-next-line no-control-regex -- Terminal control bytes are precisely what this boundary removes.
const CONTROL_BYTES = /[\u0000-\u001F\u007F-\u009F]/g;
// oxlint-disable-next-line no-control-regex -- Same boundary, with newlines kept for block output.
const CONTROL_BYTES_KEEP_NEWLINE = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/g;
const SPACE_RUNS = / +/g;

export function sanitizeTerminalText(value: unknown): string {
  return stripVTControlCharacters(String(value))
    .replace(CONTROL_BYTES, " ")
    .replace(SPACE_RUNS, " ")
    .trim();
}

/** Sanitize a multi-line tool output while keeping its line and indent structure. */
function sanitizeTerminalBlock(text: string): string {
  return stripVTControlCharacters(text).replace(CONTROL_BYTES_KEEP_NEWLINE, " ");
}

type MapsToolResult = AgentToolResult<undefined>;

function textResult(text: string): MapsToolResult {
  return {
    content: [{ type: "text", text: sanitizeTerminalBlock(text) }],
    details: undefined,
  };
}

/**
 * Register Maps tools with the OMP extension host.
 *
 * OMP validates tool parameters with its own TypeBox build, so schemas must come from the
 * host-injected facade rather than a standalone typebox import.
 */
export default function mapsExtension(pi: ExtensionAPI): void {
  const { Type } = pi.typebox;
  pi.setLabel("Maps");

  type RenderCallOptions = { isPartial?: boolean; spinnerFrame?: number };
  type RenderTheme = Parameters<typeof renderStatusLine>[1];

  function statusLine(
    title: string,
    description: string,
    options: RenderCallOptions,
    theme: RenderTheme,
  ): Text {
    const icon = options.isPartial
      ? options.spinnerFrame === undefined
        ? "pending"
        : "running"
      : "done";

    return new Text(
      renderStatusLine(
        {
          icon,
          spinnerFrame: options.spinnerFrame,
          title,
          description: sanitizeTerminalText(description),
        },
        theme,
      ),
      0,
      0,
    );
  }

  const geocodeParameters = Type.Object({
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
  });

  pi.registerTool({
    name: "maps_geocode",
    label: "Maps Geocode",
    description:
      "Resolve an address or place to geographic coordinates. Returns normalized coordinates, display name, category, and country per match, best match first; pass layers ['poi'] when a landmark query returns streets named after it.",
    parameters: geocodeParameters,
    approval: "read",
    renderCall(args, options, theme) {
      return statusLine("Maps Geocode", String(args.query), options, theme);
    },
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

  const geocodeAddressParameters = Type.Object({
    houseNumber: Type.Optional(
      Type.String({ description: "House or building number", minLength: 1 }),
    ),
    road: Type.Optional(Type.String({ description: "Street name", minLength: 1 })),
    city: Type.Optional(Type.String({ description: "City, town, or village name", minLength: 1 })),
    state: Type.Optional(
      Type.String({ description: "State, province, or region name", minLength: 1 }),
    ),
    postcode: Type.Optional(Type.String({ description: "Postal code", minLength: 1 })),
    country: Type.Optional(Type.String({ description: "Country name or ISO code", minLength: 1 })),
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
  });

  pi.registerTool({
    name: "maps_geocode_address",
    label: "Maps Geocode Address",
    description:
      "Resolve a structured postal address (street, city, postcode, ...) to coordinates. Needs at least one field.",
    parameters: geocodeAddressParameters,
    approval: "read",
    renderCall(args, options, theme) {
      const label = [args.houseNumber, args.road, args.city, args.postcode, args.country]
        .filter(Boolean)
        .join(", ");
      return statusLine("Maps Geocode Address", label || "empty address", options, theme);
    },
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

  const reverseParameters = Type.Object({
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
  });

  pi.registerTool({
    name: "maps_reverse",
    label: "Maps Reverse",
    description:
      "Resolve a latitude/longitude pair to the place at or nearest to it. Returns the normalized display name, category, and country.",
    parameters: reverseParameters,
    approval: "read",
    renderCall(args, options, theme) {
      return statusLine("Maps Reverse", `${args.latitude}, ${args.longitude}`, options, theme);
    },
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

  const distanceParameters = Type.Object({
    from: pointSchema("Start point"),
    to: pointSchema("End point"),
  });

  pi.registerTool({
    name: "maps_distance",
    label: "Maps Distance",
    description:
      "Great-circle distance and initial bearing between two coordinate pairs (haversine, computed locally).",
    parameters: distanceParameters,
    approval: "read",
    renderCall(args, options, theme) {
      const from = args.from as { latitude: number; longitude: number };
      const to = args.to as { latitude: number; longitude: number };
      return statusLine(
        "Maps Distance",
        `${from.latitude},${from.longitude} to ${to.latitude},${to.longitude}`,
        options,
        theme,
      );
    },
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
          geohash: precisionField(1, 22, "Characters, default 9"),
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
    parameters: convertParameters,
    approval: "read",
    renderCall(args, options, theme) {
      return statusLine("Maps Convert", String(args.input ?? "").slice(0, 80), options, theme);
    },
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

  const providersParameters = Type.Object({});

  pi.registerTool({
    name: "maps_providers",
    label: "Maps Providers",
    description: "List registered maps provider keys accepted by the other maps tools.",
    parameters: providersParameters,
    approval: "read",
    renderCall(_args, options, theme) {
      return statusLine("Maps Providers", "list", options, theme);
    },
    async execute(): Promise<MapsToolResult> {
      const lib = await loadLibrary();
      return textResult(lib.formatProviders(lib.listProviders()));
    },
  });
}
