/** Pi extension: Maps - unified geocoding tools */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { registerPiTools } from "@agntn/tools/pi";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import type * as MapsTools from "../../../dist/tools.d.mts";

const sourceModuleUrl = new URL("../../../src/tools.ts", import.meta.url);
const distributionModuleUrl = new URL("../../../dist/tools.mjs", import.meta.url);

/** Load the definitions from the source in a checkout and from the build in the package. */
function loadTools(): Promise<typeof MapsTools> {
  return import(
    existsSync(fileURLToPath(sourceModuleUrl)) ? sourceModuleUrl.href : distributionModuleUrl.href
  ) as Promise<typeof MapsTools>;
}

/** Register the maps tools; the library loads on the first call. */
export default async function mapsExtension(pi: ExtensionAPI): Promise<void> {
  const { mapsTools } = await loadTools();
  registerPiTools(pi, mapsTools);
}
