import { afterEach, describe, expect, it, vi } from "vitest";
import {
  convertCoordinates,
  decodeCoordinates,
  detectCoordinateFormats,
  encodeCoordinates,
} from "../../src/core/convert.ts";
import { formatDdm, formatDms, parseDegrees } from "../../src/core/degrees.ts";
import { AuthError, InvalidInputError } from "../../src/core/errors.ts";
import { formatConversion } from "../../src/core/format.ts";
import {
  decodeGeohash,
  decodeMaidenhead,
  decodePlusCode,
  encodeGeohash,
  encodeMaidenhead,
  encodePlusCode,
} from "../../src/core/grids.ts";
import { decodeMgrs, encodeMgrs, fromUtm, toUtm } from "../../src/core/utm.ts";
import { stubJSON } from "../helpers.ts";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const warsaw = { latitude: 52.2297, longitude: 21.0122 };

describe("degrees", () => {
  it.each([
    ["52.2297, 21.0122", "decimal"],
    ["52.2297 21.0122", "decimal"],
    ["52.2297N 21.0122E", "decimal"],
    ["E 21.0122 N 52.2297", "decimal"],
    ["N 52° 13.782 E 021° 00.732", "ddm"],
    ["52 13.782, 21 0.732", "ddm"],
    [`52°13'46.92"N 21°0'43.92"E`, "dms"],
    ["52°13′46.92″N 21°0′43.92″E", "dms"],
    ["52 13 46.92 21 0 43.92", "dms"],
  ])("reads %s as %s", (input, notation) => {
    const parsed = parseDegrees(input);
    expect(parsed.notation).toBe(notation);
    expect(parsed.point.latitude).toBeCloseTo(warsaw.latitude, 5);
    expect(parsed.point.longitude).toBeCloseTo(warsaw.longitude, 5);
  });

  it("puts southern and western hemispheres below zero", () => {
    expect(parseDegrees(`33°51'24.5"S 151°12'55.1"E`).point.latitude).toBeCloseTo(-33.8568, 4);
    expect(parseDegrees("S 33 51.408 W 70 0").point).toEqual({
      latitude: expect.closeTo(-33.8568, 4),
      longitude: -70,
    });
  });

  it.each([
    [`52°61'0"N 21°0'0"E`, "below 60"],
    ["52.5 N 21.5 S", "one N/S and one E/W"],
    ["-52.5 S, 21 E", "either a minus sign or a hemisphere"],
    ["52.5 13 N 21 E", "Only the last part"],
    ["91, 0", "latitude must be"],
    ["52 13 21", "same number of parts"],
    ["52°, 21° x", 'Unexpected "x"'],
  ])("rejects %s", (input, reason) => {
    expect(() => parseDegrees(input)).toThrow(reason);
  });

  it("carries rounded seconds and minutes into the next unit", () => {
    expect(formatDms({ latitude: 51.99999, longitude: 20.99999 }, 0)).toBe(`52°0'0"N 21°0'0"E`);
    expect(formatDdm({ latitude: -0.0000001, longitude: 0 })).toBe("N 00° 00.000' E 000° 00.000'");
  });
});

describe("geohash", () => {
  it("decodes the Wikipedia example ezs42", () => {
    const { center, bounds } = decodeGeohash("ezs42");
    expect(center.latitude).toBeCloseTo(42.605, 3);
    expect(center.longitude).toBeCloseTo(-5.603, 3);
    expect(bounds).toEqual({
      south: 42.5830078125,
      north: 42.626953125,
      west: -5.625,
      east: -5.5810546875,
    });
  });

  it.each([
    [warsaw, "u3qcnhhs5"],
    [{ latitude: -33.8568, longitude: 151.2153 }, "r3gx2ux9g"],
    [{ latitude: -16.5, longitude: -179.99 }, "2j040hr29"],
  ])("matches ngeohash for %o", (point, code) => {
    expect(encodeGeohash(point)).toBe(code);
    expect(decodeGeohash(code.toUpperCase()).center.latitude).toBeCloseTo(point.latitude, 4);
  });

  it("names the character a geohash never uses", () => {
    expect(() => decodeGeohash("ezs4a")).toThrow('"a" is not a geohash character');
  });
});

describe("Maidenhead", () => {
  it("puts Warsaw in KO02", () => {
    expect(encodeMaidenhead(warsaw, 4)).toBe("KO02");
    expect(encodeMaidenhead(warsaw)).toBe("KO02mf");
  });

  it("decodes a subsquare to its cell", () => {
    const { center, bounds } = decodeMaidenhead("jn58TD");
    expect(center.latitude).toBeCloseTo(48.1458, 4);
    expect(center.longitude).toBeCloseTo(11.625, 4);
    expect(bounds.north - bounds.south).toBeCloseTo(1 / 24, 9);
    expect(bounds.east - bounds.west).toBeCloseTo(1 / 12, 9);
  });

  it("keeps the north pole and the antimeridian inside the grid", () => {
    expect(encodeMaidenhead({ latitude: 90, longitude: 180 }, 8)).toBe("AR09ax09");
    expect(() => encodeMaidenhead(warsaw, 5)).toThrow("2, 4, 6, 8 or 10");
    expect(() => decodeMaidenhead("SO02")).toThrow("not a Maidenhead locator");
  });
});

/** Rows from google/open-location-code test_data, read against the reference encoder. */
describe("Plus Codes", () => {
  it.each([
    [20.3700625, 2.7821875, 10, "7FG49QCJ+2V"],
    [20.3701135, 2.78223535156, 13, "7FG49QCJ+2VXGJ"],
    [47.0000625, 8.0000625, 10, "8FVC2222+22"],
    [-28.1217794010122, -154.066811473758, 15, "5337VWHM+77PR2GR"],
    [37.539669125, -122.375069724, 2, "84000000+"],
    [90, 1, 10, "CFX3X2X2+X2"],
  ])("encodes %d, %d at %d digits as %s", (latitude, longitude, length, code) => {
    expect(encodePlusCode({ latitude, longitude }, length)).toBe(code);
  });

  it.each([
    ["7FG49Q00+", 20.35, 2.75, 20.4, 2.8],
    ["7FG49QCJ+2VX", 20.3701, 2.78221875, 20.370125, 2.78225],
    ["8fwc2345+", 48.005, 8.0575, 48.0075, 8.06],
  ])("decodes %s to its cell", (code, south, west, north, east) => {
    const { bounds } = decodePlusCode(code);
    expect(bounds.south).toBeCloseTo(south, 9);
    expect(bounds.west).toBeCloseTo(west, 9);
    expect(bounds.north).toBeCloseTo(north, 9);
    expect(bounds.east).toBeCloseTo(east, 9);
  });

  it.each(["G+", "+", "8FWC2345+G", "8FWC2_45+G6", "8FWC2345+G6+", "8FWC2300+G6", "84900000+"])(
    "rejects %s",
    (code) => {
      expect(() => decodePlusCode(code)).toThrow("is not a Plus Code");
    },
  );

  it("asks for a reference before reading a short code", () => {
    expect(() => decodePlusCode("CJ+2VX")).toThrow("pass a reference point");
  });

  it.each([
    ["CJ+2VX", 51.3708675, -1.217765625],
    ["CJ+2VX", 51.3701125, -1.217010625],
    ["+2VX", 51.3701125, -1.217765625],
  ])("recovers %s near %d, %d", (short, latitude, longitude) => {
    const recovered = decodePlusCode(short, { latitude, longitude });
    expect(recovered.center).toEqual(decodePlusCode("9C3W9QCJ+2VX").center);
  });
});

/** Expected values come from GeographicLib, which pads the zone to two digits. */
describe("UTM and MGRS", () => {
  it.each([
    [warsaw, "34U EC 00833 86586", 34, 500833.243, 5786586.672],
    [{ latitude: -33.8568, longitude: 151.2153 }, "56H LH 34900 52288", 56, 334900.57, 6252288.753],
    [{ latitude: 60.39299, longitude: 5.32415 }, "32V KN 97477 00830", 32, 297477.307, 6700830.064],
    [{ latitude: 78.2232, longitude: 15.6267 }, "33X WG 14278 83355", 33, 514278.715, 8683355.47],
    [{ latitude: 80, longitude: 40 }, "37X EJ 19384 81752", 37, 519384.803, 8881752.416],
    [{ latitude: -16.5, longitude: -179.99 }, "1K AB 80780 73388", 1, 180780.516, 8173388.922],
    [{ latitude: -0.0001, longitude: 0.0001 }, "31M AV 66032 99988", 31, 166032.586, 9999988.932],
    [{ latitude: 83.99, longitude: -40.5 }, "24X VU 82467 27205", 24, 482467.742, 9327205.71],
  ])("projects %o", (point, mgrs, zone, easting, northing) => {
    const utm = toUtm(point);
    expect(utm.zone).toBe(zone);
    expect(utm.easting).toBeCloseTo(easting, 2);
    expect(utm.northing).toBeCloseTo(northing, 2);
    expect(encodeMgrs(point)).toBe(mgrs);
    const back = fromUtm(utm);
    expect(back.latitude).toBeCloseTo(point.latitude, 7);
    expect(back.longitude).toBeCloseTo(point.longitude, 7);
  });

  it("truncates MGRS digits like the grid does", () => {
    expect(encodeMgrs(warsaw, 4)).toBe("34U EC 0083 8658");
    expect(encodeMgrs(warsaw, 0)).toBe("34U EC");
  });

  it("decodes a square to the same center as GeographicLib", () => {
    const { center, bounds } = decodeMgrs("34UEC00838658");
    expect(center.latitude).toBeCloseTo(52.22968497, 7);
    expect(center.longitude).toBeCloseTo(21.01222572, 7);
    expect(bounds.south).toBeLessThan(center.latitude);
    expect(bounds.east).toBeGreaterThan(center.longitude);
    expect(decodeMgrs("56HLH3490052288").center.latitude).toBeCloseTo(-33.8568, 4);
    expect(decodeMgrs("33XWG").center.longitude).toBeCloseTo(17.1401, 3);
    const wrapped = decodeMgrs("60S YC").bounds;
    expect(wrapped.west).toBeCloseTo(179.151, 3);
    expect(wrapped.east).toBeCloseTo(-179.7406, 3);
  });

  it("refuses the polar caps and a square outside its band", () => {
    expect(() => toUtm({ latitude: 84.5, longitude: 0 })).toThrow("UPS");
    expect(() => decodeMgrs("34UEC123")).toThrow("not an MGRS reference");
    expect(() => decodeMgrs("33XWR")).toThrow("outside band X");
    expect(() => decodeMgrs("34UJC00838658")).toThrow("does not occur in MGRS zone 34");
    expect(() => fromUtm({ zone: 34, band: "U", easting: 500000, northing: 0 })).toThrow(
      "outside band U",
    );
    expect(
      fromUtm({ zone: 34, band: "T", easting: 500000, northing: 5318000 }).latitude,
    ).toBeCloseTo(48, 1);
  });
});

describe("format detection", () => {
  it.each([
    ["ezs42", ["geohash"]],
    ["0", ["geohash"]],
    ["KO02mf", ["maidenhead"]],
    ["jn58td", ["maidenhead", "geohash"]],
    ["8FVC2222+22", ["pluscode"]],
    ["CJ+2VX", ["pluscode"]],
    ["34U 500000 5786000", ["utm"]],
    ["34U EC 0083 8658", ["mgrs"]],
    ["///filled.count.soap", ["what3words"]],
    ["N 52° 13.782 E 021° 00.732", ["ddm"]],
    ["+52.2297, +21.0122", ["decimal"]],
    ["hello", []],
  ])("detects %s", (input, formats) => {
    expect(detectCoordinateFormats(input)).toEqual(formats);
  });

  it("asks for the format when a code reads two ways", () => {
    expect(() => decodeCoordinates("jn58td")).toThrow("reads as maidenhead or geohash");
    expect(decodeCoordinates("jn58td", { from: "geohash" }).format).toBe("geohash");
  });

  it("explains what broke in a degree pair instead of giving up on the format", () => {
    expect(() => decodeCoordinates(`52°61'0"N 21°0'0"E`)).toThrow("below 60");
    expect(() => decodeCoordinates("hello")).toThrow("Could not tell the format");
    expect(() => decodeCoordinates("8FWC2345+G")).toThrow("single digit after the +");
  });

  it("checks precision against each format's range", () => {
    expect(encodeCoordinates(warsaw, "decimal", 2)).toBe("52.23, 21.01");
    expect(() => encodeCoordinates(warsaw, "dms", 7)).toThrow(
      "dms precision is one of 0, 1, 2, 3, 4, got 7",
    );
    for (const format of ["decimal", "dms", "ddm"] as const) {
      expect(() => encodeCoordinates({ latitude: 100, longitude: 200 }, format)).toThrow(
        "latitude must be",
      );
    }
    expect(() => encodeCoordinates(warsaw, "pluscode", 9)).toThrow(
      "pluscode precision is one of 2, 4, 6, 8, 10, 11",
    );
  });
});

describe("convertCoordinates", () => {
  it("writes a geohash cell in every local format", async () => {
    const conversion = await convertCoordinates("ezs42");
    expect(conversion).toMatchObject({
      input: "ezs42",
      format: "geohash",
      canonical: "ezs42",
      bounds: { south: 42.5830078125 },
    });
    expect(conversion.formats).toEqual({
      decimal: "42.604980, -5.603027",
      dms: `42°36'17.9"N 5°36'10.9"W`,
      ddm: "N 42° 36.299' W 005° 36.182'",
      geohash: "ezs42",
      maidenhead: "IN72eo",
      pluscode: "8CJPJ93W+XQ",
      utm: "30T 286471 4720235",
      mgrs: "30T TN 86471 20234",
    });
    expect(conversion.skipped).toBeUndefined();
  });

  it("matches its documented example", async () => {
    const result = await convertCoordinates("ezs42", { to: ["decimal", "maidenhead"] });
    expect(result.formats).toEqual({ decimal: "42.604980, -5.603027", maidenhead: "IN72eo" });
  });

  it("re-encodes the input format only when a precision asks for it", async () => {
    const result = await convertCoordinates("KO02mf", {
      to: ["maidenhead", "geohash"],
      precision: { geohash: 4 },
    });
    expect(result.formats).toEqual({ maidenhead: "KO02mf", geohash: "u3qc" });
    const shorter = await convertCoordinates("KO02mf", {
      to: ["maidenhead"],
      precision: { maidenhead: 4 },
    });
    expect(shorter.formats.maidenhead).toBe("KO02");
  });

  it("refuses a precision the format lacks even when no format was asked for", async () => {
    await expect(convertCoordinates("KO02", { precision: { maidenhead: 3 } })).rejects.toThrow(
      "maidenhead precision is one of 2, 4, 6, 8, 10, got 3",
    );
    await expect(
      convertCoordinates("KO02", { precision: { what3words: 1 } as never }),
    ).rejects.toThrow("what3words has no precision");
  });

  it("skips a format the point does not fit unless it was asked for", async () => {
    const pole = await convertCoordinates("90, 0");
    expect(pole.skipped).toEqual({
      utm: expect.stringContaining("UPS"),
      mgrs: expect.stringContaining("UPS"),
    });
    expect(pole.formats.utm).toBeUndefined();
    await expect(convertCoordinates("90, 0", { to: ["utm"] })).rejects.toThrow("UPS");
  });

  it("refuses an empty input, a runaway one and an unknown format", async () => {
    await expect(convertCoordinates("  ")).rejects.toThrow(InvalidInputError);
    await expect(convertCoordinates("5".repeat(257))).rejects.toThrow("256 characters at most");
    expect(() => decodeCoordinates("5".repeat(257))).toThrow("256 characters at most");
    await expect(
      convertCoordinates("ezs42", { to: ["geohash", "w3w" as "geohash"] }),
    ).rejects.toThrow('Unknown coordinate format "w3w"');
  });

  it("prints one line per format", async () => {
    const text = formatConversion(await convertCoordinates("90, 0", { precision: { decimal: 1 } }));
    expect(text.split("\n")[0]).toBe("decimal 90.000000, 0.000000 -> 90, 0");
    expect(text).toContain("  decimal     90.0, 0.0");
    expect(text).toContain("  mgrs        (skipped: UTM and MGRS cover");
  });
});

describe("what3words", () => {
  const square = {
    country: "GB",
    square: {
      southwest: { lng: -0.195543, lat: 51.520833 },
      northeast: { lng: -0.195499, lat: 51.52086 },
    },
    nearestPlace: "Bayswater, London",
    coordinates: { lng: -0.195521, lat: 51.520847 },
    words: "filled.count.soap",
    language: "en",
    map: "https://w3w.co/filled.count.soap",
  };

  it("needs a key before any request", async () => {
    const fetch = stubJSON(square);
    await expect(convertCoordinates("///filled.count.soap")).rejects.toThrow(AuthError);
    await expect(convertCoordinates("52.2297, 21.0122", { to: ["what3words"] })).rejects.toThrow(
      "set WHAT3WORDS_API_KEY",
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("leaves what3words out of a default conversion without a key", async () => {
    const result = await convertCoordinates("52.2297, 21.0122");
    expect(result.formats.what3words).toBeUndefined();
    expect(result.skipped).toBeUndefined();
  });

  it("reads three words with the key in a header, never in the URL", async () => {
    vi.stubEnv("WHAT3WORDS_API_KEY", "secret-key");
    const fetch = stubJSON(square);
    const result = await convertCoordinates("///filled.count.soap", { to: ["decimal"] });
    expect(result).toMatchObject({
      format: "what3words",
      canonical: "filled.count.soap",
      center: { latitude: 51.520847, longitude: -0.195521 },
      bounds: { south: 51.520833, north: 51.52086, west: -0.195543, east: -0.195499 },
      formats: { decimal: "51.520847, -0.195521" },
    });
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://api.what3words.com/v3/convert-to-coordinates?words=filled.count.soap",
    );
    expect(new Headers(init.headers).get("X-Api-Key")).toBe("secret-key");
  });

  it("adds three words to a default conversion when a key is set", async () => {
    vi.stubEnv("WHAT3WORDS_API_KEY", "secret-key");
    const fetch = stubJSON(square);
    const result = await convertCoordinates("51.520847, -0.195521", { language: "pl" });
    expect(result.formats.what3words).toBe("filled.count.soap");
    const [url] = fetch.mock.calls[0] as [string];
    expect(url).toBe(
      "https://api.what3words.com/v3/convert-to-3wa?coordinates=51.520847%2C-0.195521&language=pl",
    );
  });

  it("keeps the local formats when the optional what3words call fails", async () => {
    vi.stubEnv("WHAT3WORDS_API_KEY", "secret-key");
    stubJSON({ error: { code: "QuotaExceeded", message: "quota" } }, 402);
    const result = await convertCoordinates("52.2297, 21.0122");
    expect(result.formats.maidenhead).toBe("KO02mf");
    expect(result.skipped).toEqual({ what3words: expect.stringContaining("Payment required") });
    await expect(convertCoordinates("52.2297, 21.0122", { to: ["what3words"] })).rejects.toThrow(
      "Payment required",
    );
  });

  it("lets the caller's abort through instead of skipping three words", async () => {
    vi.stubEnv("WHAT3WORDS_API_KEY", "secret-key");
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("aborted", "AbortError");
      }),
    );
    await expect(
      convertCoordinates("52.2297, 21.0122", { signal: controller.signal }),
    ).rejects.toThrow();
  });

  it("passes the what3words reason through for unknown words", async () => {
    vi.stubEnv("WHAT3WORDS_API_KEY", "secret-key");
    stubJSON({ error: { code: "BadWords", message: "words must be a valid 3 word address" } }, 400);
    await expect(convertCoordinates("filled.count.nope")).rejects.toThrow(
      "what3words BadWords: words must be a valid 3 word address",
    );
  });

  it("reports a rejected key as an auth failure", async () => {
    vi.stubEnv("WHAT3WORDS_API_KEY", "wrong");
    stubJSON(
      { error: { code: "InvalidKey", message: "Authentication failed; invalid API key" } },
      401,
    );
    await expect(convertCoordinates("filled.count.soap")).rejects.toThrow(AuthError);
  });
});
