#!/usr/bin/env node

/** Maps CLI: one command per maps tool, plus the MCP server. */

import { existsSync } from "node:fs";
import { sep } from "node:path";
import { fileURLToPath } from "node:url";
import { runCli } from "@agntn/tools/cli";
import { distanceCommand, reverseCommand } from "./cli-commands.ts";
import { MapsError } from "./core/errors.ts";
import type { createMcpServer } from "./mcp.ts";
import { serverInfo } from "./server-info.ts";
import { mapsTools } from "./tools.ts";

/** Built at runtime, so the bundler leaves `src` out. The npm package ships only `dist`. */
const sourceMcp = new URL("../src/mcp.ts", import.meta.url);
const sourceMcpPath = fileURLToPath(sourceMcp);

/** Narrows what a runtime URL import returned, which TypeScript types as `any`. */
function isMcpModule(value: unknown): value is { createMcpServer: typeof createMcpServer } {
  return typeof value === "object" && value !== null && "createMcpServer" in value;
}

/** In a checkout a bare `maps mcp` serves `src/` live. `MAPS_DIST=1` keeps the bundle. */
function servesSource(argv: readonly string[]): boolean {
  return (
    argv.length === 1 &&
    argv[0] === "mcp" &&
    process.env["MAPS_DIST"] !== "1" &&
    Boolean(process.features.typescript) &&
    !sourceMcpPath.includes(`${sep}node_modules${sep}`) &&
    existsSync(sourceMcpPath)
  );
}

/** Serves `src/mcp.ts` over stdio. */
async function serveSource(): Promise<void> {
  const module: unknown = await import(sourceMcp.href);
  if (!isMcpModule(module)) throw new TypeError(`${sourceMcpPath} has no createMcpServer`);
  const { StdioServerTransport } = await import("@modelcontextprotocol/server/stdio");
  await module.createMcpServer().connect(new StdioServerTransport());
}

const argv = process.argv.slice(2);
if (servesSource(argv)) {
  await serveSource();
} else {
  await runCli(
    {
      ...serverInfo,
      tools: mapsTools,
      commands: [reverseCommand, distanceCommand],
      mcp: true,
      expected: (error) => error instanceof MapsError,
    },
    argv,
  );
}
