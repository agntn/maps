/** Compute the great-circle distance between two coordinate pairs */
import { defineCommand } from "citty";
import consola from "consola";
import { distanceBetween, parseCoordinates } from "../core/coordinates.ts";
import { formatDistance } from "../core/format.ts";

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
      const meters = distanceBetween(parseCoordinates(args.from), parseCoordinates(args.to));
      consola.log(`Distance: ${formatDistance(meters)}`);
    } catch (error) {
      consola.error(`Error: ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    }
  },
});
