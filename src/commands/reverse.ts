/** Resolve coordinates to the place at or nearest to them */
import { defineCommand } from "citty";
import consola from "consola";
import { parseCoordinates } from "../core/coordinates.ts";
import { formatLocation } from "../core/format.ts";
import { requireOperation } from "../core/provider.ts";
import { selectProvider } from "../core/resolve.ts";

export default defineCommand({
  meta: {
    name: "reverse",
    description:
      'Resolve "latitude,longitude" to the nearest place (prefix a negative latitude with "--")',
  },
  args: {
    coordinates: {
      type: "positional",
      description: 'Coordinate pair as "latitude,longitude", for example 52.2318,21.0067',
      required: true,
    },
    provider: {
      type: "string",
      alias: "p",
      description: "Provider",
    },
    language: {
      type: "string",
      alias: "l",
      description: "Preferred language for result names (BCP 47)",
    },
  },
  async run({ args }) {
    try {
      const { latitude, longitude } = parseCoordinates(args.coordinates);
      const { name, provider } = selectProvider(args.provider);
      const reverse = requireOperation(provider, "reverse");
      const location = await reverse(latitude, longitude, { language: args.language });
      consola.log(formatLocation(name, location));
    } catch (error) {
      consola.error(`Error: ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    }
  },
});
