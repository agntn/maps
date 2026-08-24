/** Resolve an address or place to coordinates */
import { defineCommand } from "citty";
import consola from "consola";
import { geocodeAll } from "../core/all.ts";
import { formatGeocodeAll, formatLocations } from "../core/format.ts";
import { requireOperation } from "../core/provider.ts";
import { isAllProviders, selectProvider } from "../core/resolve.ts";

export default defineCommand({
  meta: {
    name: "geocode",
    description: "Resolve an address or place to geographic coordinates",
  },
  args: {
    query: {
      type: "positional",
      description: "Address or place to geocode",
      required: true,
    },
    provider: {
      type: "string",
      alias: "p",
      description: 'Provider, or "all" to compare every provider',
    },
    limit: {
      type: "string",
      alias: "n",
      description: "Maximum number of results",
    },
    language: {
      type: "string",
      alias: "l",
      description: "Preferred language for result names (BCP 47)",
    },
    country: {
      type: "string",
      description: "Comma-separated ISO 3166-1 alpha-2 country codes to restrict results",
    },
  },
  async run({ args }) {
    try {
      let limit: number | undefined;
      if (args.limit !== undefined) {
        limit = Number.parseInt(args.limit, 10);
        if (Number.isNaN(limit) || limit < 1) {
          consola.error(`Invalid limit: ${args.limit}`);
          process.exit(1);
        }
      }

      const options = {
        limit,
        language: args.language,
        countryCodes: args.country
          ?.split(",")
          .map((code) => code.trim())
          .filter((code) => code !== ""),
      };
      if (isAllProviders(args.provider)) {
        consola.log(formatGeocodeAll(args.query, await geocodeAll(args.query, options)));
        return;
      }
      const { name, provider } = selectProvider(args.provider);
      const geocode = requireOperation(provider, "geocode");
      consola.log(formatLocations(name, args.query, await geocode(args.query, options)));
    } catch (error) {
      consola.error(`Error: ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    }
  },
});
