import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Provider } from "../../src/core/provider.ts";
import type { ProviderConstructor } from "../../src/core/provider.ts";
import { create, getDefaultURL, register } from "../../src/core/registry.ts";
import { createMcpServer } from "../../src/mcp.ts";
import { stubJSON } from "../helpers.ts";

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
      geocodeAddress: false,
      reverse: false,
    };
  }

  override async geocode(): Promise<never> {
    throw new Error("capability gate bypassed");
  }

  override async geocodeAddress(): Promise<never> {
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
      "maps_geocode_address",
      "maps_reverse",
      "maps_distance",
      "maps_convert",
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

  it("geocodes a structured address and rejects an all-empty one", async () => {
    stubJSON([{ lat: "52.2312136", lon: "21.0024451", display_name: "Złota 44, Warszawa" }]);
    const client = await connectTestClient();

    const response = await client.callTool({
      name: "maps_geocode_address",
      arguments: { road: "Złota", houseNumber: "44", city: "Warszawa", provider: "openstreetmap" },
    });
    expect(response.isError).not.toBe(true);
    expect(response.content).toEqual([
      {
        type: "text",
        text: expect.stringMatching(/"provider": "openstreetmap"[\s\S]*"latitude": 52.2312136/),
      },
    ]);

    const empty = await client.callTool({ name: "maps_geocode_address", arguments: {} });
    expect(empty.isError).toBe(true);
    expect(empty.content).toEqual([
      {
        type: "text",
        text: expect.stringContaining("address needs at least one non-empty field"),
      },
    ]);
  });

  it("compares every provider when provider is 'all'", async () => {
    stubJSON([{ lat: "52.23", lon: "21.01", display_name: "Warszawa, Polska" }]);
    const client = await connectTestClient();

    const response = await client.callTool({
      name: "maps_geocode",
      arguments: { query: "Warszawa", provider: "all" },
    });
    expect(response.isError).not.toBe(true);
    expect(response.content).toEqual([
      {
        type: "text",
        text: expect.stringMatching(
          /"provider": "openstreetmap"[\s\S]*"provider": "googlemaps"[\s\S]*"error": "Authentication failed/,
        ),
      },
    ]);
  });

  it.each([
    {
      tool: "maps_geocode",
      arguments: { query: "Warszawa", provider: "openstreetmap" },
      body: [{ lat: "52.23", lon: "21.01", display_name: "Warszawa, Polska", osm_id: 336075 }],
    },
    {
      tool: "maps_geocode_address",
      arguments: { city: "Warszawa", provider: "openstreetmap" },
      body: [{ lat: "52.23", lon: "21.01", display_name: "Warszawa, Polska", osm_id: 336075 }],
    },
    {
      tool: "maps_reverse",
      arguments: { latitude: 52.23, longitude: 21.01, provider: "openstreetmap" },
      body: { lat: "52.23", lon: "21.01", display_name: "Warszawa, Polska", osm_id: 336075 },
    },
  ])(
    "sends the provider record of $tool only when raw is requested",
    async ({ tool, arguments: args, body }) => {
      stubJSON(body);
      const client = await connectTestClient();

      const trimmed = await client.callTool({ name: tool, arguments: args });
      expect(trimmed.isError).not.toBe(true);
      expect(trimmed.content).toEqual([
        {
          type: "text",
          text: expect.stringContaining('"latitude": 52.23'),
        },
      ]);
      expect(trimmed.content).toEqual([
        {
          type: "text",
          text: expect.not.stringContaining('"raw"'),
        },
      ]);

      const full = await client.callTool({ name: tool, arguments: { ...args, raw: true } });
      expect(full.isError).not.toBe(true);
      expect(full.content).toEqual([
        {
          type: "text",
          text: expect.stringMatching(/"raw": \{[\s\S]*"osm_id": 336075/),
        },
      ]);
    },
  );

  it("applies the raw flag to every outcome of a comparison", async () => {
    stubJSON([{ lat: "52.23", lon: "21.01", display_name: "Warszawa, Polska", osm_id: 336075 }]);
    const client = await connectTestClient();

    const trimmed = await client.callTool({
      name: "maps_geocode",
      arguments: { query: "Warszawa", provider: "all" },
    });
    expect(trimmed.isError).not.toBe(true);
    expect(trimmed.content).toEqual([
      {
        type: "text",
        text: expect.stringMatching(/"latitude": 52.23[\s\S]*"provider": "googlemaps"/),
      },
    ]);
    expect(trimmed.content).toEqual([
      {
        type: "text",
        text: expect.not.stringContaining('"raw"'),
      },
    ]);

    const full = await client.callTool({
      name: "maps_geocode",
      arguments: { query: "Warszawa", provider: "all", raw: true },
    });
    expect(full.isError).not.toBe(true);
    expect(full.content).toEqual([
      {
        type: "text",
        text: expect.stringMatching(/"osm_id": 336075[\s\S]*"provider": "googlemaps"/),
      },
    ]);
  });

  it("returns a numeric distance for nearly antipodal points", async () => {
    const client = await connectTestClient();
    const response = await client.callTool({
      name: "maps_distance",
      arguments: {
        from: { latitude: 49.03965844307095, longitude: -120.07562443614006 },
        to: { latitude: -49.03965845245431, longitude: 59.92437556385994 },
      },
    });
    expect(response.isError).not.toBe(true);
    expect(response.content).toEqual([
      {
        type: "text",
        text: JSON.stringify(
          {
            meters: 20015114.442035925,
            formatted: "20015.11 km (20015114 m)",
            bearing: 180,
          },
          null,
          2,
        ),
      },
    ]);
  });

  it("computes a distance locally without any provider or network", async () => {
    const client = await connectTestClient();

    const response = await client.callTool({
      name: "maps_distance",
      arguments: {
        from: { latitude: 0, longitude: 0 },
        to: { latitude: 0, longitude: 1 },
      },
    });
    expect(response.isError).not.toBe(true);
    expect(response.content).toEqual([
      {
        type: "text",
        text: expect.stringMatching(
          /"meters": 111195\.0\d+[\s\S]*"formatted": "111\.20 km[\s\S]*"bearing": 90/,
        ),
      },
    ]);
  });

  it("converts coordinates locally and returns the cell", async () => {
    const client = await connectTestClient();

    const response = await client.callTool({
      name: "maps_convert",
      arguments: { input: "KO02", to: ["decimal", "pluscode"], precision: { pluscode: 4 } },
    });
    expect(response.isError).not.toBe(true);
    const text = (response.content as Array<{ text: string }>)[0]?.text ?? "";
    expect(JSON.parse(text)).toEqual({
      input: "KO02",
      format: "maidenhead",
      canonical: "KO02",
      center: { latitude: 52.5, longitude: 21 },
      bounds: { south: 52, north: 53, west: 20, east: 22 },
      formats: { decimal: "52.500000, 21.000000", pluscode: "9G430000+" },
    });
  });

  it("rejects a precision key the schema does not know", async () => {
    const client = await connectTestClient();

    const response = await client.callTool({
      name: "maps_convert",
      arguments: { input: "KO02", precision: { what3words: 3 } },
    });
    expect(response.isError).toBe(true);
  });

  it("returns a short Plus Code's reason as a tool error", async () => {
    const client = await connectTestClient();

    const response = await client.callTool({
      name: "maps_convert",
      arguments: { input: "CJ+2VX" },
    });
    expect(response.isError).toBe(true);
    expect(response.content).toEqual([
      { type: "text", text: expect.stringContaining("pass a reference point") },
    ]);
  });

  it("rejects an out-of-range distance point at the schema boundary", async () => {
    const client = await connectTestClient();

    const response = await client.callTool({
      name: "maps_distance",
      arguments: {
        from: { latitude: 95, longitude: 0 },
        to: { latitude: 0, longitude: 1 },
      },
    });
    expect(response.isError).toBe(true);
  });

  it("rejects an out-of-range latitude at the schema boundary", async () => {
    const client = await connectTestClient();

    const response = await client.callTool({
      name: "maps_reverse",
      arguments: { latitude: 95, longitude: 21 },
    });
    expect(response.isError).toBe(true);
  });

  it("forwards layers to the provider and rejects an unknown layer at the schema boundary", async () => {
    const fetch = stubJSON([]);
    const client = await connectTestClient();

    const response = await client.callTool({
      name: "maps_geocode",
      arguments: { query: "Supreme Court", layers: ["poi"], provider: "openstreetmap" },
    });
    expect(response.isError).not.toBe(true);
    expect(String(fetch.mock.calls[0]?.[0])).toContain("layer=poi");

    const rejected = await client.callTool({
      name: "maps_geocode",
      arguments: { query: "Supreme Court", layers: ["railway"], provider: "openstreetmap" },
    });
    expect(rejected.isError).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
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
    stubJSON([{ lat: "52.23", lon: "21.01", display_name: "Warszawa, Polska" }]);
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
