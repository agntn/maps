import { afterEach, describe, expect, it, vi } from "vitest";
import { InvalidInputError, NotFoundError } from "../../src/core/errors.ts";
import { create } from "../../src/core/registry.ts";
import { stubJSON } from "../helpers.ts";
import "../../src/providers/openstreetmap.ts";

/** Live Nominatim jsonv2 sample captured during the pre-scaffold API audit (2026-08-24). */
const PALACE = {
  place_id: 177785698,
  osm_type: "relation",
  osm_id: 1319250,
  lat: "52.2317657",
  lon: "21.0057979",
  category: "historic",
  type: "building",
  addresstype: "historic",
  name: "Pałac Kultury i Nauki",
  display_name: "Pałac Kultury i Nauki, 1, Plac Defilad, Warszawa, 00-110, Polska",
  boundingbox: ["52.2304141", "52.2331217", "21.0043177", "21.0080405"],
  address: { country_code: "pl" },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("openstreetmap provider", () => {
  it("serves both operations", () => {
    expect(create("openstreetmap").capabilities).toEqual({
      geocode: true,
      reverse: true,
    });
  });

  it("maps a search hit to the normalized location shape", async () => {
    stubJSON([PALACE]);

    const locations = await create("openstreetmap").geocode("Pałac Kultury i Nauki");

    expect(locations).toHaveLength(1);
    expect(locations[0]).toMatchObject({
      latitude: 52.2317657,
      longitude: 21.0057979,
      displayName: "Pałac Kultury i Nauki, 1, Plac Defilad, Warszawa, 00-110, Polska",
      category: "building",
      countryCode: "pl",
      boundingBox: {
        south: 52.2304141,
        north: 52.2331217,
        west: 21.0043177,
        east: 21.0080405,
      },
    });
  });

  it("sends limit, language, and lowercased country codes as query params", async () => {
    const fetch = stubJSON([]);

    await create("openstreetmap").geocode("Warszawa", {
      limit: 3,
      language: "pl",
      countryCodes: ["PL", "de"],
    });

    const url = String(fetch.mock.calls[0]?.[0]);
    expect(url).toContain("/search?");
    expect(url).toContain("format=jsonv2");
    expect(url).toContain("limit=3");
    expect(url).toContain("accept-language=pl");
    expect(url).toContain("countrycodes=pl%2Cde");
  });

  it("clamps the limit to the Nominatim maximum of 40", async () => {
    const fetch = stubJSON([]);

    await create("openstreetmap").geocode("Warszawa", { limit: 500 });

    expect(String(fetch.mock.calls[0]?.[0])).toContain("limit=40");
  });

  it("rejects an empty query without any request", async () => {
    const fetch = stubJSON([]);

    await expect(create("openstreetmap").geocode("   ")).rejects.toBeInstanceOf(InvalidInputError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("maps a reverse hit to a single normalized location", async () => {
    stubJSON(PALACE);

    const location = await create("openstreetmap").reverse(52.2318, 21.0067);

    expect(location).toMatchObject({
      latitude: 52.2317657,
      longitude: 21.0057979,
      countryCode: "pl",
    });
  });

  it("turns the in-body reverse error into NotFoundError", async () => {
    stubJSON({ error: "Unable to geocode" });

    await expect(create("openstreetmap").reverse(0, 0)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("rejects out-of-range coordinates without any request", async () => {
    const fetch = stubJSON({});

    await expect(create("openstreetmap").reverse(91, 0)).rejects.toBeInstanceOf(InvalidInputError);
    expect(fetch).not.toHaveBeenCalled();
  });
});
