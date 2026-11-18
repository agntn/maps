import { callTool, createMcpServer as createToolServer, errorResult } from "@agntn/tools/mcp";
import type { Server } from "@modelcontextprotocol/server";
import { serverInfo } from "./server-info.ts";
import { sourceChangeCheck } from "./source-change.ts";
import { mapsTools } from "./tools.ts";

const RESTART = "src/ changed under this server, restart it to load the new code";
const DROPPED =
  "src/ changed during this call, so its answer was dropped. Restart the server and ask again";

/** Counted from process start, so a pull during the first imports counts too. */
const changed = import.meta.url.endsWith(".ts")
  ? sourceChangeCheck(import.meta.dirname, performance.timeOrigin)
  : undefined;

/**
 * An unconnected MCP server with the maps tools. From `src/`, it won't navigate by a redrawn map.
 *
 * @returns {Server} The server, ready to connect.
 */
export function createMcpServer(): Server {
  const server = createToolServer(serverInfo, mapsTools);
  if (!changed) return server;

  server.setRequestHandler("tools/call", async (request, ctx) => {
    if (changed()) return errorResult(RESTART);
    const result = await callTool(
      serverInfo,
      mapsTools,
      request.params.name,
      request.params.arguments,
      { signal: ctx.mcpReq.signal },
    );
    return changed() ? errorResult(DROPPED) : result;
  });
  return server;
}
