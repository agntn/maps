/** Who the server says it is. `maps --help` and MCP read the same card. */
import { version } from "./version.ts";

export const serverInfo = {
  name: "maps",
  version,
  description: "Geocoding, distances and coordinate formats across map providers",
} as const;
