#!/usr/bin/env node

/** Maps CLI: one command per maps tool, plus the MCP server. */
import { runCli } from "@agntn/tools/cli";
import { distanceCommand, reverseCommand } from "./cli-commands.ts";
import { MapsError } from "./core/errors.ts";
import { mapsTools } from "./tools.ts";
import { version } from "./version.ts";

await runCli({
  name: "maps",
  version,
  description: "Unified maps and geocoding CLI",
  tools: mapsTools,
  commands: [reverseCommand, distanceCommand],
  mcp: true,
  expected: (error) => error instanceof MapsError,
});
