/** One entry point for every coordinate format: detect, decode, and write the point back out. */

import type { GeoPoint } from "./coordinates.ts";
import { formatDdm, formatDecimal, formatDms, parseDegrees } from "./degrees.ts";
import { InvalidInputError } from "./errors.ts";
import {
  decodeGeohash,
  decodeMaidenhead,
  decodePlusCode,
  encodeGeohash,
  encodeMaidenhead,
  encodePlusCode,
  isPlusCode,
} from "./grids.ts";
import { COORDINATE_FORMATS, type BoundingBox, type CoordinateFormat } from "./types.ts";
import {
  decodeMgrs,
  encodeMgrs,
  formatUtm,
  fromUtm,
  isMgrs,
  isUtm,
  parseUtm,
  toUtm,
} from "./utm.ts";
import {
  hasWhat3wordsKey,
  isWhat3words,
  squareToWhat3words,
  what3wordsToSquare,
} from "./what3words.ts";

/** Longest input read; every coordinate format fits with room to spare, and errors echo it. */
const MAX_INPUT_LENGTH = 256;

function readInput(input: string): string {
  const text = input.trim();
  if (!text) throw new InvalidInputError("Nothing to convert: the input is empty");
  if (text.length > MAX_INPUT_LENGTH) {
    throw new InvalidInputError(
      `Coordinates run ${MAX_INPUT_LENGTH} characters at most, got ${text.length}`,
    );
  }
  return text;
}

/** The formats computed locally, without a key or a network call. */
export type LocalCoordinateFormat = Exclude<CoordinateFormat, "what3words">;

/** Precision per format in its own unit: decimals, characters, Plus Code digits or MGRS digits. */
export type CoordinatePrecision = Partial<Record<LocalCoordinateFormat, number>>;

/** A decoded input: the point it names and, for grid codes, the cell around it. */
export interface DecodedCoordinates {
  format: CoordinateFormat;
  center: GeoPoint;
  /** Present when the input names an area (geohash, locator, Plus Code, MGRS, what3words) */
  bounds?: BoundingBox;
  /** The input written the canonical way for its format */
  canonical: string;
}

/** Options for `convertCoordinates`. */
export interface ConvertOptions {
  /** Format of the input; detected when omitted */
  from?: CoordinateFormat;
  /** Formats to write; every local one when omitted, plus what3words when a key is set */
  to?: readonly CoordinateFormat[];
  precision?: CoordinatePrecision;
  /** A point near a short Plus Code's place, needed to read `9G8F+6W` */
  reference?: GeoPoint;
  /** Language of what3words output */
  language?: string;
  /** what3words key; defaults to `WHAT3WORDS_API_KEY` */
  what3wordsKey?: string;
  signal?: AbortSignal;
}

/** The result of `convertCoordinates`. */
export interface CoordinateConversion extends DecodedCoordinates {
  input: string;
  /** The point (or the input's cell center) in each requested format */
  formats: Partial<Record<CoordinateFormat, string>>;
  /** Formats left out of an unfiltered conversion, with the reason */
  skipped?: Partial<Record<CoordinateFormat, string>>;
}

/** Throws unless `value` names a format. */
export function assertCoordinateFormat(value: string): asserts value is CoordinateFormat {
  if (!(COORDINATE_FORMATS as readonly string[]).includes(value)) {
    throw new InvalidInputError(
      `Unknown coordinate format "${value}"; use one of ${COORDINATE_FORMATS.join(", ")}`,
    );
  }
}

/** Formats the text could be in. Only lower case reads as a geohash, so `JN58td` is a locator. */
export function detectCoordinateFormats(input: string): CoordinateFormat[] {
  const text = input.trim();
  const found: CoordinateFormat[] = [];
  if (isWhat3words(text)) return ["what3words"];
  if (text.includes("+")) return isPlusCode(text) ? ["pluscode"] : [];
  if (isUtm(text)) return ["utm"];
  if (isMgrs(text)) found.push("mgrs");
  if (/^[A-R]{2}(?:\d{2}(?:[A-X]{2}(?:\d{2}(?:[A-X]{2})?)?)?)?$/i.test(text))
    found.push("maidenhead");
  if (/^[0-9b-hjkmnp-z]{1,22}$/.test(text) && /[b-z]/.test(text)) found.push("geohash");
  if (found.length > 0) return found;
  try {
    return [parseDegrees(text).notation];
  } catch {
    return [];
  }
}

function pickFormat(input: string): CoordinateFormat {
  const formats = detectCoordinateFormats(input);
  if (formats.length === 1) return formats[0] as CoordinateFormat;
  if (formats.length > 1) {
    throw new InvalidInputError(
      `"${input}" reads as ${formats.join(" or ")}; pass the format to pick one`,
    );
  }
  if (/\d/.test(input) && !input.includes("+")) parseDegrees(input);
  throw new InvalidInputError(
    `Could not tell the format of "${input}"; expected decimal degrees, DMS, DDM, a geohash, a Maidenhead locator, a Plus Code, UTM, MGRS or three words`,
  );
}

/**
 * Read a coordinate in any local format. The format is detected when omitted.
 *
 * @throws {InvalidInputError} When the text does not parse, is ambiguous, or is three words
 *   (those need `convertCoordinates` and a key).
 */
export function decodeCoordinates(
  input: string,
  options?: { from?: CoordinateFormat; reference?: GeoPoint },
): DecodedCoordinates {
  const text = readInput(input);
  const format = options?.from ?? pickFormat(text);
  assertCoordinateFormat(format);
  switch (format) {
    case "decimal":
    case "dms":
    case "ddm": {
      const { point, notation } = parseDegrees(text);
      return { format: notation, center: point, canonical: encodeCoordinates(point, notation) };
    }
    case "geohash":
      return { format, ...decodeGeohash(text), canonical: text.toLowerCase() };
    case "maidenhead": {
      const upper = text.slice(0, 4).toUpperCase() + text.slice(4).toLowerCase();
      return { format, ...decodeMaidenhead(text), canonical: upper };
    }
    case "pluscode":
      return { format, ...decodePlusCode(text, options?.reference), canonical: text.toUpperCase() };
    case "utm": {
      const position = parseUtm(text);
      return { format, center: fromUtm(position), canonical: formatUtm(position) };
    }
    case "mgrs": {
      const decoded = decodeMgrs(text);
      const compact = text.replaceAll(/\s+/g, "").toUpperCase();
      const digits = compact.replace(/^\d{1,2}[A-Z]{3}/, "");
      const half = digits.length / 2;
      const head = compact.slice(0, compact.length - digits.length);
      const canonical = [
        head.slice(0, -2),
        head.slice(-2),
        digits.slice(0, half),
        digits.slice(half),
      ]
        .filter(Boolean)
        .join(" ");
      return { format, ...decoded, canonical };
    }
    case "what3words":
      throw new InvalidInputError(
        "Three word addresses need the what3words API; use convertCoordinates with a key",
      );
  }
}

/**
 * Write a point in one local format at the given precision (see `CoordinatePrecision`).
 *
 * @throws {InvalidInputError} When the point is out of range for the format or the precision is
 *   not one it supports.
 */
export function encodeCoordinates(
  point: GeoPoint,
  format: LocalCoordinateFormat,
  precision?: number,
): string {
  assertCoordinateFormat(format);
  const decimals = (fallback: number, max: number): number => {
    const value = precision ?? fallback;
    if (!Number.isInteger(value) || value < 0 || value > max) {
      throw new InvalidInputError(`${format} precision runs from 0 to ${max}, got ${value}`);
    }
    return value;
  };
  switch (format) {
    case "decimal":
      return formatDecimal(point, decimals(6, 10));
    case "dms":
      return formatDms(point, decimals(1, 4));
    case "ddm":
      return formatDdm(point, decimals(3, 5));
    case "geohash":
      return encodeGeohash(point, precision);
    case "maidenhead":
      return encodeMaidenhead(point, precision);
    case "pluscode":
      return encodePlusCode(point, precision);
    case "utm":
      return formatUtm(toUtm(point), decimals(0, 3));
    case "mgrs":
      return encodeMgrs(point, precision);
    default:
      throw new InvalidInputError(`${format as string} is not a local coordinate format`);
  }
}

/**
 * Read a coordinate in any supported format and write it out in the others. A grid code names an
 * area, so the result carries `bounds` and every other format describes the cell's middle.
 *
 * @example
 *   ```ts
 *   const result = await convertCoordinates("ezs42", { to: ["decimal", "maidenhead"] });
 *   result.formats; // { decimal: "42.604980, -5.603027", maidenhead: "IN72eo" }
 *   ```
 *
 * @throws {InvalidInputError} When the input does not parse, is ambiguous, or the requested
 *   precision does not fit a format.
 * @throws {AuthError} When what3words is involved and no key is set.
 */
export async function convertCoordinates(
  input: string,
  options: ConvertOptions = {},
): Promise<CoordinateConversion> {
  const text = readInput(input);
  const what3words = {
    apiKey: options.what3wordsKey,
    language: options.language,
    signal: options.signal,
  };
  const from = options.from ?? pickFormat(text);
  assertCoordinateFormat(from);
  for (const format of options.to ?? []) assertCoordinateFormat(format);

  let decoded: DecodedCoordinates;
  if (from === "what3words") {
    const square = await what3wordsToSquare(text, what3words);
    decoded = {
      format: from,
      center: square.center,
      bounds: square.bounds,
      canonical: square.words,
    };
  } else {
    decoded = decodeCoordinates(text, { from, reference: options.reference });
  }

  const explicit = options.to !== undefined;
  const targets: CoordinateFormat[] = explicit
    ? [...new Set(options.to)]
    : COORDINATE_FORMATS.filter(
        (format) => format !== "what3words" || hasWhat3wordsKey(what3words),
      );
  const formats: Partial<Record<CoordinateFormat, string>> = {};
  const skipped: Partial<Record<CoordinateFormat, string>> = {};
  for (const format of targets) {
    const precision = format === "what3words" ? undefined : options.precision?.[format];
    if (format === decoded.format && precision === undefined) {
      formats[format] = decoded.canonical;
      continue;
    }
    try {
      formats[format] =
        format === "what3words"
          ? (await squareToWhat3words(decoded.center, what3words)).words
          : encodeCoordinates(decoded.center, format, precision);
    } catch (error) {
      const optional =
        format === "what3words" ? !options.signal?.aborted : error instanceof InvalidInputError;
      if (explicit || !optional) throw error;
      skipped[format] = error instanceof Error ? error.message : String(error);
    }
  }
  return {
    input: text,
    ...decoded,
    formats,
    ...(Object.keys(skipped).length > 0 ? { skipped } : {}),
  };
}
