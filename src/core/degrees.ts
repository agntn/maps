/** Angles written out in degrees: decimal, DMS and DDM. */

import { assertCoordinates, type GeoPoint } from "./coordinates.ts";
import { InvalidInputError } from "./errors.ts";

/** How a pair of angles was written: one, two or three numbers per axis. */
export type DegreeNotation = "decimal" | "ddm" | "dms";

/** A pair read from text, with the notation it was written in. */
export interface ParsedDegrees {
  notation: DegreeNotation;
  point: GeoPoint;
}

type Token =
  | { kind: "number"; text: string }
  | { kind: "hemisphere"; letter: "N" | "S" | "E" | "W" }
  | { kind: "unit"; unit: "degree" | "minute" | "second" }
  | { kind: "separator" };

const NOTATION_BY_COUNT: Record<number, DegreeNotation> = { 1: "decimal", 2: "ddm", 3: "dms" };

/** Typographic primes and degree lookalikes folded onto the ASCII marks the tokenizer reads. */
function normalizeMarks(input: string): string {
  return input
    .replaceAll(/[º˚]/g, "°")
    .replaceAll(/[′’‘´`]/g, "'")
    .replaceAll(/[″“”]|''/g, '"');
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  const pattern = /\s+|([+-]?\d+(?:\.\d+)?)|([NSEW])|([°'"])|([,;])|(.)/giu;
  for (const match of normalizeMarks(input).matchAll(pattern)) {
    const [, number, hemisphere, unit, separator, other] = match;
    if (number !== undefined) tokens.push({ kind: "number", text: number });
    else if (hemisphere !== undefined) {
      tokens.push({ kind: "hemisphere", letter: hemisphere.toUpperCase() as "N" });
    } else if (unit !== undefined) {
      tokens.push({
        kind: "unit",
        unit: unit === "°" ? "degree" : unit === "'" ? "minute" : "second",
      });
    } else if (separator !== undefined) tokens.push({ kind: "separator" });
    else if (other !== undefined) {
      throw new InvalidInputError(`Unexpected "${other}" in coordinates "${input}"`);
    }
  }
  return tokens;
}

/** One axis: its numbers in order, an optional hemisphere letter and the unit marks it used. */
interface Axis {
  numbers: string[];
  hemisphere?: "N" | "S" | "E" | "W";
}

function axisFromTokens(tokens: Token[], input: string): Axis {
  const numbers: string[] = [];
  let expected = 0;
  for (const token of tokens) {
    if (token.kind === "number") numbers.push(token.text);
    if (token.kind === "unit") {
      const position = ["degree", "minute", "second"].indexOf(token.unit);
      if (position !== numbers.length - 1 || position < expected) {
        throw new InvalidInputError(
          `Degree, minute and second marks are out of order in "${input}"`,
        );
      }
      expected = position + 1;
    }
  }
  return { numbers };
}

/** Split the token stream into two axes, by hemisphere letters when there are any. */
function splitAxes(tokens: Token[], input: string): [Axis, Axis] {
  const letters = tokens.flatMap((token, index) => (token.kind === "hemisphere" ? [index] : []));
  if (letters.length === 2) {
    const [first, second] = letters as [number, number];
    const prefix = first === 0;
    const suffix = second === tokens.length - 1;
    if (!prefix && !suffix) {
      throw new InvalidInputError(
        `Put hemisphere letters all before or all after the numbers in "${input}"`,
      );
    }
    const ranges: Array<[number, number]> = prefix
      ? [
          [1, second],
          [second + 1, tokens.length],
        ]
      : [
          [0, first],
          [first + 1, second],
        ];
    const axes = ranges.map(([start, end], index) => {
      const letterToken = tokens[letters[index] as number] as Token & { kind: "hemisphere" };
      const part = tokens.slice(start, end).filter((token) => token.kind !== "separator");
      return { ...axisFromTokens(part, input), hemisphere: letterToken.letter };
    });
    return [axes[0] as Axis, axes[1] as Axis];
  }
  if (letters.length > 0) {
    throw new InvalidInputError(`Expected one N/S and one E/W letter in "${input}"`);
  }

  const separators = tokens.flatMap((token, index) => (token.kind === "separator" ? [index] : []));
  if (separators.length === 1) {
    const at = separators[0] as number;
    return [
      axisFromTokens(tokens.slice(0, at), input),
      axisFromTokens(tokens.slice(at + 1), input),
    ];
  }
  if (separators.length > 1) {
    throw new InvalidInputError(`Expected one comma between latitude and longitude in "${input}"`);
  }
  const numbers = tokens.filter((token) => token.kind === "number").length;
  if (numbers % 2 !== 0) {
    throw new InvalidInputError(`Expected the same number of parts for both axes in "${input}"`);
  }
  let seen = 0;
  const half = tokens.findIndex((token) => token.kind === "number" && ++seen === numbers / 2 + 1);
  return [axisFromTokens(tokens.slice(0, half), input), axisFromTokens(tokens.slice(half), input)];
}

/** Degrees from one axis's numbers; minutes and seconds must stay below 60. */
function axisValue(axis: Axis, input: string): number {
  if (axis.numbers.length < 1 || axis.numbers.length > 3) {
    throw new InvalidInputError(`Expected degrees, minutes and seconds at most in "${input}"`);
  }
  const values = axis.numbers.map(Number);
  if (axis.numbers.slice(1).some((text) => /^[+-]/.test(text))) {
    throw new InvalidInputError(`Only the degrees can carry a sign in "${input}"`);
  }
  if (axis.numbers.slice(0, -1).some((text) => text.includes("."))) {
    throw new InvalidInputError(`Only the last part of an angle can have decimals in "${input}"`);
  }
  if (values.slice(1).some((value) => value >= 60)) {
    throw new InvalidInputError(`Minutes and seconds must be below 60 in "${input}"`);
  }
  const negative = axis.numbers[0]?.startsWith("-") ?? false;
  if (negative && axis.hemisphere) {
    throw new InvalidInputError(`Use either a minus sign or a hemisphere letter in "${input}"`);
  }
  const [degrees = 0, minutes = 0, seconds = 0] = values.map(Math.abs);
  const magnitude = degrees + minutes / 60 + seconds / 3600;
  const south = negative || axis.hemisphere === "S" || axis.hemisphere === "W";
  return south ? -magnitude : magnitude;
}

/**
 * Read `52.2297, 21.0122`, `52°13'46.9"N 21°0'43.9"E` or `N 52° 13.782 E 021° 00.732`.
 *
 * @throws {InvalidInputError} When the text is not a pair of angles in range.
 */
export function parseDegrees(input: string): ParsedDegrees {
  const tokens = tokenize(input);
  const [first, second] = splitAxes(tokens, input);
  const longitudeFirst = first.hemisphere === "E" || first.hemisphere === "W";
  if (
    first.hemisphere &&
    second.hemisphere &&
    longitudeFirst === (second.hemisphere === "E" || second.hemisphere === "W")
  ) {
    throw new InvalidInputError(`Expected one N/S and one E/W letter in "${input}"`);
  }
  const [latitudeAxis, longitudeAxis] = longitudeFirst ? [second, first] : [first, second];
  const latitude = axisValue(latitudeAxis, input);
  const longitude = axisValue(longitudeAxis, input);
  assertCoordinates(latitude, longitude);
  const count = Math.max(first.numbers.length, second.numbers.length);
  return { notation: NOTATION_BY_COUNT[count] ?? "decimal", point: { latitude, longitude } };
}

/** Fixed decimals without a stray "-0". */
function fixed(value: number, decimals: number): string {
  const text = value.toFixed(decimals);
  return /^-0(?:\.0*)?$/.test(text) ? text.slice(1) : text;
}

/** `52.229700, 21.012200` with `decimals` places. */
export function formatDecimal(point: GeoPoint, decimals = 6): string {
  return `${fixed(point.latitude, decimals)}, ${fixed(point.longitude, decimals)}`;
}

/** Whole units of the last part, rounded once so 59.96" carries into the next minute. */
function splitAngle(value: number, parts: 2 | 3, decimals: number) {
  const scale = 10 ** decimals;
  const perDegree = (parts === 3 ? 3600 : 60) * scale;
  const units = Math.round(Math.abs(value) * perDegree);
  const degrees = Math.floor(units / perDegree);
  const rest = units - degrees * perDegree;
  if (parts === 2) return { negative: value < 0 && units > 0, degrees, minutes: rest / scale };
  const minutes = Math.floor(rest / (60 * scale));
  return {
    negative: value < 0 && units > 0,
    degrees,
    minutes,
    seconds: (rest - minutes * 60 * scale) / scale,
  };
}

/** `52°13'46.9"N 21°0'43.9"E`, the way Google Maps writes DMS, `decimals` places on seconds. */
export function formatDms(point: GeoPoint, decimals = 1): string {
  const axis = (value: number, positive: string, negative: string): string => {
    const angle = splitAngle(value, 3, decimals);
    const seconds = (angle.seconds ?? 0).toFixed(decimals);
    return `${angle.degrees}°${angle.minutes}'${seconds}"${angle.negative ? negative : positive}`;
  };
  return `${axis(point.latitude, "N", "S")} ${axis(point.longitude, "E", "W")}`;
}

/** `N 52° 13.782' E 021° 00.732'`, the geocaching layout, `decimals` places on minutes. */
export function formatDdm(point: GeoPoint, decimals = 3): string {
  const axis = (value: number, width: number, positive: string, negative: string): string => {
    const angle = splitAngle(value, 2, decimals);
    const minutes = angle.minutes.toFixed(decimals).padStart(decimals > 0 ? decimals + 3 : 2, "0");
    const degrees = String(angle.degrees).padStart(width, "0");
    return `${angle.negative ? negative : positive} ${degrees}° ${minutes}'`;
  };
  return `${axis(point.latitude, 2, "N", "S")} ${axis(point.longitude, 3, "E", "W")}`;
}
