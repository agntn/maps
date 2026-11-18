import { describe, expect, it } from "vite-plus/test";
import {
  AuthError,
  HTTPError,
  MapsError,
  NotFoundError,
  PaymentError,
  RateLimitError,
  normalizeError,
} from "../../src/core/errors.ts";

describe("normalizeError", () => {
  it("passes existing MapsError instances through unchanged", () => {
    const original = new AuthError("googlemaps");
    expect(normalizeError(original, "googlemaps")).toBe(original);
  });

  it.each([
    [404, NotFoundError],
    [429, RateLimitError],
    [402, PaymentError],
    [401, AuthError],
    [403, AuthError],
    [500, HTTPError],
  ])("maps HTTP %i onto the matching error class", (status, expected) => {
    const normalized = normalizeError(new Error(`HTTP ${status} something failed`), "googlemaps");
    expect(normalized).toBeInstanceOf(expected);
    expect(normalized.provider).toBe("googlemaps");
  });

  it("wraps plain failures in the base class", () => {
    const normalized = normalizeError(new Error("boom"), "googlemaps");
    expect(normalized).toBeInstanceOf(MapsError);
    expect(normalized.name).toBe("MapsError");
  });
});

describe("URL sanitization", () => {
  it("redacts the Google Maps key query param", () => {
    const error = new MapsError(
      "HTTP 500 from https://maps.googleapis.com/maps/api/geocode/json?address=Warsaw&key=sekret",
    );
    expect(error.message).toContain("key=REDACTED");
    expect(error.message).not.toContain("sekret");
  });

  it("redacts secret params in HTTPError url and body", () => {
    const error = new HTTPError(
      500,
      "https://api.example/x?apiKey=sekret&x=1",
      "denied for ?token=sekret",
    );
    expect(error.message).toContain("apiKey=REDACTED");
    expect(error.rawUrl).toContain("apiKey=REDACTED");
    expect(error.body).toContain("token=REDACTED");
    expect(error.message).not.toContain("sekret");
  });
});
