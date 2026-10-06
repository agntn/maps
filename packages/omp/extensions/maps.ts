/** OMP extension: Maps - unified geocoding tools. */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { registerOmpTools } from "@agntn/tools/omp";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

import type * as MapsTools from "../../../dist/tools.d.mts";

/** Longest argument on the status line, cut before the adapter's sanitizer sees it. */
const PREVIEW_LENGTH = 80;

const sourceModulePath = fileURLToPath(new URL("../../../src/tools.ts", import.meta.url));

/** Source in a checkout, build in the package; compiled OMP resolves only literal specifiers. */
function loadTools(): Promise<typeof MapsTools> {
  return (
    existsSync(sourceModulePath)
      ? import("../../../src/tools.ts")
      : import("../../../dist/tools.mjs")
  ) as Promise<typeof MapsTools>;
}

type Args = Readonly<Record<string, unknown>>;

function preview(...parts: unknown[]): string {
  return parts
    .filter((part) => part !== undefined && part !== "")
    .map(String)
    .join(", ")
    .slice(0, PREVIEW_LENGTH);
}

function pointPreview(value: unknown): string {
  const point = (value ?? {}) as Args;
  return `${String(point["latitude"])},${String(point["longitude"])}`;
}

const describeCall: Record<string, (args: Args) => string> = {
  maps_providers: () => "list",
  maps_geocode: (args) => preview(args["query"]),
  maps_geocode_address: (args) =>
    preview(args["houseNumber"], args["road"], args["city"], args["postcode"], args["country"]) ||
    "empty address",
  maps_reverse: (args) => preview(args["latitude"], args["longitude"]),
  maps_distance: (args) =>
    `${pointPreview(args["from"])} to ${pointPreview(args["to"])}`.slice(0, PREVIEW_LENGTH),
  maps_convert: (args) => preview(args["input"]),
};

/** Register the maps tools with the OMP host; the library loads on the first call. */
export default async function mapsExtension(pi: ExtensionAPI): Promise<void> {
  pi.setLabel("Maps");
  const { mapsTools } = await loadTools();
  registerOmpTools(pi, mapsTools, {
    Text: pi.pi.Text,
    renderers: Object.fromEntries(
      Object.entries(describeCall).map(([name, describe]) => [name, { describeCall: describe }]),
    ),
  });
}
