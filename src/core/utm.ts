/** UTM and MGRS on WGS 84 via Krüger's series, about a millimeter off inside a zone. */

import { assertCoordinates, type GeoPoint } from "./coordinates.ts";
import { InvalidInputError } from "./errors.ts";
import type { BoundingBox } from "./types.ts";

/** A UTM position: zone 1-60, latitude band letter, meters east and north. */
export interface UtmPosition {
  zone: number;
  band: string;
  easting: number;
  northing: number;
}

const SEMI_MAJOR_AXIS = 6_378_137;
const FLATTENING = 1 / 298.257_223_563;
const SCALE = 0.9996;
const FALSE_EASTING = 500_000;
const FALSE_NORTHING_SOUTH = 10_000_000;

const N = FLATTENING / (2 - FLATTENING);
const ECCENTRICITY = (2 * Math.sqrt(N)) / (1 + N);
const RECTIFYING_RADIUS = (SEMI_MAJOR_AXIS / (1 + N)) * (1 + N ** 2 / 4 + N ** 4 / 64);
const ALPHA = [
  N / 2 - (2 / 3) * N ** 2 + (5 / 16) * N ** 3,
  (13 / 48) * N ** 2 - (3 / 5) * N ** 3,
  (61 / 240) * N ** 3,
];
const BETA = [
  N / 2 - (2 / 3) * N ** 2 + (37 / 96) * N ** 3,
  (1 / 48) * N ** 2 + (1 / 15) * N ** 3,
  (17 / 480) * N ** 3,
];
const DELTA = [
  2 * N - (2 / 3) * N ** 2 - 2 * N ** 3,
  (7 / 3) * N ** 2 - (8 / 5) * N ** 3,
  (56 / 15) * N ** 3,
];

/** Degrees past 80°S or 84°N still read as the edge, so an inverse projection's roundoff fits. */
const EDGE_ROUNDOFF = 1e-6;

/** Bands C to X, 8° each from 80°S, with X stretched to 84°N. */
const BANDS = "CDEFGHJKLMNPQRSTUVWX";

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;
const toDegrees = (radians: number): number => (radians * 180) / Math.PI;

/**
 * Longitude down the middle of a zone.
 *
 * @param zone - Zone 1 to 60.
 * @returns {number} Its central meridian.
 */
function centralMeridian(zone: number): number {
  return zone * 6 - 183;
}

/**
 * Band letter of a latitude inside UTM's range.
 *
 * @param latitude - Latitude from 80°S to 84°N.
 * @returns {string} A letter C to X.
 */
function bandOf(latitude: number): string {
  return BANDS[Math.min(Math.floor((latitude + 80) / 8), BANDS.length - 1)] as string;
}

/** Svalbard from 72°N: west edge, east edge and the widened zone that covers them. */
const SVALBARD_ZONES = [
  [0, 9, 31],
  [9, 21, 33],
  [21, 33, 35],
  [33, 42, 37],
] as const;

/**
 * The widened zone over Svalbard, for a point from 72°N up.
 *
 * @param longitude - Longitude of the point.
 * @returns {number | undefined} Zone 31, 33, 35 or 37, or nothing outside them.
 */
function svalbardZone(longitude: number): number | undefined {
  return SVALBARD_ZONES.find(([west, east]) => longitude >= west && longitude < east)?.[2];
}

/**
 * The standard zone, with the Norway (32V) and Svalbard (31X-37X) exceptions.
 *
 * @param latitude - Latitude inside UTM's range.
 * @param longitude - Longitude from -180 up to 180.
 * @returns {number} Zone 1 to 60.
 */
function zoneOf(latitude: number, longitude: number): number {
  if (latitude >= 56 && latitude < 64 && longitude >= 3 && longitude < 12) return 32;
  const svalbard = latitude >= 72 ? svalbardZone(longitude) : undefined;
  return svalbard ?? Math.min(Math.floor((longitude + 180) / 6) + 1, 60);
}

/**
 * Easting and northing of a point projected on a given zone's meridian.
 *
 * @param latitude - Latitude in degrees.
 * @param longitude - Longitude in degrees.
 * @param zone - Zone to project on.
 * @returns {[number, number]} Easting and northing in meters.
 */
function project(latitude: number, longitude: number, zone: number): [number, number] {
  const phi = toRadians(latitude);
  const lambda = toRadians(longitude - centralMeridian(zone));
  const t = Math.sinh(
    Math.atanh(Math.sin(phi)) - ECCENTRICITY * Math.atanh(ECCENTRICITY * Math.sin(phi)),
  );
  const xi = Math.atan2(t, Math.cos(lambda));
  const eta = Math.atanh(Math.sin(lambda) / Math.sqrt(1 + t * t));
  let x = eta;
  let y = xi;
  ALPHA.forEach((alpha, index) => {
    const j = 2 * (index + 1);
    x += alpha * Math.cos(j * xi) * Math.sinh(j * eta);
    y += alpha * Math.sin(j * xi) * Math.cosh(j * eta);
  });
  const northing = SCALE * RECTIFYING_RADIUS * y;
  return [
    FALSE_EASTING + SCALE * RECTIFYING_RADIUS * x,
    latitude < 0 ? northing + FALSE_NORTHING_SOUTH : northing,
  ];
}

/**
 * UTM position of a point. UTM stops at 80°S and 84°N; the poles belong to UPS.
 *
 * @param point - The point to project.
 * @returns {UtmPosition} Its zone, band and meters.
 * @throws {InvalidInputError} When the point is out of range or outside UTM's latitudes.
 */
export function toUtm(point: GeoPoint): UtmPosition {
  assertCoordinates(point.latitude, point.longitude);
  if (point.latitude < -80 - EDGE_ROUNDOFF || point.latitude > 84 + EDGE_ROUNDOFF) {
    throw new InvalidInputError(
      `UTM and MGRS cover 80°S to 84°N, got latitude ${point.latitude}; the polar caps use UPS`,
    );
  }
  const latitude = Math.min(Math.max(point.latitude, -80), 84);
  const longitude = point.longitude === 180 ? -180 : point.longitude;
  const zone = zoneOf(latitude, longitude);
  const [easting, northing] = project(latitude, longitude, zone);
  return { zone, band: bandOf(latitude), easting, northing };
}

/**
 * Point at a UTM position. Bands N to X are north of the equator, C to M south of it.
 *
 * @param position - Zone, band and meters.
 * @returns {GeoPoint} The point.
 * @throws {InvalidInputError} When the zone, band or meters are out of range.
 */
export function fromUtm(position: UtmPosition): GeoPoint {
  const { zone, band, easting, northing } = checkUtm(position);
  const point = inverse(zone, band, easting, northing);
  assertBand(point.latitude, band, 0.5, `UTM position ${zone}${band} ${easting} ${northing}`);
  return point;
}

/**
 * Whether meters sit between zero and `max`. A NaN doesn't.
 *
 * @param value - Meters to check.
 * @param max - The upper edge.
 * @returns {boolean} True inside the range.
 */
function within(value: number, max: number): boolean {
  return value >= 0 && value <= max;
}

/**
 * The position with an upper case band, once zone, band and meters are in range.
 *
 * @param position - The position as given.
 * @returns {UtmPosition} The checked position.
 * @throws {InvalidInputError} When the zone, band or meters are out of range.
 */
function checkUtm(position: UtmPosition): UtmPosition {
  const { zone, easting, northing } = position;
  const band = position.band.toUpperCase();
  if (!Number.isInteger(zone) || zone < 1 || zone > 60) {
    throw new InvalidInputError(`UTM zone runs from 1 to 60, got ${zone}`);
  }
  if (band.length !== 1 || !BANDS.includes(band)) {
    throw new InvalidInputError(
      `UTM latitude band is a letter C-X without I and O, got "${position.band}"`,
    );
  }
  if (!within(easting, 1_000_000) || !within(northing, FALSE_NORTHING_SOUTH)) {
    throw new InvalidInputError(
      `UTM easting runs 0-1000000 m and northing 0-10000000 m, got ${easting} ${northing}`,
    );
  }
  return { zone, band, easting, northing };
}

/**
 * Throws unless the latitude sits in the band, give or take `slack` degrees.
 *
 * @param latitude - Latitude that came out.
 * @param band - Band it should sit in.
 * @param slack - Degrees of tolerance.
 * @param what - The input in words, for the error.
 * @throws {InvalidInputError} When the latitude is outside the band.
 */
function assertBand(latitude: number, band: string, slack: number, what: string): void {
  const south = BANDS.indexOf(band) * 8 - 80;
  const north = band === "X" ? 84 : south + 8;
  if (latitude < south - slack || latitude > north + slack) {
    throw new InvalidInputError(
      `${what} lands at latitude ${latitude.toFixed(4)}, outside band ${band}`,
    );
  }
}

/**
 * West and east around `center`; a box over the antimeridian keeps west > east, as in GeoJSON.
 *
 * @param longitudes - Longitudes of the corners.
 * @param center - Longitude of the middle.
 * @returns {{ west: number; east: number }} The two edges.
 */
function longitudeSpan(
  longitudes: readonly number[],
  center: number,
): { west: number; east: number } {
  const offsets = longitudes.map(
    (longitude) => ((((longitude - center + 180) % 360) + 360) % 360) - 180,
  );
  const wrap = (longitude: number): number => ((((longitude + 180) % 360) + 360) % 360) - 180;
  return { west: wrap(center + Math.min(...offsets)), east: wrap(center + Math.max(...offsets)) };
}

/**
 * Krüger's inverse on one zone, with the band deciding only the hemisphere.
 *
 * @param zone - Zone 1 to 60.
 * @param band - Latitude band letter.
 * @param easting - Meters east.
 * @param northing - Meters north.
 * @returns {GeoPoint} The point.
 */
function inverse(zone: number, band: string, easting: number, northing: number): GeoPoint {
  const south = band < "N";
  const xi = (northing - (south ? FALSE_NORTHING_SOUTH : 0)) / (SCALE * RECTIFYING_RADIUS);
  const eta = (easting - FALSE_EASTING) / (SCALE * RECTIFYING_RADIUS);
  let xiPrime = xi;
  let etaPrime = eta;
  BETA.forEach((beta, index) => {
    const j = 2 * (index + 1);
    xiPrime -= beta * Math.sin(j * xi) * Math.cosh(j * eta);
    etaPrime -= beta * Math.cos(j * xi) * Math.sinh(j * eta);
  });
  const chi = Math.asin(Math.sin(xiPrime) / Math.cosh(etaPrime));
  let phi = chi;
  DELTA.forEach((delta, index) => {
    phi += delta * Math.sin(2 * (index + 1) * chi);
  });
  const longitude =
    centralMeridian(zone) + toDegrees(Math.atan2(Math.sinh(etaPrime), Math.cos(xiPrime)));
  return {
    latitude: toDegrees(phi),
    longitude: ((((longitude + 180) % 360) + 360) % 360) - 180,
  };
}

/**
 * `34U 500000 5786000`, `decimals` places on the meters.
 *
 * @param position - Zone, band and meters.
 * @param decimals - Places on the meters.
 * @returns {string} The text.
 */
export function formatUtm(position: UtmPosition, decimals = 0): string {
  return `${position.zone}${position.band} ${position.easting.toFixed(decimals)} ${position.northing.toFixed(decimals)}`;
}

const UTM_PATTERN =
  /^(\d{1,2})\s*([C-HJ-NP-X])\s+(\d+(?:\.\d+)?)\s*(?:m\s*E|E)?\s+(\d+(?:\.\d+)?)\s*(?:m\s*N|N)?$/i;

/**
 * True when the text has the shape of a UTM position (zone, band, easting, northing).
 *
 * @param text - Candidate text.
 * @returns {boolean} Whether it has the shape.
 */
export function isUtm(text: string): boolean {
  return UTM_PATTERN.test(text.trim());
}

/**
 * Read `34U 500000 5786000` (an `mE`/`mN` suffix is fine). The letter is the latitude band.
 *
 * @param text - The position as written.
 * @returns {UtmPosition} Zone, band and meters.
 * @throws {InvalidInputError} When the text is not a UTM position.
 */
export function parseUtm(text: string): UtmPosition {
  const match = UTM_PATTERN.exec(text.trim());
  if (!match) {
    throw new InvalidInputError(
      `"${text}" is not a UTM position; write zone, latitude band, easting and northing, for example 34U 500000 5786000`,
    );
  }
  const [, zone, band, easting, northing] = match as unknown as [
    string,
    string,
    string,
    string,
    string,
  ];
  return checkUtm({
    zone: Number(zone),
    band,
    easting: Number(easting),
    northing: Number(northing),
  });
}

/** MGRS 100 km column letters, one set per zone modulo 3. */
const MGRS_COLUMNS = ["ABCDEFGH", "JKLMNPQR", "STUVWXYZ"];
/** MGRS 100 km row letters; even zones start five letters in. */
const MGRS_ROWS = "ABCDEFGHJKLMNPQRSTUV";

/**
 * MGRS reference of a point, `digits` per axis (5 is a meter, 0 the 100 km square).
 *
 * @example
 *   ```ts
 *   encodeMgrs({ latitude: 52.2297, longitude: 21.0122 }, 4); // "34U EC 0083 8658"
 *   ```
 *
 * @param point - The point to encode.
 * @param digits - Digits per axis.
 * @returns {string} The reference.
 * @throws {InvalidInputError} When the point lies outside UTM or `digits` is not 0-5.
 */
export function encodeMgrs(point: GeoPoint, digits = 5): string {
  if (!Number.isInteger(digits) || digits < 0 || digits > 5) {
    throw new InvalidInputError(`MGRS precision runs from 0 to 5 digits per axis, got ${digits}`);
  }
  const { zone, band, easting, northing } = toUtm(point);
  const set = (zone - 1) % 3;
  const column = MGRS_COLUMNS[set]?.[Math.floor(easting / 100_000) - 1];
  const row = MGRS_ROWS[(Math.floor(northing / 100_000) + (zone % 2 === 0 ? 5 : 0)) % 20];
  const unit = 10 ** (5 - digits);
  const east = String(Math.floor((easting % 100_000) / unit)).padStart(digits, "0");
  const north = String(Math.floor((northing % 100_000) / unit)).padStart(digits, "0");
  return digits === 0
    ? `${zone}${band} ${column}${row}`
    : `${zone}${band} ${column}${row} ${east} ${north}`;
}

const MGRS_PATTERN = /^(\d{1,2})([C-HJ-NP-X])([A-HJ-NP-Z])([A-HJ-NP-V])(\d*)$/i;

/**
 * True when the text has the shape of an MGRS reference.
 *
 * @param text - Candidate text.
 * @returns {boolean} Whether it has the shape.
 */
export function isMgrs(text: string): boolean {
  const compact = text.replaceAll(/\s+/g, "");
  const match = MGRS_PATTERN.exec(compact);
  return (
    match !== null && (match[5] as string).length % 2 === 0 && (match[5] as string).length <= 10
  );
}

/** An MGRS reference in meters: the corner of its square nearest the origin, and its side. */
interface MgrsSquare {
  readonly zone: number;
  readonly band: string;
  /** The two 100 km square letters. */
  readonly letters: string;
  readonly easting: number;
  /** Northing inside the 2000 km row cycle, before the band picks the cycle. */
  readonly northing: number;
  readonly size: number;
}

/** The five groups of `MGRS_PATTERN`; a match always has them all. */
type MgrsParts = readonly [string, string, string, string, string];

/**
 * Match a reference against the MGRS shape.
 *
 * @param text - The reference as written.
 * @returns {MgrsParts} Zone, band, column letter, row letter and digits.
 * @throws {InvalidInputError} When the text is not an MGRS reference.
 */
function matchMgrs(text: string): MgrsParts {
  const match = MGRS_PATTERN.exec(text.replaceAll(/\s+/g, "").toUpperCase());
  const numbers = match?.[5] ?? "";
  if (!match || numbers.length % 2 !== 0 || numbers.length > 10) {
    throw new InvalidInputError(
      `"${text}" is not an MGRS reference; write zone, band, two square letters and an even number of digits, for example 34U EC 0083 8658`,
    );
  }
  return match.slice(1) as unknown as MgrsParts;
}

/**
 * Read a reference into meters on its zone.
 *
 * @param text - The reference as written.
 * @returns {MgrsSquare} The square, its northing still inside one row cycle.
 * @throws {InvalidInputError} When the reference is malformed.
 */
function readMgrs(text: string): MgrsSquare {
  const [zoneText, band, column, row, numbers] = matchMgrs(text);
  const zone = Number(zoneText);
  if (zone < 1 || zone > 60)
    throw new InvalidInputError(`MGRS zone runs from 1 to 60, got ${zone}`);
  const columnIndex = (MGRS_COLUMNS[(zone - 1) % 3] as string).indexOf(column);
  if (columnIndex < 0) {
    throw new InvalidInputError(`Column letter ${column} does not occur in MGRS zone ${zone}`);
  }
  const rowIndex = (MGRS_ROWS.indexOf(row) - (zone % 2 === 0 ? 5 : 0) + 20) % 20;
  const digits = numbers.length / 2;
  const size = 10 ** (5 - digits);
  return {
    zone,
    band,
    letters: `${column}${row}`,
    easting: (columnIndex + 1) * 100_000 + Number(numbers.slice(0, digits) || 0) * size,
    northing: rowIndex * 100_000 + Number(numbers.slice(digits) || 0) * size,
    size,
  };
}

/**
 * The square an MGRS reference names, spaces optional (`34UEC00838658` or `34U EC 0083 8658`).
 * Row letters repeat every 2000 km, so the latitude band picks the cycle.
 *
 * @param text - The reference as written.
 * @returns {{ center: GeoPoint; bounds: BoundingBox }} The square and its middle.
 * @throws {InvalidInputError} When the reference is malformed or falls outside its latitude band.
 */
export function decodeMgrs(text: string): { center: GeoPoint; bounds: BoundingBox } {
  const { zone, band, letters, easting, size, northing: rowNorthing } = readMgrs(text);

  const bandSouth = BANDS.indexOf(band) * 8 - 80;
  const lowest =
    Math.min(
      project(bandSouth, centralMeridian(zone), zone)[1],
      project(bandSouth, centralMeridian(zone) + 3, zone)[1],
    ) - 100_000;
  let northing = rowNorthing;
  while (northing < lowest) northing += 2_000_000;

  const corners = [
    [easting, northing],
    [easting + size, northing],
    [easting, northing + size],
    [easting + size, northing + size],
  ].map(([east, north]) => inverse(zone, band, east as number, north as number));
  const center = inverse(zone, band, easting + size / 2, northing + size / 2);
  assertBand(center.latitude, band, 1, `MGRS square ${letters} in zone ${zone}`);
  return {
    center,
    bounds: {
      south: Math.min(...corners.map((corner) => corner.latitude)),
      north: Math.max(...corners.map((corner) => corner.latitude)),
      ...longitudeSpan(
        corners.map((corner) => corner.longitude),
        center.longitude,
      ),
    },
  };
}
