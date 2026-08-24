import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Provider } from "../../src/core/provider.ts";
import type { ProviderConstructor } from "../../src/core/provider.ts";
import { create, getDefaultURL, register } from "../../src/core/registry.ts";
import { createMcpServer } from "../../src/mcp.ts";

const openConnections: Array<{ close(): Promise<void> }> = [];

/** SAFETY: create() instantiates the ProviderConstructor registered for this key. */
const openstreetmapConstructor = create("openstreetmap").constructor as ProviderConstructor;
const openstreetmapDefaultURL = getDefaultURL("openstreetmap");

afterEach(async () => {
  register(openstreetmapConstructor, openstreetmapDefaultURL);
  vi.unstubAllGlobals();
  await Promise.all(openConnections.splice(0).map((connection) => connection.close()));
});

async function connectTestClient(): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer();
  const client = new Client({ name: "maps-test", version: "1.0.0" });
  openConnections.push(client, server);
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

class DisabledProvider extends Provider {
  static readonly key = "openstreetmap";

  override get capabilities() {
    return {
      geocode: false,
      reverse: false,
    };
  }

  override async geocode(): Promise<never> {
    throw new Error("capability gate bypassed");
  }

  override async reverse(): Promise<never> {
    throw new Error("capability gate bypassed");
  }
}

describe("Maps MCP server", () => {
  it("discovers every maps tool and executes provider discovery", async () => {
    const client = await connectTestClient();

    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name)).toEqual([
      "maps_providers",
      "maps_geocode",
      "maps_reverse",
    ]);

    const response = await client.callTool({ name: "maps_providers", arguments: {} });
    expect(response.isError).not.toBe(true);
    expect(response.content).toEqual([
      {
        type: "text",
        text: expect.stringContaining('"name": "openstreetmap"'),
      },
    ]);
  });

  it("rejects an out-of-range latitude at the schema boundary", async () => {
    const client = await connectTestClient();

    const response = await client.callTool({
      name: "maps_reverse",
      arguments: { latitude: 95, longitude: 21 },
    });
    expect(response.isError).toBe(true);
  });

  it.each(["", "   "])(
    "rejects an empty-like provider instead of selecting a default",
    async (provider) => {
      const client = await connectTestClient();

      const response = await client.callTool({
        name: "maps_geocode",
        arguments: { query: "Warsaw", provider },
      });
      expect(response.isError).toBe(true);
      expect(response.content).toEqual([
        {
          type: "text",
          text: expect.not.stringContaining("openstreetmap"),
        },
      ]);
    },
  );

  it("includes the selected provider in operation results", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(
          JSON.stringify([{ lat: "52.23", lon: "21.01", display_name: "Warszawa, Polska" }]),
          { headers: { "content-type": "application/json" } },
        );
      }),
    );
    const client = await connectTestClient();

    const response = await client.callTool({
      name: "maps_geocode",
      arguments: { query: "Warszawa", provider: "openstreetmap" },
    });
    expect(response.isError).not.toBe(true);
    expect(response.content).toEqual([
      {
        type: "text",
        text: expect.stringMatching(/"provider": "openstreetmap"[\s\S]*"latitude": 52.23/),
      },
    ]);
  });

  it.each([
    {
      tool: "maps_geocode",
      operation: "geocode",
      arguments: { query: "Warsaw", provider: DisabledProvider.key },
    },
    {
      tool: "maps_reverse",
      operation: "reverse",
      arguments: { latitude: 52.23, longitude: 21.01, provider: DisabledProvider.key },
    },
  ])("honors the disabled capability for $tool", async ({ tool, operation, arguments: args }) => {
    register(DisabledProvider);
    const client = await connectTestClient();

    const response = await client.callTool({ name: tool, arguments: args });
    expect(response.isError).toBe(true);
    expect(response.content).toEqual([
      {
        type: "text",
        text: expect.stringContaining(`Operation "${operation}" not supported by openstreetmap`),
      },
    ]);
  });
});
