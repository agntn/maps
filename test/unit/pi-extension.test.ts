import { wireSchema } from "@agntn/tools";
import type {
  ExtensionAPI,
  ExtensionToolContext,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import mapsExtension from "../../packages/pi/extensions/maps.ts";
import { mapsTools } from "../../src/tools.ts";
import { NETWORKED_CALLS, requireTool, stubJSON, stubPendingFetch } from "../helpers.ts";

/** SAFETY: the adapter only calls registerTool; reading any other member fails by name. */
async function registerExtensionTools(): Promise<Map<string, ToolDefinition>> {
  const tools = new Map<string, ToolDefinition>();
  const api = new Proxy(
    {
      registerTool(tool: ToolDefinition) {
        tools.set(tool.name, tool);
      },
    },
    {
      get(target, key, receiver) {
        if (typeof key === "symbol" || key === "then" || Reflect.has(target, key)) {
          return Reflect.get(target, key, receiver);
        }
        throw new Error(`ExtensionAPI.${String(key)} is not stubbed`);
      },
    },
  );

  await mapsExtension(api as unknown as ExtensionAPI);
  return tools;
}

/** SAFETY: the tested execute functions do not read the context. */
const unusedContext = {} as ExtensionToolContext;

async function run(name: string, params: unknown) {
  const tool = requireTool(await registerExtensionTools(), name);
  return tool.execute("test", params as never, undefined, undefined, unusedContext);
}

async function text(name: string, params: unknown): Promise<string> {
  return ((await run(name, params)).content[0] as { text: string }).text;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("maps Pi extension", () => {
  it("registers the complete tool set with the shared schemas", async () => {
    const tools = await registerExtensionTools();

    expect([...tools.keys()]).toEqual([
      "maps_providers",
      "maps_geocode",
      "maps_address_geocode",
      "maps_reverse",
      "maps_distance",
      "maps_convert",
    ]);
    for (const definition of mapsTools) {
      expect(requireTool(tools, definition.name).parameters).toEqual(wireSchema(definition));
    }
  });

  it("names each tool in every prompt guideline", async () => {
    const tools = await registerExtensionTools();

    for (const tool of tools.values()) {
      expect(tool.promptGuidelines).not.toHaveLength(0);
      for (const guideline of tool.promptGuidelines ?? []) {
        expect(guideline).toContain(tool.name);
      }
    }
  });

  it.each([0, 41, 1.5])("refuses geocode limit %s before any request", async (limit) => {
    const fetch = stubJSON([]);

    await expect(run("maps_geocode", { query: "Warsaw", limit })).rejects.toThrow("/limit");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("bounds reverse coordinates to valid WGS 84 ranges", async () => {
    await expect(run("maps_reverse", { latitude: 95, longitude: 21.01 })).rejects.toThrow(
      "/latitude",
    );
    await expect(run("maps_reverse", { latitude: 52.23, longitude: 200 })).rejects.toThrow(
      "/longitude",
    );
    await expect(run("maps_reverse", { latitude: 52.23 })).rejects.toThrow("longitude");
  });

  it("accepts only the named geocode layers", async () => {
    stubJSON([]);

    await expect(
      text("maps_geocode", {
        query: "Warsaw",
        layers: ["poi", "natural"],
        provider: "openstreetmap",
      }),
    ).resolves.toBe('[openstreetmap] No matches for "Warsaw"');
    await expect(run("maps_geocode", { query: "Warsaw", layers: ["railway"] })).rejects.toThrow(
      "address, poi, natural",
    );
    await expect(run("maps_geocode", { query: "Warsaw", layers: "poi" })).rejects.toThrow(
      "/layers",
    );
  });

  it("accepts only the named reverse granularities", async () => {
    await expect(
      run("maps_reverse", { latitude: 52.23, longitude: 21.01, granularity: "block" }),
    ).rejects.toThrow("country, state, city, street, building");
  });

  it("compares providers side by side when provider is 'all'", async () => {
    stubJSON([{ lat: "52.23", lon: "21.01", display_name: "Warszawa, Polska" }]);

    const result = await text("maps_geocode", { query: "Warszawa", provider: "all" });

    expect(result).toContain('[openstreetmap] 1 matches for "Warszawa"');
    expect(result).toContain("[googlemaps] error: Authentication failed for googlemaps");
  });

  it("computes a distance locally without network access", async () => {
    const result = await run("maps_distance", {
      from: { latitude: 0, longitude: 0 },
      to: { latitude: 0, longitude: 1 },
    });

    expect(result.content).toEqual([
      { type: "text", text: "Distance: 111.20 km (111195 m)\nBearing: 90°" },
    ]);
    expect(result.details).toEqual({
      meters: expect.closeTo(111195.08, 1),
      formatted: "111.20 km (111195 m)",
      bearing: 90,
    });
  });

  it("converts coordinates to text without network access", async () => {
    await expect(
      run("maps_convert", { input: "ezs42", precision: { geohash: 30 } }),
    ).rejects.toThrow("/precision/geohash");
    await expect(run("maps_convert", { input: "ezs42", to: ["w3w"] })).rejects.toThrow("/to/0");
    await expect(
      run("maps_convert", { input: "ezs42", precision: { pluscode: 9 } }),
    ).rejects.toThrow("/precision/pluscode");

    await expect(
      text("maps_convert", { input: "ezs42", to: ["decimal", "maidenhead"] }),
    ).resolves.toBe(
      [
        "geohash ezs42 -> 42.60498046875, -5.60302734375",
        "Cell: 42.5830078125..42.626953125 lat, -5.625..-5.5810546875 lon",
        "  decimal     42.604980, -5.603027",
        "  maidenhead  IN72eo",
      ].join("\n"),
    );
  });

  it("lists providers without model or network access", async () => {
    await expect(text("maps_providers", {})).resolves.toMatch(/^Registered providers \(2\):/);
  });

  it("fails the call on a refusal of the library, since Pi takes a returned value as success", async () => {
    await expect(run("maps_address_geocode", {})).rejects.toThrow(
      "address needs at least one non-empty field",
    );
  });

  it.each(NETWORKED_CALLS)(
    "cancels the requests of %s %j with the host signal",
    async (name, params) => {
      vi.stubEnv("WHAT3WORDS_API_KEY", "test-key");
      const signals = stubPendingFetch();
      const tool = requireTool(await registerExtensionTools(), name);
      const controller = new AbortController();

      const pending = tool.execute(
        "test",
        params as never,
        controller.signal,
        undefined,
        unusedContext,
      );
      await vi.waitFor(() => expect(signals.length).toBeGreaterThan(0));
      controller.abort();

      await pending.catch(() => undefined);
      expect(signals.every((signal) => signal.aborted)).toBe(true);
    },
  );
});
