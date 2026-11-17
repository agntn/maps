import { describe, expect, it } from "vitest";
import {
  assertCoordinates,
  bearingBetween,
  distanceBetween,
  isValidCoordinates,
  isValidLatitude,
  isValidLongitude,
  parseCoordinates,
  rhumbBearingBetween,
  rhumbDistanceBetween,
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

/** Expected values from geodesy 2.4.0 `rhumbDistanceTo` and `rhumbBearingTo` on the same radius. */
const RHUMB_LINES = [
  {
    name: "Warsaw to Krakow",
    from: { latitude: 52.2297, longitude: 21.0122 },
    to: { latitude: 50.0647, longitude: 19.945 },
    meters: 251979.1353069291,
    bearing: 197.17912391554168,
  },
  {
    name: "Tokyo to Los Angeles, east across the antimeridian",
    from: { latitude: 35.6762, longitude: 139.6503 },
    to: { latitude: 34.0522, longitude: -118.2437 },
    meters: 9316938.558108708,
    bearing: 91.11057576846312,
  },
  {
    name: "Fiji, west across the antimeridian",
    from: { latitude: -17.7134, longitude: -178.065 },
    to: { latitude: -18.1416, longitude: 178.4419 },
    meters: 372610.33112149115,
    bearing: 262.65842845066135,
  },
  {
    name: "Dover to Calais",
    from: { latitude: 51.127, longitude: 1.338 },
    to: { latitude: 50.964, longitude: 1.853 },
    meters: 40307.8008732988,
    bearing: 116.72185980258678,
  },
] as const;

describe("rhumb lines", () => {
  it.each(RHUMB_LINES)("matches geodesy for $name", ({ from, to, meters, bearing }) => {
    expect(rhumbDistanceBetween(from, to)).toBeCloseTo(meters, 3);
    expect(rhumbBearingBetween(from, to)).toBeCloseTo(bearing, 9);
  });

  /** A quarter turn along the 35th parallel is R * cos(35 deg) * pi / 2. */
  it("runs due east along a parallel, longer than the great circle", () => {
    const from = { latitude: 35, longitude: 45 };
    const to = { latitude: 35, longitude: 135 };

    expect(rhumbBearingBetween(from, to)).toBe(90);
    expect(rhumbBearingBetween(to, from)).toBe(270);
    expect(rhumbDistanceBetween(from, to)).toBeCloseTo(8197710.9559, 3);
    expect(distanceBetween(from, to)).toBeCloseTo(7871779.972, 2);
  });

  it("is the great circle itself along a meridian", () => {
    const from = { latitude: -10, longitude: 30 };
    const to = { latitude: 25, longitude: 30 };

    expect(rhumbBearingBetween(from, to)).toBe(0);
    expect(rhumbDistanceBetween(from, to)).toBeCloseTo(distanceBetween(from, to), 6);
  });

  /** Both limits are the parallel itself: R * cos(35 deg) * pi / 2, and half the equator. */
  it("stays steady when the latitudes differ by a hair", () => {
    const from = { latitude: 35, longitude: 45 };
    const to = { latitude: 35.000000001, longitude: 135 };
    const equator = { latitude: 0, longitude: 0 };
    const across = { latitude: 1e-9, longitude: 180 };

    expect(rhumbDistanceBetween(from, to)).toBeCloseTo(8197710.956, 2);
    expect(rhumbDistanceBetween(to, from)).toBe(rhumbDistanceBetween(from, to));
    expect(rhumbDistanceBetween(equator, across)).toBeCloseTo(20015114.442, 2);
  });

  /** Every meridian ends at the pole, so the way there is the meridian arc: R * pi / 6. */
  it("climbs straight to a pole, whatever its longitude", () => {
    const north = { latitude: 90, longitude: 50 };
    const south = { latitude: -90, longitude: 50 };

    expect(rhumbDistanceBetween({ latitude: 60, longitude: 10 }, north)).toBeCloseTo(
      3335852.407,
      3,
    );
    expect(rhumbBearingBetween({ latitude: 60, longitude: 10 }, north)).toBe(0);
    expect(rhumbBearingBetween(north, { latitude: 60, longitude: 10 })).toBe(180);
    expect(rhumbDistanceBetween({ latitude: -60, longitude: 10 }, south)).toBe(
      rhumbDistanceBetween({ latitude: 60, longitude: 10 }, north),
    );
    expect(rhumbBearingBetween({ latitude: -60, longitude: 10 }, south)).toBe(180);
  });

  it("is zero between a point and itself, the south pole included", () => {
    const pole = { latitude: -90, longitude: 0 };

    expect(rhumbDistanceBetween(pole, pole)).toBe(0);
    expect(rhumbBearingBetween(pole, pole)).toBe(0);
    expect(rhumbDistanceBetween(RHUMB_LINES[0].from, RHUMB_LINES[0].from)).toBe(0);
  });

  it("rejects out-of-range points", () => {
    const origin = { latitude: 0, longitude: 0 };

    expect(() => rhumbDistanceBetween({ latitude: 91, longitude: 0 }, origin)).toThrow(
      InvalidInputError,
    );
    expect(() => rhumbBearingBetween(origin, { latitude: 0, longitude: 181 })).toThrow(
      InvalidInputError,
    );
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
