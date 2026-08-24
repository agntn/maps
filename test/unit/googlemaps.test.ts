import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AuthError,
  InvalidInputError,
  NotFoundError,
  RateLimitError,
} from "../../src/core/errors.ts";
import { create } from "../../src/core/registry.ts";
import { stubJSON } from "../helpers.ts";
import "../../src/providers/googlemaps.ts";

const WARSAW_RESULT = {
  formatted_address: "Warsaw, Poland",
  geometry: {
    location: { lat: 52.2296756, lng: 21.0122287 },
    viewport: {
      northeast: { lat: 52.3679992, lng: 21.2710984 },
      southwest: { lat: 52.0978767, lng: 20.8512898 },
    },
  },
  types: ["locality", "political"],
  address_components: [
    { long_name: "Warsaw", short_name: "Warsaw", types: ["locality", "political"] },
    { long_name: "Poland", short_name: "PL", types: ["country", "political"] },
  ],
};

function createConfigured() {
  return create("googlemaps", { apiKey: "test-key" });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("googlemaps provider", () => {
  it("requires an API key at construction", () => {
    expect(() => create("googlemaps")).toThrow(AuthError);
  });

  it("serves both operations once configured", () => {
    expect(createConfigured().capabilities).toEqual({
      geocode: true,
      reverse: true,
    });
  });

  it("maps a geocoding result to the normalized location shape", async () => {
    stubJSON({ status: "OK", results: [WARSAW_RESULT] });

    const locations = await createConfigured().geocode("Warsaw");

    expect(locations).toHaveLength(1);
    expect(locations[0]).toMatchObject({
      latitude: 52.2296756,
      longitude: 21.0122287,
      displayName: "Warsaw, Poland",
      category: "locality",
      countryCode: "pl",
      boundingBox: {
        south: 52.0978767,
        north: 52.3679992,
        west: 20.8512898,
        east: 21.2710984,
      },
    });
  });

  it("sends language and a components country filter", async () => {
    const fetch = stubJSON({ status: "ZERO_RESULTS", results: [] });

    await createConfigured().geocode("Warszawa", { language: "pl", countryCodes: ["pl", "de"] });

    const url = String(fetch.mock.calls[0]?.[0]);
    expect(url).toContain("language=pl");
    expect(url).toContain(`components=${encodeURIComponent("country:PL|country:DE")}`);
    expect(url).toContain("key=test-key");
  });

  it("slices results to the requested limit locally", async () => {
    stubJSON({ status: "OK", results: [WARSAW_RESULT, WARSAW_RESULT, WARSAW_RESULT] });

    const locations = await createConfigured().geocode("Warsaw", { limit: 2 });

    expect(locations).toHaveLength(2);
  });

  it("returns an empty list for ZERO_RESULTS", async () => {
    stubJSON({ status: "ZERO_RESULTS", results: [] });

    await expect(createConfigured().geocode("nowhere")).resolves.toEqual([]);
  });

  it.each([
    ["REQUEST_DENIED", AuthError],
    ["OVER_QUERY_LIMIT", RateLimitError],
    ["INVALID_REQUEST", InvalidInputError],
  ])(
    "maps in-body status %s onto the error hierarchy despite HTTP 200",
    async (status, expected) => {
      stubJSON({ status, results: [], error_message: "denied" });

      await expect(createConfigured().geocode("Warsaw")).rejects.toBeInstanceOf(expected);
    },
  );

  it("maps a reverse hit to a single normalized location", async () => {
    stubJSON({ status: "OK", results: [WARSAW_RESULT] });

    const location = await createConfigured().reverse(52.2297, 21.0122);

    expect(location).toMatchObject({ displayName: "Warsaw, Poland", countryCode: "pl" });
  });

  it("turns an empty reverse response into NotFoundError", async () => {
    stubJSON({ status: "ZERO_RESULTS", results: [] });

    await expect(createConfigured().reverse(0, 0)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("rejects out-of-range coordinates without any request", async () => {
    const fetch = stubJSON({});

    await expect(createConfigured().reverse(0, 200)).rejects.toBeInstanceOf(InvalidInputError);
    expect(fetch).not.toHaveBeenCalled();
  });
});
