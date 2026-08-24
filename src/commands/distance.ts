/** Compute the great-circle distance between two coordinate pairs */
import { defineCommand } from "citty";
import consola from "consola";
import { bearingBetween, distanceBetween, parseCoordinates } from "../core/coordinates.ts";
import { formatDistanceBearing } from "../core/format.ts";

export default defineCommand({
  meta: {
    name: "distance",
    description:
      'Great-circle distance between two "latitude,longitude" pairs (prefix a negative latitude with "--")',
  },
  args: {
    from: {
      type: "positional",
      description: 'Start point as "latitude,longitude", for example 52.2297,21.0122',
      required: true,
    },
    to: {
      type: "positional",
      description: 'End point as "latitude,longitude", for example 50.0647,19.9450',
      required: true,
    },
  },
  async run({ args }) {
    try {
      const from = parseCoordinates(args.from);
      const to = parseCoordinates(args.to);
      consola.log(formatDistanceBearing(distanceBetween(from, to), bearingBetween(from, to)));
    } catch (error) {
      consola.error(`Error: ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    }
  },
});
