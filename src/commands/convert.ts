/** Convert a location between coordinate formats */
import { defineCommand } from "citty";
import consola from "consola";
import { parseCoordinates } from "../core/coordinates.ts";
import { assertCoordinateFormat, convertCoordinates } from "../core/convert.ts";
import type { CoordinatePrecision, LocalCoordinateFormat } from "../core/convert.ts";
import { InvalidInputError } from "../core/errors.ts";
import { formatConversion } from "../core/format.ts";
import { COORDINATE_FORMATS, type CoordinateFormat } from "../core/types.ts";

/** `geohash=5,maidenhead=4` into a precision map. */
function parsePrecision(text: string): CoordinatePrecision {
  const precision: CoordinatePrecision = {};
  for (const entry of text
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)) {
    const [format = "", value = ""] = entry.split("=").map((part) => part.trim());
    assertCoordinateFormat(format);
    if (format === "what3words" || !/^\d+$/.test(value)) {
      throw new InvalidInputError(`Expected format=number in --precision, got "${entry}"`);
    }
    precision[format as LocalCoordinateFormat] = Number(value);
  }
  return precision;
}

export default defineCommand({
  meta: {
    name: "convert",
    description:
      "Convert coordinates between decimal degrees, DMS, DDM, geohash, Maidenhead, Plus Code, UTM, MGRS and what3words",
  },
  args: {
    input: {
      type: "positional",
      description:
        'Coordinates in any supported format, quoted or not: "52.2297, 21.0122", ezs42, KO02mf, 9G8F+6W, "34U EC 0083 8658"',
      required: true,
    },
    from: {
      type: "string",
      description: `Input format when detection is ambiguous: ${COORDINATE_FORMATS.join(", ")}`,
    },
    to: {
      type: "string",
      description: "Comma-separated formats to print; every local one by default",
    },
    precision: {
      type: "string",
      description: "Comma-separated format=number pairs, for example geohash=5,maidenhead=4",
    },
    near: {
      type: "string",
      description: 'A "latitude,longitude" near the place a short Plus Code belongs to',
    },
    language: {
      type: "string",
      alias: "l",
      description: "Language of the what3words output (needs WHAT3WORDS_API_KEY)",
    },
  },
  async run({ args }) {
    try {
      const input = args._.length > 0 ? args._.join(" ") : args.input;
      const to = args.to
        ?.split(",")
        .map((format) => format.trim())
        .filter(Boolean);
      for (const format of to ?? []) assertCoordinateFormat(format);
      const from = args.from?.trim() || undefined;
      if (from !== undefined) assertCoordinateFormat(from);
      const conversion = await convertCoordinates(input, {
        from,
        to: to as CoordinateFormat[] | undefined,
        precision: args.precision ? parsePrecision(args.precision) : undefined,
        reference: args.near ? parseCoordinates(args.near) : undefined,
        language: args.language,
      });
      consola.log(formatConversion(conversion));
    } catch (error) {
      consola.error(`Error: ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    }
  },
});
