import { afterEach, describe, expect, it, vi } from "vitest";
import {
  geocodeAddressAll,
  geocodeAll,
  geocodeWithFallback,
  reverseAll,
  reverseWithFallback,
  serializeOutcomes,
} from "../../src/core/all.ts";
import { AuthError, InvalidInputError, RateLimitError } from "../../src/core/errors.ts";
import { formatGeocodeAll, formatReverseAll } from "../../src/core/format.ts";
import { Provider, type ProviderConstructor } from "../../src/core/provider.ts";
import { create, getDefaultURL, register } from "../../src/core/registry.ts";
import type { GeoLocation, ProviderCapabilities } from "../../src/core/types.ts";
import "../../src/providers/index.ts";
import { stubPendingFetch } from "../helpers.ts";

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

describe("fallback", () => {
  it("falls past an in-body auth failure to the next provider", async () => {
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "dummy");
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const body = String(input).includes("nominatim")
        ? [OSM_PLACE]
        : { status: "REQUEST_DENIED", results: [], error_message: "denied" };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetch);

    const fallback = await geocodeWithFallback("Warszawa");

    expect(fallback.provider).toBe("openstreetmap");
    expect(fallback.result[0]?.displayName).toBe("Warszawa (OSM)");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("uses the resolved provider when it answers", async () => {
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "test-key");
    stubRoutedFetch();

    const fallback = await geocodeWithFallback("Warszawa");

    expect(fallback.provider).toBe("googlemaps");
    expect(fallback.result[0]?.displayName).toBe("Warsaw (Google)");
  });

  it("throws the first skip reason when every provider is inaccessible", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("slow down", { status: 429 })),
    );

    await expect(geocodeWithFallback("Warszawa")).rejects.toBeInstanceOf(RateLimitError);
  });

  it("propagates invalid input immediately instead of trying another provider", async () => {
    const fetch = stubRoutedFetch();

    await expect(reverseWithFallback(95, 0)).rejects.toBeInstanceOf(InvalidInputError);
    expect(fetch).not.toHaveBeenCalled();
  });
});

/** SAFETY: create() instantiates the ProviderConstructor registered for this key. */
const googlemapsConstructor = create("googlemaps", { apiKey: "unused" })
  .constructor as ProviderConstructor;
const googlemapsDefaultURL = getDefaultURL("googlemaps");

/** Reports any failed request as a rate limit, the way a provider outside this package might. */
class RateLimitOnFailure extends Provider {
  static readonly key = "googlemaps";

  get capabilities(): ProviderCapabilities {
    return { geocode: true, geocodeAddress: false, reverse: false };
  }

  async geocode(): Promise<GeoLocation[]> {
    try {
      return await this.getJSON<GeoLocation[]>("https://example.com/geocode");
    } catch {
      throw new RateLimitError(RateLimitOnFailure.key);
    }
  }

  async geocodeAddress(): Promise<GeoLocation[]> {
    return [];
  }

  async reverse(): Promise<GeoLocation> {
    throw new Error("not served");
  }
}

describe("cancellation", () => {
  afterEach(() => {
    register(googlemapsConstructor, googlemapsDefaultURL);
  });

  it("stops a fallback walk at the provider it reached", async () => {
    const signals = stubPendingFetch();
    const controller = new AbortController();

    const pending = geocodeWithFallback("Warszawa", {}, controller.signal);
    await vi.waitFor(() => expect(signals).toHaveLength(1));
    controller.abort();

    await expect(pending).rejects.toThrow();
    expect(signals).toHaveLength(1);
    expect(signals[0]?.aborted).toBe(true);
  });

  it("does not walk on when an aborted request comes back as a skippable failure", async () => {
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "test-key");
    register(RateLimitOnFailure);
    const signals = stubPendingFetch();
    const controller = new AbortController();

    const pending = geocodeWithFallback("Warszawa", {}, controller.signal);
    await vi.waitFor(() => expect(signals).toHaveLength(1));
    controller.abort();

    await expect(pending).rejects.toBeInstanceOf(RateLimitError);
    expect(signals).toHaveLength(1);
  });

  it.each([
    ["geocodeAll", (signal: AbortSignal) => geocodeAll("Warszawa", {}, signal)],
    [
      "geocodeAddressAll",
      (signal: AbortSignal) => geocodeAddressAll({ city: "Warszawa" }, {}, signal),
    ],
    ["reverseAll", (signal: AbortSignal) => reverseAll(52.23, 21.01, {}, signal)],
  ])("cancels every request of %s", async (_name, run) => {
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "test-key");
    const signals = stubPendingFetch();
    const controller = new AbortController();

    const pending = run(controller.signal);
    await vi.waitFor(() => expect(signals).toHaveLength(2));
    controller.abort();
    const outcomes = await pending;

    expect(signals.every((signal) => signal.aborted)).toBe(true);
    expect(outcomes.every((outcome) => outcome.error)).toBe(true);
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
