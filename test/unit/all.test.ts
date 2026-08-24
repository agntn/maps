import { afterEach, describe, expect, it, vi } from "vitest";
import {
  geocodeAddressAll,
  geocodeAll,
  reverseAll,
  serializeOutcomes,
} from "../../src/core/all.ts";
import { AuthError } from "../../src/core/errors.ts";
import { formatGeocodeAll, formatReverseAll } from "../../src/core/format.ts";
import "../../src/providers/index.ts";

const OSM_PLACE = { lat: "52.23", lon: "21.01", display_name: "Warszawa (OSM)" };
const GOOGLE_RESPONSE = {
  status: "OK",
  results: [
    {
      formatted_address: "Warsaw (Google)",
      geometry: { location: { lat: 52.2297, lng: 21.0122 } },
    },
  ],
};

/** Route the stub by URL: Nominatim search returns a list, reverse a single object. */
function stubRoutedFetch() {
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const body = url.includes("nominatim")
      ? url.includes("/reverse")
        ? OSM_PLACE
        : [OSM_PLACE]
      : GOOGLE_RESPONSE;
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("geocodeAll", () => {
  it("keeps an unconfigured provider as an error entry instead of dropping it", async () => {
    stubRoutedFetch();

    const outcomes = await geocodeAll("Warszawa");

    expect(outcomes.map((outcome) => outcome.provider)).toEqual(["openstreetmap", "googlemaps"]);
    expect(outcomes[0]?.result?.[0]?.displayName).toBe("Warszawa (OSM)");
    expect(outcomes[1]?.error).toBeInstanceOf(AuthError);
  });

  it("returns per-provider results when every provider is configured", async () => {
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "test-key");
    const fetch = stubRoutedFetch();

    const outcomes = await geocodeAll("Warszawa", { limit: 1 });

    expect(outcomes[0]?.result?.[0]?.displayName).toBe("Warszawa (OSM)");
    expect(outcomes[1]?.result?.[0]?.displayName).toBe("Warsaw (Google)");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("formats a side-by-side comparison with the failure inline", async () => {
    stubRoutedFetch();

    const text = formatGeocodeAll("Warszawa", await geocodeAll("Warszawa"));

    expect(text).toContain('[openstreetmap] 1 matches for "Warszawa"');
    expect(text).toContain("[googlemaps] error: Authentication failed for googlemaps");
  });
});

describe("geocodeAddressAll", () => {
  it("fans a structured address out with failures kept inline", async () => {
    stubRoutedFetch();

    const outcomes = await geocodeAddressAll({ city: "Warszawa" });

    expect(outcomes[0]?.result?.[0]?.displayName).toBe("Warszawa (OSM)");
    expect(outcomes[1]?.error).toBeInstanceOf(AuthError);
  });
});

describe("reverseAll", () => {
  it("compares reverse results across configured providers", async () => {
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "test-key");
    stubRoutedFetch();

    const outcomes = await reverseAll(52.23, 21.01);

    expect(outcomes[0]?.result?.displayName).toBe("Warszawa (OSM)");
    expect(outcomes[1]?.result?.displayName).toBe("Warsaw (Google)");

    const text = formatReverseAll(outcomes);
    expect(text).toContain("[openstreetmap] Warszawa (OSM)");
    expect(text).toContain("[googlemaps] Warsaw (Google)");
  });

  it("rejects out-of-range coordinates per provider without any request", async () => {
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "test-key");
    const fetch = stubRoutedFetch();

    const outcomes = await reverseAll(95, 0);

    expect(outcomes.every((outcome) => outcome.error?.name === "InvalidInputError")).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("serializeOutcomes", () => {
  it("reduces errors to their messages for JSON surfaces", async () => {
    stubRoutedFetch();

    const serialized = serializeOutcomes(await geocodeAll("Warszawa"));

    expect(serialized[0]?.result?.[0]?.displayName).toBe("Warszawa (OSM)");
    expect(serialized[1]).toEqual({
      provider: "googlemaps",
      error: expect.stringContaining("GOOGLE_MAPS_API_KEY"),
    });
  });
});
