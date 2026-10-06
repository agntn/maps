import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Provider } from "../../src/core/provider.ts";
import type { ProviderConstructor } from "../../src/core/provider.ts";
import { create, getDefaultURL, register } from "../../src/core/registry.ts";
import { createMcpServer } from "../../src/mcp.ts";
import "../../src/providers/index.ts";
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

/** The text of a call that has to succeed. */
function answer(response: unknown): string {
  const { content, isError } = response as { content: Array<{ text: string }>; isError?: boolean };
  expect(isError).not.toBe(true);
  return content[0]?.text ?? "";
}

/** The text of a call that has to fail. */
function failure(response: unknown): string {
  const { content, isError } = response as { content: Array<{ text: string }>; isError?: boolean };
  expect(isError).toBe(true);
  return content[0]?.text ?? "";
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
    for (const tool of listed.tools) {
      expect(tool.annotations).toMatchObject({ readOnlyHint: true, title: tool.title });
    }

    const text = answer(await client.callTool({ name: "maps_providers", arguments: {} }));
    expect(text).toContain(
      "openstreetmap: geocode, geocodeAddress, reverse (https://nominatim.openstreetmap.org)",
    );
  });

  it("geocodes a structured address and rejects an all-empty one", async () => {
    stubJSON([{ lat: "52.2312136", lon: "21.0024451", display_name: "Złota 44, Warszawa" }]);
    const client = await connectTestClient();

    const text = answer(
      await client.callTool({
        name: "maps_geocode_address",
        arguments: {
          road: "Złota",
          houseNumber: "44",
          city: "Warszawa",
          provider: "openstreetmap",
        },
      }),
    );
    expect(text).toBe(
      '[openstreetmap] 1 matches for "44, Złota, Warszawa":\n52.2312136, 21.0024451  Złota 44, Warszawa',
    );

    const empty = await client.callTool({ name: "maps_geocode_address", arguments: {} });
    expect(failure(empty)).toContain("address needs at least one non-empty field");
  });

  it("sends the facts the list line leaves out", async () => {
    stubJSON([
      {
        lat: "52.2312136",
        lon: "21.0024451",
        display_name: "Złota 44, Śródmieście, Warszawa",
        type: "apartments",
        boundingbox: ["52.2310", "52.2314", "21.0021", "21.0028"],
        address: {
          house_number: "44",
          road: "Złota",
          city: "Warszawa",
          postcode: "00-120",
          country: "Polska",
          country_code: "pl",
        },
      },
    ]);
    const client = await connectTestClient();

    const text = answer(
      await client.callTool({
        name: "maps_geocode",
        arguments: { query: "Złota 44", provider: "openstreetmap" },
      }),
    );
    expect(text.split("\n")).toEqual([
      '[openstreetmap] 1 matches for "Złota 44":',
      "52.2312136, 21.0024451  Złota 44, Śródmieście, Warszawa",
      "  category apartments; country pl; address houseNumber 44, road Złota, city Warszawa, postcode 00-120, country Polska; bounds 52.231..52.2314 lat, 21.0021..21.0028 lon",
    ]);
  });

  it("keeps escapes, controls and bidi marks in a place name off the host", async () => {
    const char = (code: number) => String.fromCodePoint(code);
    const name = [
      `Wars${char(0x1b)}]0;evil${char(0x07)}zawa`,
      `${char(0x9b)}31mred${char(0x85)}`,
      char(0x202e),
      "evil",
      char(0x2028),
      "line",
      char(0x2029),
      "para\r\n",
      "cr\r",
      "tab\there",
      `family ${[0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467].map(char).join("")}`,
      ` mi${char(0x200c)}khaham`,
    ].join("");
    stubJSON([{ lat: "52.23", lon: "21.01", display_name: name }]);
    const client = await connectTestClient();

    const text = answer(
      await client.callTool({
        name: "maps_geocode",
        arguments: { query: "Warszawa", provider: "openstreetmap" },
      }),
    );
    expect(text.split("\n")).toEqual([
      '[openstreetmap] 1 matches for "Warszawa":',
      "52.23, 21.01  Warszawaredevil line para",
      "cr",
      `tab\therefamily ${[0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467].map(char).join("")} mi${char(0x200c)}khaham`,
    ]);
  });

  it("strips an unclosed escape run from a provider in linear time", async () => {
    stubJSON([{ lat: "52.23", lon: "21.01", display_name: "\u001B]".repeat(100_000) }]);
    const client = await connectTestClient();

    const started = performance.now();
    const text = answer(
      await client.callTool({
        name: "maps_geocode",
        arguments: { query: "Warszawa", provider: "openstreetmap" },
      }),
    );
    expect(performance.now() - started).toBeLessThan(1000);
    expect(text).not.toContain("\u001B");
  });

  it("compares every provider when provider is 'all'", async () => {
    stubJSON([{ lat: "52.23", lon: "21.01", display_name: "Warszawa, Polska" }]);
    const client = await connectTestClient();

    const text = answer(
      await client.callTool({
        name: "maps_geocode",
        arguments: { query: "Warszawa", provider: "all" },
      }),
    );
    expect(text).toMatch(
      /^\[openstreetmap\] 1 matches for "Warszawa":[\s\S]*\n\n\[googlemaps\] error: Authentication failed/,
    );
  });

  it.each([
    {
      tool: "maps_geocode",
      arguments: { query: "Warszawa", provider: "openstreetmap" },
      body: [{ lat: "52.23", lon: "21.01", display_name: "Warszawa, Polska", osm_id: 336075 }],
      line: "52.23, 21.01  Warszawa, Polska",
    },
    {
      tool: "maps_geocode_address",
      arguments: { city: "Warszawa", provider: "openstreetmap" },
      body: [{ lat: "52.23", lon: "21.01", display_name: "Warszawa, Polska", osm_id: 336075 }],
      line: "52.23, 21.01  Warszawa, Polska",
    },
    {
      tool: "maps_reverse",
      arguments: { latitude: 52.23, longitude: 21.01, provider: "openstreetmap" },
      body: { lat: "52.23", lon: "21.01", display_name: "Warszawa, Polska", osm_id: 336075 },
      line: "Coordinates: 52.23, 21.01",
    },
  ])(
    "sends the provider record of $tool only when raw is requested",
    async ({ tool, arguments: args, body, line }) => {
      stubJSON(body);
      const client = await connectTestClient();

      const trimmed = answer(await client.callTool({ name: tool, arguments: args }));
      expect(trimmed).toContain(line);
      expect(trimmed).not.toContain("osm_id");

      const full = answer(await client.callTool({ name: tool, arguments: { ...args, raw: true } }));
      expect(full).toMatch(/^ {0,2}(raw|Raw:) \{.*"osm_id":336075/m);
    },
  );

  it("applies the raw flag to every outcome of a comparison", async () => {
    stubJSON([{ lat: "52.23", lon: "21.01", display_name: "Warszawa, Polska", osm_id: 336075 }]);
    const client = await connectTestClient();

    const trimmed = answer(
      await client.callTool({
        name: "maps_geocode",
        arguments: { query: "Warszawa", provider: "all" },
      }),
    );
    expect(trimmed).toMatch(/52\.23, 21\.01[\s\S]*\[googlemaps\]/);
    expect(trimmed).not.toContain("osm_id");

    const full = answer(
      await client.callTool({
        name: "maps_geocode",
        arguments: { query: "Warszawa", provider: "all", raw: true },
      }),
    );
    expect(full).toMatch(/"osm_id":336075[\s\S]*\[googlemaps\]/);
  });

  it("returns a numeric distance for nearly antipodal points", async () => {
    const client = await connectTestClient();
    const text = answer(
      await client.callTool({
        name: "maps_distance",
        arguments: {
          from: { latitude: 49.03965844307095, longitude: -120.07562443614006 },
          to: { latitude: -49.03965845245431, longitude: 59.92437556385994 },
        },
      }),
    );
    expect(text).toBe("Distance: 20015.11 km (20015114 m)\nBearing: 180°");
  });

  it("computes a distance locally without any provider or network", async () => {
    const client = await connectTestClient();

    const text = answer(
      await client.callTool({
        name: "maps_distance",
        arguments: {
          from: { latitude: 0, longitude: 0 },
          to: { latitude: 0, longitude: 1 },
        },
      }),
    );
    expect(text).toBe("Distance: 111.20 km (111195 m)\nBearing: 90°");
  });

  it("converts coordinates locally and returns the cell", async () => {
    const client = await connectTestClient();

    const text = answer(
      await client.callTool({
        name: "maps_convert",
        arguments: { input: "KO02", to: ["decimal", "pluscode"], precision: { pluscode: 4 } },
      }),
    );
    expect(text.split("\n")).toEqual([
      "maidenhead KO02 -> 52.5, 21",
      "Cell: 52..53 lat, 20..22 lon",
      "  decimal   52.500000, 21.000000",
      "  pluscode  9G430000+",
    ]);
  });

  it("rejects a precision key the schema does not know", async () => {
    const client = await connectTestClient();

    const response = await client.callTool({
      name: "maps_convert",
      arguments: { input: "KO02", precision: { what3words: 3 } },
    });
    expect(failure(response)).toContain('unknown property "what3words"');

    const odd = await client.callTool({
      name: "maps_convert",
      arguments: { input: "KO02", precision: { maidenhead: 3 } },
    });
    expect(failure(odd)).toContain("/precision/maidenhead");
  });

  it("returns a short Plus Code's reason as a tool error", async () => {
    const client = await connectTestClient();

    const response = await client.callTool({
      name: "maps_convert",
      arguments: { input: "CJ+2VX" },
    });
    expect(failure(response)).toContain("pass a reference point");
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
    expect(failure(response)).toContain("/from/latitude");
  });

  it("rejects an out-of-range latitude at the schema boundary", async () => {
    const client = await connectTestClient();

    const response = await client.callTool({
      name: "maps_reverse",
      arguments: { latitude: 95, longitude: 21 },
    });
    expect(failure(response)).toContain("/latitude");
  });

  it("forwards layers to the provider and rejects an unknown layer at the schema boundary", async () => {
    const fetch = stubJSON([]);
    const client = await connectTestClient();

    const response = await client.callTool({
      name: "maps_geocode",
      arguments: { query: "Supreme Court", layers: ["poi"], provider: "openstreetmap" },
    });
    expect(answer(response)).toBe('[openstreetmap] No matches for "Supreme Court"');
    expect(String(fetch.mock.calls[0]?.[0])).toContain("layer=poi");

    const rejected = await client.callTool({
      name: "maps_geocode",
      arguments: { query: "Supreme Court", layers: ["railway"], provider: "openstreetmap" },
    });
    expect(failure(rejected)).toContain("address, poi, natural");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("checks a country code after trimming it", async () => {
    const fetch = stubJSON([]);
    const client = await connectTestClient();

    const padded = await client.callTool({
      name: "maps_geocode",
      arguments: { query: "Springfield", countryCodes: [" US "], provider: "openstreetmap" },
    });
    expect(answer(padded)).toBe('[openstreetmap] No matches for "Springfield"');
    expect(String(fetch.mock.calls[0]?.[0])).toContain("countrycodes=us");

    const short = await client.callTool({
      name: "maps_geocode",
      arguments: { query: "Springfield", countryCodes: [" U"], provider: "openstreetmap" },
    });
    expect(failure(short)).toContain("/countryCodes/0");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each(["", "   "])(
    "rejects an empty-like provider instead of selecting a default",
    async (provider) => {
      const fetch = stubJSON([]);
      const client = await connectTestClient();

      const response = await client.callTool({
        name: "maps_geocode",
        arguments: { query: "Warsaw", provider },
      });
      expect(failure(response)).toContain("/provider");
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("rejects an unknown argument instead of dropping it", async () => {
    const client = await connectTestClient();

    const response = await client.callTool({
      name: "maps_geocode",
      arguments: { query: "Warsaw", providers: "openstreetmap" },
    });
    expect(failure(response)).toContain('unknown property "providers"');
  });

  it("includes the selected provider in operation results", async () => {
    stubJSON([{ lat: "52.23", lon: "21.01", display_name: "Warszawa, Polska" }]);
    const client = await connectTestClient();

    const text = answer(
      await client.callTool({
        name: "maps_geocode",
        arguments: { query: "Warszawa", provider: "openstreetmap" },
      }),
    );
    expect(text).toMatch(/^\[openstreetmap\] 1 matches for "Warszawa":\n52\.23, 21\.01/);
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
    expect(failure(response)).toContain(`Operation "${operation}" not supported by openstreetmap`);
  });
});
