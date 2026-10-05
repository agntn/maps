import { afterEach, describe, expect, it, vi } from "vitest";
import { convertTool, geocodeAddressTool, geocodeTool, reverseTool } from "../../src/ai.ts";
import { stubJSON } from "../helpers.ts";

const callOptions = { toolCallId: "test", messages: [] };
const place = { lat: "52.23", lon: "21.01", display_name: "Warszawa, Polska", osm_id: 336075 };
const trimmedPlace = { latitude: 52.23, longitude: 21.01, displayName: "Warszawa, Polska" };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Maps AI SDK tools", () => {
  it.each([
    {
      name: "geocode",
      tool: geocodeTool,
      input: { query: "Warszawa", provider: "openstreetmap" },
    },
    {
      name: "geocodeAddress",
      tool: geocodeAddressTool,
      input: { city: "Warszawa", provider: "openstreetmap" },
    },
  ])("$name sends the provider record only when raw is requested", async ({ tool, input }) => {
    stubJSON([place]);

    const trimmed = await tool.execute?.(input, callOptions);
    expect(trimmed).toEqual({ provider: "openstreetmap", locations: [trimmedPlace] });

    const full = await tool.execute?.({ ...input, raw: true }, callOptions);
    expect(full).toMatchObject({ locations: [{ ...trimmedPlace, raw: place }] });
  });

  it("reverse sends the provider record only when raw is requested", async () => {
    stubJSON(place);
    const input = { latitude: 52.23, longitude: 21.01, provider: "openstreetmap" };

    const trimmed = await reverseTool.execute?.(input, callOptions);
    expect(trimmed).toEqual({ provider: "openstreetmap", location: trimmedPlace });

    const full = await reverseTool.execute?.({ ...input, raw: true }, callOptions);
    expect(full).toMatchObject({ location: { ...trimmedPlace, raw: place } });
  });

  it("applies the raw flag to every outcome of a comparison", async () => {
    stubJSON([place]);

    const trimmed = await geocodeTool.execute?.(
      { query: "Warszawa", provider: "all" },
      callOptions,
    );
    expect(trimmed).toMatchObject({
      comparison: [
        { provider: "openstreetmap", result: [trimmedPlace] },
        { provider: "googlemaps", error: expect.stringContaining("Authentication failed") },
      ],
    });
    expect(JSON.stringify(trimmed)).not.toContain("osm_id");

    const full = await geocodeTool.execute?.(
      { query: "Warszawa", provider: "all", raw: true },
      callOptions,
    );
    expect(full).toMatchObject({
      comparison: [
        { provider: "openstreetmap", result: [{ raw: place }] },
        { provider: "googlemaps", error: expect.stringContaining("Authentication failed") },
      ],
    });
  });

  it("convert returns the conversion object", async () => {
    const result = await convertTool.execute?.({ input: "ezs42", to: ["decimal"] }, callOptions);
    expect(result).toMatchObject({
      format: "geohash",
      formats: { decimal: "42.604980, -5.603027" },
    });
  });
});
