/** Resolve coordinates to the place at or nearest to them */
import { defineCommand } from "citty";
import consola from "consola";
import { reverseAll, reverseWithFallback } from "../core/all.ts";
import { parseCoordinates } from "../core/coordinates.ts";
import { formatLocation, formatReverseAll } from "../core/format.ts";
import { requireOperation } from "../core/provider.ts";
import { isAllProviders, selectProvider } from "../core/resolve.ts";
import { REVERSE_GRANULARITIES } from "../core/types.ts";
import type { ReverseGranularity } from "../core/types.ts";

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
      description: 'Provider, or "all" to compare every provider',
    },
    language: {
      type: "string",
      alias: "l",
      description: "Preferred language for result names (BCP 47)",
    },
    granularity: {
      type: "string",
      alias: "g",
      description: `Result granularity: ${REVERSE_GRANULARITIES.join(", ")}`,
    },
  },
  async run({ args }) {
    try {
      if (
        args.granularity !== undefined &&
        !REVERSE_GRANULARITIES.includes(args.granularity as ReverseGranularity)
      ) {
        consola.error(
          `Invalid granularity: ${args.granularity} (use ${REVERSE_GRANULARITIES.join(", ")})`,
        );
        process.exit(1);
      }
      const options = {
        language: args.language,
        granularity: args.granularity as ReverseGranularity | undefined,
      };
      const { latitude, longitude } = parseCoordinates(args.coordinates);
      if (isAllProviders(args.provider)) {
        const outcomes = await reverseAll(latitude, longitude, options);
        consola.log(formatReverseAll(outcomes));
        return;
      }
      if (args.provider?.trim()) {
        const { name, provider } = selectProvider(args.provider);
        const reverse = requireOperation(provider, "reverse");
        const location = await reverse(latitude, longitude, options);
        consola.log(formatLocation(name, location));
        return;
      }
      const fallback = await reverseWithFallback(latitude, longitude, options);
      consola.log(formatLocation(fallback.provider, fallback.result));
    } catch (error) {
      consola.error(`Error: ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    }
  },
});
