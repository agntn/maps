import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { UnknownProviderError } from "../../src/core/errors.ts";
import { resolveProvider, selectProvider } from "../../src/core/resolve.ts";
import "../../src/providers/index.ts";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolveProvider", () => {
  it("honors an explicitly registered provider", () => {
    expect(resolveProvider("openstreetmap")).toBe("openstreetmap");
  });

  it("rejects an unknown explicit provider", () => {
    expect(() => resolveProvider("missing")).toThrow(UnknownProviderError);
  });

  it("prefers configured credentials before the keyless fallback", () => {
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "configured");

    expect(resolveProvider()).toBe("googlemaps");
  });

  it("defaults to OpenStreetMap when no credentials are configured", () => {
    expect(resolveProvider()).toBe("openstreetmap");
  });
});

describe("selectProvider", () => {
  it("returns a ready-to-use provider instance", () => {
    const selected = selectProvider("openstreetmap");
    expect(selected.name).toBe("openstreetmap");
    expect(selected.provider.name).toBe("openstreetmap");
  });

  it.each(["", "   "])("treats an empty-like provider as absent", (value) => {
    const selected = selectProvider(value);
    expect(selected.name).toBe("openstreetmap");
  });

  it("rejects an unknown explicit provider", () => {
    expect(() => selectProvider("missing")).toThrow(UnknownProviderError);
  });
});
