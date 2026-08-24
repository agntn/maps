/** Resolve a structured postal address to coordinates */
import { defineCommand } from "citty";
import consola from "consola";
import { geocodeAddressAll } from "../core/all.ts";
import { formatAddressLabel, formatGeocodeAll, formatLocations } from "../core/format.ts";
import { requireOperation } from "../core/provider.ts";
import { isAllProviders, selectProvider } from "../core/resolve.ts";

export default defineCommand({
  meta: {
    name: "address",
    description: "Resolve a structured postal address (street, city, postcode, ...) to coordinates",
  },
  args: {
    house: {
      type: "string",
      description: "House or building number",
    },
    road: {
      type: "string",
      description: "Street name",
    },
    city: {
      type: "string",
      description: "City, town, or village name",
    },
    state: {
      type: "string",
      description: "State, province, or region name",
    },
    postcode: {
      type: "string",
      description: "Postal code",
    },
    country: {
      type: "string",
      description: "Country name or ISO code",
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

      const address = {
        houseNumber: args.house,
        road: args.road,
        city: args.city,
        state: args.state,
        postcode: args.postcode,
        country: args.country,
      };
      const options = { limit, language: args.language };
      const label = formatAddressLabel(address);
      if (isAllProviders(args.provider)) {
        consola.log(formatGeocodeAll(label, await geocodeAddressAll(address, options)));
        return;
      }
      const { name, provider } = selectProvider(args.provider);
      const geocodeAddress = requireOperation(provider, "geocodeAddress");
      consola.log(formatLocations(name, label, await geocodeAddress(address, options)));
    } catch (error) {
      consola.error(`Error: ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    }
  },
});
