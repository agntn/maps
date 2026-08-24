import { describe, expect, it } from "vitest";
import {
  assertCoordinates,
  isValidCoordinates,
  isValidLatitude,
  isValidLongitude,
  parseCoordinates,
} from "../../src/core/coordinates.ts";
import { InvalidInputError } from "../../src/core/errors.ts";

describe("coordinate validation", () => {
  it.each([-90, -45.5, 0, 45.5, 90])("accepts latitude %d", (value) => {
    expect(isValidLatitude(value)).toBe(true);
  });

  it.each([-90.001, 90.001, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects latitude %d",
    (value) => {
      expect(isValidLatitude(value)).toBe(false);
    },
  );

  it.each([-180, -179.999, 0, 179.999, 180])("accepts longitude %d", (value) => {
    expect(isValidLongitude(value)).toBe(true);
  });

  it.each([-180.001, 180.001, Number.NaN, Number.NEGATIVE_INFINITY])(
    "rejects longitude %d",
    (value) => {
      expect(isValidLongitude(value)).toBe(false);
    },
  );

  it("validates the pair as a whole", () => {
    expect(isValidCoordinates(52.23, 21.01)).toBe(true);
    expect(isValidCoordinates(91, 21.01)).toBe(false);
    expect(isValidCoordinates(52.23, 181)).toBe(false);
  });

  it("throws InvalidInputError with the provider attributed", () => {
    expect(() => assertCoordinates(91, 0, "openstreetmap")).toThrow(InvalidInputError);
    try {
      assertCoordinates(0, -200, "openstreetmap");
      expect.unreachable();
    } catch (error) {
      expect(error).toMatchObject({ name: "InvalidInputError", provider: "openstreetmap" });
    }
  });
});

describe("parseCoordinates", () => {
  it("parses a comma-separated pair with optional whitespace", () => {
    expect(parseCoordinates("52.2318,21.0067")).toEqual({
      latitude: 52.2318,
      longitude: 21.0067,
    });
    expect(parseCoordinates(" -33.86 , 151.21 ")).toEqual({
      latitude: -33.86,
      longitude: 151.21,
    });
  });

  it.each(["", "52.23", "52.23,21.01,7", "abc,21.01", "52.23,", "91,0", "0,181"])(
    'rejects "%s"',
    (input) => {
      expect(() => parseCoordinates(input)).toThrow(InvalidInputError);
    },
  );
});
