import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { requireOperation } from "./core/provider.ts";
import { listProviders } from "./core/registry.ts";
import { selectProvider } from "./core/resolve.ts";
import {
  countryCodesInput,
  languageInput,
  latitudeInput,
  limitInput,
  longitudeInput,
  providerInput,
  queryInput,
} from "./core/schemas.ts";
import { version } from "./version.ts";
import "./providers/index.ts";

function result(value: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
  };
}

function providerResult(provider: string, value: unknown): CallToolResult {
  return result({ provider, data: value });
}

/** Create an MCP server exposing the normalized geocoding operations. */
export function createMcpServer(): McpServer {
  const server = new McpServer({ name: "maps", version });

  server.registerTool(
    "maps_providers",
    {
      description: "List registered maps providers and their capabilities",
      annotations: { readOnlyHint: true },
    },
    () => result(listProviders()),
  );

  server.registerTool(
    "maps_geocode",
    {
      description: "Resolve an address or place to normalized geographic coordinates",
      inputSchema: {
        query: queryInput,
        limit: limitInput,
        language: languageInput,
        countryCodes: countryCodesInput,
        ...providerInput,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ query, limit, language, countryCodes, provider }) => {
      const selected = selectProvider(provider);
      const geocode = requireOperation(selected.provider, "geocode");
      return providerResult(selected.name, await geocode(query, { limit, language, countryCodes }));
    },
  );

  server.registerTool(
    "maps_reverse",
    {
      description: "Resolve a latitude/longitude pair to the place at or nearest to it",
      inputSchema: {
        latitude: latitudeInput,
        longitude: longitudeInput,
        language: languageInput,
        ...providerInput,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ latitude, longitude, language, provider }) => {
      const selected = selectProvider(provider);
      const reverse = requireOperation(selected.provider, "reverse");
      return providerResult(selected.name, await reverse(latitude, longitude, { language }));
    },
  );

  return server;
}
