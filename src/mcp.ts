import { createMcpServer as createToolServer } from "@agntn/tools/mcp";
import type { Server } from "@modelcontextprotocol/server";
import { mapsTools } from "./tools.ts";
import { version } from "./version.ts";

/** An unconnected MCP server with the maps tools; providers load on the first call. */
export function createMcpServer(): Server {
  return createToolServer({ name: "maps", version }, mapsTools);
}
