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
        description: "Maximum number of results",
        minimum: 1,
        maximum: 40,
        default: 10,
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
  });

  pi.registerTool({
    name: "maps_geocode",
    label: "Maps Geocode",
    description:
      "Resolve an address or place to geographic coordinates. Returns normalized coordinates, display name, category, and country per match, best match first.",
    parameters: geocodeParameters,
    approval: "read",
    renderCall(args, options, theme) {
      return statusLine("Maps Geocode", String(args.query), options, theme);
    },
    async execute(_toolCallId, params): Promise<MapsToolResult> {
      const lib = await loadLibrary();
      const { name, provider } = lib.selectProvider(params.provider);
      const geocode = lib.requireOperation(provider, "geocode");
      const locations = await geocode(params.query, {
        limit: params.limit ?? 10,
        language: params.language,
        countryCodes: params.countryCodes,
      });
      return textResult(lib.formatLocations(name, params.query, locations));
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
    provider: Type.Optional(Type.String({ description: "Provider", minLength: 1 })),
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
      const { name, provider } = lib.selectProvider(params.provider);
      const reverse = lib.requireOperation(provider, "reverse");
      const location = await reverse(params.latitude, params.longitude, {
        language: params.language,
      });
      return textResult(lib.formatLocation(name, location));
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
      const names = lib.providers();
      return textResult(`Registered providers (${names.length}):\n  ${names.join("\n  ")}`);
    },
  });
}
