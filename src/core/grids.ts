/** Grid codes that name a cell instead of a point: geohash, Maidenhead locators and Plus Codes. */

import { assertCoordinates, type GeoPoint } from "./coordinates.ts";
import { InvalidInputError } from "./errors.ts";
import type { BoundingBox } from "./types.ts";

/** A decoded cell: the box the code names and the point in its middle. */
export interface GridCell {
  center: GeoPoint;
  bounds: BoundingBox;
}

/**
 * A cell from its edges.
 *
 * @param south - Southern edge.
 * @param west - Western edge.
 * @param north - Northern edge.
 * @param east - Eastern edge.
 * @returns {GridCell} The box and its middle.
 */
function cell(south: number, west: number, north: number, east: number): GridCell {
  return {
    center: { latitude: (south + north) / 2, longitude: (west + east) / 2 },
    bounds: { south, north, west, east },
  };
}

/**
 * Refuse a code length the format doesn't have.
 *
 * @param length - Requested length.
 * @param allowed - Whether a whole number is one of the format's lengths.
 * @param rule - The lengths in words, for the error.
 * @throws {InvalidInputError} When the length isn't allowed.
 */
function assertLength(length: number, allowed: (value: number) => boolean, rule: string): void {
  if (!Number.isInteger(length) || !allowed(length)) {
    throw new InvalidInputError(`${rule}, got ${length}`);
  }
}

/**
 * Longitude folded into -180..180, so 180 and -180 land in the same cell.
 *
 * @param longitude - Any longitude.
 * @returns {number} The same meridian in range.
 */
function wrapLongitude(longitude: number): number {
  return ((((longitude + 180) % 360) + 360) % 360) - 180;
}

const GEOHASH_ALPHABET = "0123456789bcdefghjkmnpqrstuvwxyz";

/** Longest geohash read or written; at 21 characters doubles can't hold the cell edges apart. */
const GEOHASH_MAX_LENGTH = 20;

/**
 * Geohash of a point, `length` characters long (1 to 20).
 *
 * @param point - The point to encode.
 * @param length - Characters to write.
 * @returns {string} The geohash.
 * @throws {InvalidInputError} When the point is out of range or the length is not supported.
 */
export function encodeGeohash(point: GeoPoint, length = 9): string {
  assertCoordinates(point.latitude, point.longitude);
  assertLength(
    length,
    (value) => value >= 1 && value <= GEOHASH_MAX_LENGTH,
    "geohash length runs from 1 to 20",
  );
  const latitude = [-90, 90];
  const longitude = [-180, 180];
  let code = "";
  let bits = 0;
  let index = 0;
  let even = true;
  while (code.length < length) {
    const range = even ? longitude : latitude;
    const value = even ? point.longitude : point.latitude;
    const middle = ((range[0] as number) + (range[1] as number)) / 2;
    index <<= 1;
    if (value >= middle) {
      index |= 1;
      range[0] = middle;
    } else range[1] = middle;
    even = !even;
    if (++bits === 5) {
      code += GEOHASH_ALPHABET[index];
      bits = 0;
      index = 0;
    }
  }
  return code;
}

/**
 * The cell a geohash names. Upper case is read too.
 *
 * @param code - The geohash.
 * @returns {GridCell} Its box and middle.
 * @throws {InvalidInputError} When the text holds a character outside the geohash alphabet.
 */
export function decodeGeohash(code: string): GridCell {
  const text = code.trim().toLowerCase();
  if (text.length < 1 || text.length > GEOHASH_MAX_LENGTH) {
    throw new InvalidInputError(`A geohash has 1 to 20 characters, got "${code}"`);
  }
  const latitude = [-90, 90];
  const longitude = [-180, 180];
  let even = true;
  for (const character of text) {
    const index = GEOHASH_ALPHABET.indexOf(character);
    if (index < 0) {
      throw new InvalidInputError(
        `"${character}" is not a geohash character in "${code}" (a, i, l and o never appear)`,
      );
    }
    for (let bit = 4; bit >= 0; bit--) {
      const range = even ? longitude : latitude;
      const middle = ((range[0] as number) + (range[1] as number)) / 2;
      if ((index >> bit) & 1) range[0] = middle;
      else range[1] = middle;
      even = !even;
    }
  }
  return cell(
    latitude[0] as number,
    longitude[0] as number,
    latitude[1] as number,
    longitude[1] as number,
  );
}

/** Maidenhead divisions per pair, counted in the finest unit so the math stays in integers. */
const MAIDENHEAD_STEPS = [18, 10, 24, 10, 24];
const MAIDENHEAD_FINEST = MAIDENHEAD_STEPS.reduce((product, step) => product * step, 1);

/**
 * Maidenhead locator of a point, 2 to 10 characters (`KO02` is the square, `KO02mf` the subsquare).
 *
 * @param point - The point to encode.
 * @param length - Characters to write.
 * @returns {string} The locator.
 * @throws {InvalidInputError} When the point is out of range or the length is odd or outside 2-10.
 */
export function encodeMaidenhead(point: GeoPoint, length = 6): string {
  assertCoordinates(point.latitude, point.longitude);
  assertLength(
    length,
    (value) => value >= 2 && value <= 10 && value % 2 === 0,
    "Maidenhead length is 2, 4, 6, 8 or 10",
  );
  let x = Math.floor(((wrapLongitude(point.longitude) + 180) / 360) * MAIDENHEAD_FINEST);
  let y = Math.min(
    Math.floor(((point.latitude + 90) / 180) * MAIDENHEAD_FINEST),
    MAIDENHEAD_FINEST - 1,
  );
  let unit = MAIDENHEAD_FINEST;
  let code = "";
  for (let pair = 0; pair < length / 2; pair++) {
    const step = MAIDENHEAD_STEPS[pair] as number;
    unit /= step;
    const column = Math.floor(x / unit);
    const row = Math.floor(y / unit);
    x -= column * unit;
    y -= row * unit;
    code +=
      step === 10
        ? `${column}${row}`
        : String.fromCodePoint((pair === 0 ? 65 : 97) + column, (pair === 0 ? 65 : 97) + row);
  }
  return code;
}

/**
 * The cell a Maidenhead locator names, any letter case.
 *
 * @param locator - The locator.
 * @returns {GridCell} Its box and middle.
 * @throws {InvalidInputError} When the text is not a 2 to 10 character locator.
 */
export function decodeMaidenhead(locator: string): GridCell {
  const text = locator.trim();
  if (!/^[A-R]{2}(?:\d{2}(?:[A-X]{2}(?:\d{2}(?:[A-X]{2})?)?)?)?$/i.test(text)) {
    throw new InvalidInputError(
      `"${locator}" is not a Maidenhead locator: letters A-R, digits, letters A-X, digits, letters A-X`,
    );
  }
  let x = 0;
  let y = 0;
  let unit = MAIDENHEAD_FINEST;
  for (let pair = 0; pair < text.length / 2; pair++) {
    const step = MAIDENHEAD_STEPS[pair] as number;
    unit /= step;
    const [column, row] = [text[pair * 2] as string, text[pair * 2 + 1] as string].map(
      (character) =>
        step === 10 ? Number(character) : (character.toUpperCase().codePointAt(0) ?? 65) - 65,
    ) as [number, number];
    x += column * unit;
    y += row * unit;
  }
  const west = (x / MAIDENHEAD_FINEST) * 360 - 180;
  const south = (y / MAIDENHEAD_FINEST) * 180 - 90;
  return cell(
    south,
    west,
    south + (unit / MAIDENHEAD_FINEST) * 180,
    west + (unit / MAIDENHEAD_FINEST) * 360,
  );
}

/** Open Location Code constants, named as in the specification. */
const PLUS_ALPHABET = "23456789CFGHJMPQRVWX";
const PLUS_SEPARATOR_POSITION = 8;
const PLUS_PAIR_LENGTH = 10;
const PLUS_MAX_LENGTH = 15;
const PLUS_GRID_COLUMNS = 4;
const PLUS_GRID_ROWS = 5;
const PLUS_PAIR_PRECISION = 8000;
const PLUS_LAT_PRECISION = PLUS_PAIR_PRECISION * PLUS_GRID_ROWS ** 5;
const PLUS_LNG_PRECISION = PLUS_PAIR_PRECISION * PLUS_GRID_COLUMNS ** 5;

/**
 * Plus Code (Open Location Code) of a point: 2, 4, 6, 8 or 10 to 15 digits, 10 by default.
 *
 * @example
 *   ```ts
 *   encodePlusCode({ latitude: 47.0000625, longitude: 8.0000625 }); // "8FVC2222+22"
 *   ```
 *
 * @param point - The point to encode.
 * @param length - Digits to write.
 * @returns {string} The code.
 * @throws {InvalidInputError} When the point is out of range or the length is not a valid one.
 */
export function encodePlusCode(point: GeoPoint, length = 10): string {
  assertCoordinates(point.latitude, point.longitude);
  assertLength(
    length,
    (value) =>
      value >= 2 && value <= PLUS_MAX_LENGTH && (value >= PLUS_PAIR_LENGTH || value % 2 === 0),
    "Plus Code length is 2, 4, 6, 8 or 10 to 15",
  );
  const latitudeSpan = 180 * PLUS_LAT_PRECISION;
  const longitudeSpan = 360 * PLUS_LNG_PRECISION;
  let latitude = Math.min(
    Math.max(Math.floor(point.latitude * PLUS_LAT_PRECISION) + 90 * PLUS_LAT_PRECISION, 0),
    latitudeSpan - 1,
  );
  let longitude =
    (((Math.floor(point.longitude * PLUS_LNG_PRECISION) + 180 * PLUS_LNG_PRECISION) %
      longitudeSpan) +
      longitudeSpan) %
    longitudeSpan;

  let code = "";
  if (length > PLUS_PAIR_LENGTH) {
    for (let digit = 0; digit < 5; digit++) {
      const row = latitude % PLUS_GRID_ROWS;
      const column = longitude % PLUS_GRID_COLUMNS;
      code = PLUS_ALPHABET[row * PLUS_GRID_COLUMNS + column] + code;
      latitude = Math.floor(latitude / PLUS_GRID_ROWS);
      longitude = Math.floor(longitude / PLUS_GRID_COLUMNS);
    }
  } else {
    latitude = Math.floor(latitude / PLUS_GRID_ROWS ** 5);
    longitude = Math.floor(longitude / PLUS_GRID_COLUMNS ** 5);
  }
  for (let pair = 0; pair < PLUS_PAIR_LENGTH / 2; pair++) {
    code = `${PLUS_ALPHABET[latitude % 20]}${PLUS_ALPHABET[longitude % 20]}${code}`;
    latitude = Math.floor(latitude / 20);
    longitude = Math.floor(longitude / 20);
  }
  const digits = code.slice(0, Math.min(length, PLUS_MAX_LENGTH));
  if (digits.length < PLUS_SEPARATOR_POSITION) {
    return `${digits.padEnd(PLUS_SEPARATOR_POSITION, "0")}+`;
  }
  return `${digits.slice(0, PLUS_SEPARATOR_POSITION)}+${digits.slice(PLUS_SEPARATOR_POSITION)}`;
}

/**
 * A `+` that's missing, doubled or in the wrong place.
 *
 * @param code - Upper case code.
 * @param separator - Index of its first `+`.
 * @returns {string | undefined} The problem, or nothing.
 */
function separatorProblem(code: string, separator: number): string | undefined {
  if (separator < 0 || separator !== code.lastIndexOf("+")) return "it needs exactly one +";
  if (separator > PLUS_SEPARATOR_POSITION || separator % 2 === 1) {
    return "the + sits after an even number of digits, eight at most";
  }
  return undefined;
}

/**
 * Zero padding that a padded code can't have.
 *
 * @param code - Upper case code.
 * @param separator - Index of its `+`.
 * @returns {string | undefined} The problem, or nothing.
 */
function paddingProblem(code: string, separator: number): string | undefined {
  const padding = code.indexOf("0");
  if (padding < 0) return undefined;
  if (separator < PLUS_SEPARATOR_POSITION) return "a padded code has eight characters before +";
  if (padding === 0 || padding % 2 === 1) return "padding starts after an even number of digits";
  if (!/^0+$/.test(code.slice(padding, separator)) || code.length > separator + 1) {
    return "nothing but zeros follows the first 0, and nothing follows the +";
  }
  return undefined;
}

/**
 * Digits that are missing, lonely or outside the alphabet.
 *
 * @param code - Upper case code.
 * @param separator - Index of its `+`.
 * @returns {string | undefined} The problem, or nothing.
 */
function digitProblem(code: string, separator: number): string | undefined {
  if (code.length - separator - 1 === 1) return "a single digit after the + is not allowed";
  const digits = code.replace("+", "").replaceAll("0", "");
  if (digits.length === 0) return "it has no digits";
  for (const character of digits) {
    if (!PLUS_ALPHABET.includes(character)) return `"${character}" is not a Plus Code digit`;
  }
  return undefined;
}

/**
 * A full code whose first pair points off the globe.
 *
 * @param code - Upper case full code.
 * @returns {string | undefined} The problem, or nothing.
 */
function rangeProblem(code: string): string | undefined {
  if (PLUS_ALPHABET.indexOf(code[0] as string) * 20 >= 180)
    return "the first digit puts it past 90°";
  if (PLUS_ALPHABET.indexOf(code[1] as string) * 20 >= 360)
    return "the second digit puts it past 180°";
  return undefined;
}

/** Shape checks in the order a reader would hit them. */
const PLUS_SHAPE_CHECKS = [separatorProblem, paddingProblem, digitProblem];

/**
 * Why a code is not a full Plus Code, or nothing when it is one; short codes report `short`.
 *
 * @param code - Upper case code.
 * @returns {string | undefined} The problem, `short`, or nothing.
 */
function plusCodeProblem(code: string): string | undefined {
  const separator = code.indexOf("+");
  for (const check of PLUS_SHAPE_CHECKS) {
    const problem = check(code, separator);
    if (problem !== undefined) return problem;
  }
  return separator < PLUS_SEPARATOR_POSITION ? "short" : rangeProblem(code);
}

/**
 * The cell a full Plus Code names.
 *
 * @param code - Upper case full code.
 * @returns {GridCell & { length: number }} The cell and the digits read.
 */
function decodeFullPlusCode(code: string): GridCell & { length: number } {
  const digits = code.replace("+", "").replaceAll("0", "").slice(0, PLUS_MAX_LENGTH);
  let latitude = -90 * PLUS_PAIR_PRECISION;
  let longitude = -180 * PLUS_PAIR_PRECISION;
  let place = 20 ** 4;
  const pairs = Math.min(digits.length, PLUS_PAIR_LENGTH);
  for (let index = 0; index < pairs; index += 2) {
    latitude += PLUS_ALPHABET.indexOf(digits[index] as string) * place;
    longitude += PLUS_ALPHABET.indexOf(digits[index + 1] as string) * place;
    if (index < pairs - 2) place /= 20;
  }
  let latitudeSize = place / PLUS_PAIR_PRECISION;
  let longitudeSize = place / PLUS_PAIR_PRECISION;
  let gridLatitude = 0;
  let gridLongitude = 0;
  if (digits.length > PLUS_PAIR_LENGTH) {
    let rowPlace = PLUS_GRID_ROWS ** 4;
    let columnPlace = PLUS_GRID_COLUMNS ** 4;
    for (let index = PLUS_PAIR_LENGTH; index < digits.length; index++) {
      const value = PLUS_ALPHABET.indexOf(digits[index] as string);
      gridLatitude += Math.floor(value / PLUS_GRID_COLUMNS) * rowPlace;
      gridLongitude += (value % PLUS_GRID_COLUMNS) * columnPlace;
      if (index < digits.length - 1) {
        rowPlace /= PLUS_GRID_ROWS;
        columnPlace /= PLUS_GRID_COLUMNS;
      }
    }
    latitudeSize = rowPlace / PLUS_LAT_PRECISION;
    longitudeSize = columnPlace / PLUS_LNG_PRECISION;
  }
  const south = latitude / PLUS_PAIR_PRECISION + gridLatitude / PLUS_LAT_PRECISION;
  const west = longitude / PLUS_PAIR_PRECISION + gridLongitude / PLUS_LNG_PRECISION;
  const result = cell(south, west, south + latitudeSize, west + longitudeSize);
  result.center = {
    latitude: Math.min(result.center.latitude, 90),
    longitude: Math.min(result.center.longitude, 180),
  };
  return { ...result, length: digits.length };
}

/**
 * The cell a Plus Code names. A short code (`9G8F+6W`) needs `reference`, a point near the place
 * it belongs to, the way Google Maps writes the town next to it.
 *
 * @param code - The code, full or short.
 * @param reference - A point near a short code's place.
 * @returns {GridCell} Its box and middle.
 * @throws {InvalidInputError} When the code is malformed, or short without a reference.
 */
export function decodePlusCode(code: string, reference?: GeoPoint): GridCell {
  const text = code.trim().toUpperCase();
  const problem = plusCodeProblem(text);
  if (problem === "short" && !reference) {
    throw new InvalidInputError(
      `"${code}" is a short Plus Code; pass a reference point near the place it belongs to, for example the geocoded town written next to it`,
    );
  }
  if (problem && problem !== "short") {
    throw new InvalidInputError(`"${code}" is not a Plus Code: ${problem}`);
  }
  const full = problem === "short" && reference ? recoverPlusCode(text, reference) : text;
  const { center, bounds } = decodeFullPlusCode(full);
  return { center, bounds };
}

/**
 * The full code nearest to `reference` that ends with the short code, as `recoverNearest` does.
 *
 * @param short - Upper case short code.
 * @param reference - A point near its place.
 * @returns {string} The full code.
 */
function recoverPlusCode(short: string, reference: GeoPoint): string {
  assertCoordinates(reference.latitude, reference.longitude);
  const padding = PLUS_SEPARATOR_POSITION - short.indexOf("+");
  const resolution = 20 ** (2 - padding / 2);
  const half = resolution / 2;
  const prefix = encodePlusCode(reference).slice(0, padding);
  const area = decodeFullPlusCode(prefix + short);
  let { latitude, longitude } = area.center;
  if (reference.latitude + half < latitude && latitude - resolution >= -90) latitude -= resolution;
  else if (reference.latitude - half > latitude && latitude + resolution <= 90) {
    latitude += resolution;
  }
  if (reference.longitude + half < longitude) longitude -= resolution;
  else if (reference.longitude - half > longitude) longitude += resolution;
  return encodePlusCode({ latitude, longitude: wrapLongitude(longitude) }, area.length);
}

/**
 * True when the text reads as a Plus Code, full or short.
 *
 * @param text - Candidate text.
 * @returns {boolean} Whether it has the shape.
 */
export function isPlusCode(text: string): boolean {
  const problem = plusCodeProblem(text.trim().toUpperCase());
  return problem === undefined || problem === "short";
}
