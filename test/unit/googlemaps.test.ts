import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  AuthError,
  InvalidInputError,
  NotFoundError,
  RateLimitError,
} from "../../src/core/errors.ts";
import { create } from "../../src/core/registry.ts";
import { requestedUrl, stubJSON } from "../helpers.ts";
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

/** Shapes from the Geocoding API's address types table, one per layer. */
const SUPREME_COURT_RESULT = {
  formatted_address: "1 First St NE, Washington, DC 20543, USA",
  geometry: { location: { lat: 38.8906, lng: -77.0044 } },
  types: ["establishment", "point_of_interest"],
};
const NAMED_BUILDING_RESULT = {
  formatted_address: "Thurgood Marshall Federal Judiciary Building, Washington, DC, USA",
  geometry: { location: { lat: 38.8974, lng: -77.0066 } },
  types: ["premise"],
};
const SUPREME_COURT_STREET = {
  formatted_address: "Supreme Ct, Los Angeles, CA 90031, USA",
  geometry: { location: { lat: 34.0773, lng: -118.1946 } },
  types: ["route"],
};
const POTOMAC_RESULT = {
  formatted_address: "Potomac River",
  geometry: { location: { lat: 38.6, lng: -77.1 } },
  types: ["establishment", "natural_feature", "point_of_interest"],
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

  it("serves every operation once configured", () => {
    expect(createConfigured().capabilities).toEqual({
      geocode: true,
      geocodeAddress: true,
      reverse: true,
    });
  });

  it("splits a structured address into the address param and a components filter", async () => {
    const fetch = stubJSON({ status: "ZERO_RESULTS", results: [] });

    await createConfigured().geocodeAddress({
      houseNumber: "44",
      road: "Złota",
      city: "Warszawa",
      country: "PL",
    });

    const url = requestedUrl(fetch);
    expect(url).toContain("address=44+Z%C5%82ota");
    expect(url).toContain("components=locality%3AWarszawa%7Ccountry%3APL");
  });

  it("rejects an all-empty structured address without any request", async () => {
    const fetch = stubJSON({});

    await expect(createConfigured().geocodeAddress({})).rejects.toMatchObject({
      name: "InvalidInputError",
    });
    expect(fetch).not.toHaveBeenCalled();
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
      address: {
        city: "Warsaw",
        country: "Poland",
      },
      boundingBox: {
        south: 52.0978767,
        north: 52.3679992,
        west: 20.8512898,
        east: 21.2710984,
      },
    });
  });

  it("maps street-level address components onto the structured address", async () => {
    stubJSON({
      status: "OK",
      results: [
        {
          formatted_address: "Złota 44, 00-120 Warszawa, Poland",
          geometry: { location: { lat: 52.2312136, lng: 21.0024451 } },
          address_components: [
            { long_name: "44", short_name: "44", types: ["street_number"] },
            { long_name: "Złota", short_name: "Złota", types: ["route"] },
            { long_name: "Warszawa", short_name: "Warszawa", types: ["locality", "political"] },
            {
              long_name: "Województwo mazowieckie",
              short_name: "Województwo mazowieckie",
              types: ["administrative_area_level_1", "political"],
            },
            { long_name: "00-120", short_name: "00-120", types: ["postal_code"] },
            { long_name: "Poland", short_name: "PL", types: ["country", "political"] },
          ],
        },
      ],
    });

    const [location] = await createConfigured().geocode("Złota 44, Warszawa");

    expect(location?.address).toEqual({
      houseNumber: "44",
      road: "Złota",
      city: "Warszawa",
      state: "Województwo mazowieckie",
      postcode: "00-120",
      country: "Poland",
    });
  });

  it("sends language and a components country filter", async () => {
    const fetch = stubJSON({ status: "ZERO_RESULTS", results: [] });

    await createConfigured().geocode("Warszawa", { language: "pl", countryCodes: ["pl", "de"] });

    const url = requestedUrl(fetch);
    expect(url).toContain("language=pl");
    expect(url).toContain(`components=${encodeURIComponent("country:PL|country:DE")}`);
    expect(url).toContain("key=test-key");
  });

  it("slices results to the requested limit locally", async () => {
    stubJSON({ status: "OK", results: [WARSAW_RESULT, WARSAW_RESULT, WARSAW_RESULT] });

    const locations = await createConfigured().geocode("Warsaw", { limit: 2 });

    expect(locations).toHaveLength(2);
  });

  it("filters results by layer locally, before the limit is applied", async () => {
    const fetch = stubJSON({
      status: "OK",
      results: [
        SUPREME_COURT_STREET,
        SUPREME_COURT_STREET,
        SUPREME_COURT_RESULT,
        NAMED_BUILDING_RESULT,
        POTOMAC_RESULT,
      ],
    });
    const provider = createConfigured();

    const poi = await provider.geocode("Supreme Court", { layers: ["poi"], limit: 2 });
    const natural = await provider.geocode("Potomac", { layers: ["natural"] });
    const address = await provider.geocodeAddress({ road: "Supreme Ct" }, { layers: ["address"] });
    const everything = await provider.geocode("Supreme Court", { layers: [] });

    expect(requestedUrl(fetch)).not.toContain("layer");
    expect(poi.map((location) => location.displayName)).toEqual([
      "1 First St NE, Washington, DC 20543, USA",
      "Thurgood Marshall Federal Judiciary Building, Washington, DC, USA",
    ]);
    expect(natural.map((location) => location.displayName)).toEqual(["Potomac River"]);
    expect(address).toHaveLength(2);
    expect(everything).toHaveLength(5);
  });

  it("rejects an unknown layer without any request", async () => {
    const fetch = stubJSON({ status: "OK", results: [SUPREME_COURT_RESULT] });
    const provider = createConfigured();

    await expect(
      provider.geocode("Supreme Court", { layers: ["manmade" as never] }),
    ).rejects.toBeInstanceOf(InvalidInputError);
    await expect(
      provider.geocodeAddress({ road: "Supreme Ct" }, { layers: ["manmade" as never] }),
    ).rejects.toBeInstanceOf(InvalidInputError);
    expect(fetch).not.toHaveBeenCalled();
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

  it("maps granularity onto the result_type filter", async () => {
    const fetch = stubJSON({ status: "OK", results: [WARSAW_RESULT] });

    await createConfigured().reverse(52.2297, 21.0122, { granularity: "city" });

    expect(requestedUrl(fetch)).toContain("result_type=locality");
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
