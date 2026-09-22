import { describe, expect, it } from "vitest";
import {
  assertCoordinates,
  bearingBetween,
  distanceBetween,
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

describe("distanceBetween", () => {
  const warsaw = { latitude: 52.2297, longitude: 21.0122 };
  const krakow = { latitude: 50.0647, longitude: 19.945 };

  it("measures one degree along the equator as ~111.195 km", () => {
    const meters = distanceBetween({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 1 });
    expect(meters).toBeCloseTo(111195.08, 0);
  });

  it("measures one degree along a meridian identically", () => {
    const meters = distanceBetween({ latitude: 0, longitude: 0 }, { latitude: 1, longitude: 0 });
    expect(meters).toBeCloseTo(111195.08, 0);
  });

  /** Expected value cross-checked with an independent spherical-law-of-cosines implementation. */
  it("matches an independent implementation for Warsaw to Krakow", () => {
    expect(distanceBetween(warsaw, krakow)).toBeCloseTo(251976.9, 0);
  });

  it("is symmetric and zero for identical points", () => {
    expect(distanceBetween(warsaw, krakow)).toBe(distanceBetween(krakow, warsaw));
    expect(distanceBetween(warsaw, warsaw)).toBe(0);
  });

  it("handles antipodal points on the equator", () => {
    const meters = distanceBetween({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 180 });
    expect(meters).toBeCloseTo(20015114.4, 0);
  });

  it("keeps nearly antipodal distances finite despite rounding", () => {
    const from = { latitude: 49.03965844307095, longitude: -120.07562443614006 };
    const to = { latitude: -49.03965845245431, longitude: 59.92437556385994 };
    const meters = distanceBetween(from, to);
    expect(meters).toBeCloseTo(20015114.442, 0);
    expect(distanceBetween(to, from)).toBe(meters);
  });

  it("rejects out-of-range points before computing", () => {
    expect(() => distanceBetween({ latitude: 91, longitude: 0 }, warsaw)).toThrow(
      InvalidInputError,
    );
    expect(() => distanceBetween(warsaw, { latitude: 0, longitude: 181 })).toThrow(
      InvalidInputError,
    );
  });
});

describe("bearingBetween", () => {
  it("points at the cardinal directions exactly", () => {
    expect(bearingBetween({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 90 })).toBe(90);
    expect(bearingBetween({ latitude: 0, longitude: 0 }, { latitude: 90, longitude: 0 })).toBe(0);
    expect(bearingBetween({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: -10 })).toBe(
      270,
    );
    expect(bearingBetween({ latitude: 10, longitude: 0 }, { latitude: 0, longitude: 0 })).toBe(180);
  });

  /** Movable Type Scripts worked example: (35,45) toward (35,135) starts at 60.16 degrees. */
  it("matches the published worked example", () => {
    expect(
      bearingBetween({ latitude: 35, longitude: 45 }, { latitude: 35, longitude: 135 }),
    ).toBeCloseTo(60.16, 2);
  });

  it("rejects out-of-range points", () => {
    expect(() =>
      bearingBetween({ latitude: 91, longitude: 0 }, { latitude: 0, longitude: 0 }),
    ).toThrow(InvalidInputError);
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
