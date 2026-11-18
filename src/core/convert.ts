/** One entry point for every coordinate format: detect, decode, and write the point back out. */

import { assertCoordinates, type GeoPoint } from "./coordinates.ts";
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
  type What3wordsOptions,
} from "./what3words.ts";

/** Longest input read; every coordinate format fits with room to spare, and errors echo it. */
const MAX_INPUT_LENGTH = 256;

/**
 * The input trimmed, once it's neither empty nor absurdly long.
 *
 * @param input - Coordinates as given.
 * @returns {string} The text to read.
 * @throws {InvalidInputError} When there's nothing to read, or too much.
 */
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

/** Precision values each local format accepts, with the default first. */
const PRECISIONS: Record<LocalCoordinateFormat, readonly number[]> = {
  decimal: [6, 0, 1, 2, 3, 4, 5, 7, 8, 9, 10],
  dms: [1, 0, 2, 3, 4],
  ddm: [3, 0, 1, 2, 4, 5],
  geohash: [
    9,
    ...Array.from({ length: 20 }, (_, index) => index + 1).filter((length) => length !== 9),
  ],
  maidenhead: [6, 2, 4, 8, 10],
  pluscode: [10, 2, 4, 6, 8, 11, 12, 13, 14, 15],
  utm: [0, 1, 2, 3],
  mgrs: [5, 0, 1, 2, 3, 4],
};

/**
 * Throws unless `value` is a precision `format` supports; caller mistakes never become skips.
 *
 * @param format - A local format.
 * @param value - Requested precision.
 * @throws {InvalidInputError} When the format has no such precision.
 */
function assertPrecision(format: LocalCoordinateFormat, value: number): void {
  const allowed = PRECISIONS[format];
  if (!allowed.includes(value)) {
    const listed = [...allowed].sort((a, b) => a - b).join(", ");
    throw new InvalidInputError(`${format} precision is one of ${listed}, got ${value}`);
  }
}

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

/**
 * Throws unless `value` names a format.
 *
 * @param value - Candidate format name.
 * @throws {InvalidInputError} When no format has that name.
 */
export function assertCoordinateFormat(value: string): asserts value is CoordinateFormat {
  if (!(COORDINATE_FORMATS as readonly string[]).includes(value)) {
    throw new InvalidInputError(
      `Unknown coordinate format "${value}"; use one of ${COORDINATE_FORMATS.join(", ")}`,
    );
  }
}

/**
 * Formats the text could be in. Only lower case reads as a geohash, so `JN58td` is a locator.
 *
 * @param input - Coordinates as given.
 * @returns {CoordinateFormat[]} Every format that fits, or none.
 */
export function detectCoordinateFormats(input: string): CoordinateFormat[] {
  const text = readInput(input);
  const found: CoordinateFormat[] = [];
  if (isWhat3words(text)) return ["what3words"];
  if (isPlusCode(text)) return ["pluscode"];
  if (isUtm(text)) return ["utm"];
  if (isMgrs(text)) found.push("mgrs");
  if (/^[A-R]{2}(?:\d{2}(?:[A-X]{2}(?:\d{2}(?:[A-X]{2})?)?)?)?$/i.test(text))
    found.push("maidenhead");
  if (/^[0-9b-hjkmnp-z]{1,20}$/.test(text)) found.push("geohash");
  if (found.length > 0) return found;
  try {
    return [parseDegrees(text).notation];
  } catch {
    return [];
  }
}

/**
 * The one format a text is in.
 *
 * @param input - Trimmed coordinates.
 * @returns {CoordinateFormat} The format.
 * @throws {InvalidInputError} When no format fits, or more than one does.
 */
function pickFormat(input: string): CoordinateFormat {
  const formats = detectCoordinateFormats(input);
  if (formats.length === 1) return formats[0] as CoordinateFormat;
  if (formats.length > 1) {
    throw new InvalidInputError(
      `"${input}" reads as ${formats.join(" or ")}; pass the format to pick one`,
    );
  }
  if (/^[23456789CFGHJMPQRVWX0]*\+[23456789CFGHJMPQRVWX]*$/i.test(input)) decodePlusCode(input);
  if (/\d/.test(input)) parseDegrees(input);
  throw new InvalidInputError(
    `Could not tell the format of "${input}"; expected decimal degrees, DMS, DDM, a geohash, a Maidenhead locator, a Plus Code, UTM, MGRS or three words`,
  );
}

/**
 * Read a pair of angles, and hold it to the notation the caller named.
 *
 * @param text - Trimmed coordinates.
 * @param from - Notation the caller expects.
 * @returns {DecodedCoordinates} The point in the notation it was written in.
 * @throws {InvalidInputError} When the text is written another way than `from`.
 */
function decodeDegrees(text: string, from?: CoordinateFormat): DecodedCoordinates {
  const { point, notation } = parseDegrees(text);
  if (from && notation !== from) {
    throw new InvalidInputError(`"${text}" is written as ${notation}, not ${from}`);
  }
  return { format: notation, center: point, canonical: encodeCoordinates(point, notation) };
}

/**
 * An MGRS reference spaced the canonical way, `34U EC 0083 8658`.
 *
 * @param text - A valid reference, spaced any way.
 * @returns {string} Zone and band, square, easting, northing.
 */
function canonicalMgrs(text: string): string {
  const compact = text.replaceAll(/\s+/g, "").toUpperCase();
  const digits = compact.replace(/^\d{1,2}[A-Z]{3}/, "");
  const half = digits.length / 2;
  const head = compact.slice(0, compact.length - digits.length);
  return [
    head.slice(0, -2).replace(/^0/, ""),
    head.slice(-2),
    digits.slice(0, half),
    digits.slice(half),
  ]
    .filter(Boolean)
    .join(" ");
}

/** What `decodeCoordinates` takes besides the text. */
type DecodeOptions = Readonly<{ from?: CoordinateFormat; reference?: GeoPoint }>;

/** One reader per local format. */
const DECODERS: Record<
  LocalCoordinateFormat,
  (text: string, options: DecodeOptions) => DecodedCoordinates
> = {
  decimal: (text, options) => decodeDegrees(text, options.from),
  dms: (text, options) => decodeDegrees(text, options.from),
  ddm: (text, options) => decodeDegrees(text, options.from),
  geohash: (text) => ({ format: "geohash", ...decodeGeohash(text), canonical: text.toLowerCase() }),
  maidenhead: (text) => ({
    format: "maidenhead",
    ...decodeMaidenhead(text),
    canonical: text.slice(0, 4).toUpperCase() + text.slice(4).toLowerCase(),
  }),
  pluscode: (text, options) => ({
    format: "pluscode",
    ...decodePlusCode(text, options.reference),
    canonical: text.toUpperCase(),
  }),
  utm: (text) => {
    const position = parseUtm(text);
    return { format: "utm", center: fromUtm(position), canonical: formatUtm(position) };
  },
  mgrs: (text) => ({ format: "mgrs", ...decodeMgrs(text), canonical: canonicalMgrs(text) }),
};

/**
 * Read a coordinate in any local format. The format is detected when omitted.
 *
 * @param input - Coordinates as given.
 * @param options - The format to read it as, and a reference for a short Plus Code.
 * @returns {DecodedCoordinates} The point, its cell and its canonical form.
 * @throws {InvalidInputError} When the text does not parse, is ambiguous, or is three words
 *   (those need `convertCoordinates` and a key).
 */
export function decodeCoordinates(input: string, options?: DecodeOptions): DecodedCoordinates {
  const text = readInput(input);
  const format = options?.from ?? pickFormat(text);
  assertCoordinateFormat(format);
  if (format === "what3words") {
    throw new InvalidInputError(
      "Three word addresses need the what3words API; use convertCoordinates with a key",
    );
  }
  return DECODERS[format](text, options ?? {});
}

/** One writer per local format. */
const ENCODERS: Record<LocalCoordinateFormat, (point: GeoPoint, precision: number) => string> = {
  decimal: formatDecimal,
  dms: formatDms,
  ddm: formatDdm,
  geohash: encodeGeohash,
  maidenhead: encodeMaidenhead,
  pluscode: encodePlusCode,
  utm: (point, precision) => formatUtm(toUtm(point), precision),
  mgrs: encodeMgrs,
};

/**
 * Write a point in one local format at the given precision (see `CoordinatePrecision`).
 *
 * @param point - The point to write.
 * @param format - A local format.
 * @param precision - Precision in the format's own unit.
 * @returns {string} The point in that format.
 * @throws {InvalidInputError} When the point is out of range for the format or the precision is
 *   not one it supports.
 */
export function encodeCoordinates(
  point: GeoPoint,
  format: LocalCoordinateFormat,
  precision?: number,
): string {
  assertCoordinateFormat(format);
  if ((format as CoordinateFormat) === "what3words") {
    throw new InvalidInputError(
      "what3words is not a local format; use convertCoordinates with a key",
    );
  }
  assertCoordinates(point.latitude, point.longitude);
  const value = precision ?? (PRECISIONS[format][0] as number);
  assertPrecision(format, value);
  return ENCODERS[format](point, value);
}

/**
 * Refuse a target format or a precision the library doesn't have, before anything is decoded.
 *
 * @param options - The conversion request.
 * @throws {InvalidInputError} When a format is unknown or a precision doesn't fit its format.
 */
function checkTargets(options: ConvertOptions): void {
  for (const format of options.to ?? []) assertCoordinateFormat(format);
  for (const [format, value] of Object.entries(options.precision ?? {})) {
    assertCoordinateFormat(format);
    if (format === "what3words") throw new InvalidInputError("what3words has no precision");
    if (value !== undefined) assertPrecision(format, value);
  }
}

/**
 * The what3words options a conversion carries.
 *
 * @param options - The conversion request.
 * @returns {What3wordsOptions} Key, language and signal.
 */
function keyOptions(options: ConvertOptions): What3wordsOptions {
  return { apiKey: options.what3wordsKey, language: options.language, signal: options.signal };
}

/**
 * Decode the input, over the network when it's three words.
 *
 * @param text - Trimmed coordinates.
 * @param options - The conversion request, its `from` already settled.
 * @returns {Promise<DecodedCoordinates>} The point, its cell and its canonical form.
 */
async function decodeAny(text: string, options: ConvertOptions): Promise<DecodedCoordinates> {
  if (options.from !== "what3words") {
    return decodeCoordinates(text, { from: options.from, reference: options.reference });
  }
  const square = await what3wordsToSquare(text, keyOptions(options));
  return {
    format: options.from,
    center: square.center,
    bounds: square.bounds,
    canonical: square.words,
  };
}

/** One conversion past decoding: what was read, what was asked, whether `to` named the formats. */
interface Job {
  readonly decoded: DecodedCoordinates;
  readonly options: ConvertOptions;
  readonly explicit: boolean;
}

/**
 * Write the decoded point in one format. The input's own format echoes its canonical form.
 *
 * @param job - The conversion in flight.
 * @param format - Format to write.
 * @returns {Promise<string>} The point in that format.
 */
async function writeTarget(job: Job, format: CoordinateFormat): Promise<string> {
  const { decoded, options } = job;
  const precision = format === "what3words" ? undefined : options.precision?.[format];
  if (format === decoded.format && precision === undefined) return decoded.canonical;
  return format === "what3words"
    ? (await squareToWhat3words(decoded.center, keyOptions(options))).words
    : encodeCoordinates(decoded.center, format, precision);
}

/**
 * Write one format, or say why it was left out of an unfiltered conversion.
 *
 * @param job - The conversion in flight.
 * @param format - Format to write.
 * @returns {Promise<readonly ["formats" | "skipped", string]>} The bucket and its text.
 */
async function tryTarget(
  job: Job,
  format: CoordinateFormat,
): Promise<readonly ["formats" | "skipped", string]> {
  try {
    return ["formats", await writeTarget(job, format)];
  } catch (error) {
    const optional =
      format === "what3words" ? !job.options.signal?.aborted : error instanceof InvalidInputError;
    if (job.explicit || !optional) throw error;
    return ["skipped", error instanceof Error ? error.message : String(error)];
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
 * @param input - Coordinates as given.
 * @param options - Formats, precision, reference and what3words settings.
 * @returns {Promise<CoordinateConversion>} The input decoded and written out.
 * @throws {InvalidInputError} When the input does not parse, is ambiguous, or the requested
 *   precision does not fit a format.
 * @throws {AuthError} When what3words is involved and no key is set.
 */
export async function convertCoordinates(
  input: string,
  options: ConvertOptions = {},
): Promise<CoordinateConversion> {
  const text = readInput(input);
  const from = options.from ?? pickFormat(text);
  assertCoordinateFormat(from);
  checkTargets(options);
  const decoded = await decodeAny(text, { ...options, from });

  const explicit = options.to !== undefined;
  const targets: CoordinateFormat[] = explicit
    ? [...new Set(options.to)]
    : COORDINATE_FORMATS.filter(
        (format) => format !== "what3words" || hasWhat3wordsKey(keyOptions(options)),
      );
  const written: Record<"formats" | "skipped", Partial<Record<CoordinateFormat, string>>> = {
    formats: {},
    skipped: {},
  };
  const job = { decoded, options, explicit };
  for (const format of targets) {
    const [bucket, output] = await tryTarget(job, format);
    written[bucket][format] = output;
  }
  return {
    input: text,
    ...decoded,
    formats: written.formats,
    ...(Object.keys(written.skipped).length > 0 ? { skipped: written.skipped } : {}),
  };
}
