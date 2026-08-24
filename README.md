# Maps

Two geocoding APIs, one shape.

Every maps platform answers the same two questions - "where is this place?" and "what is at these coordinates?" - in a completely different format. Maps deals with that mess and gives scripts, agents and humans one TypeScript API and one CLI for forward and reverse geocoding, with coordinate validation built in.

## Features

- **Two providers, one contract.** OpenStreetMap (Nominatim) and Google Maps.
- **Works before the first key.** The public Nominatim instance answers without any API key, so `maps geocode "Pałac Kultury i Nauki"` just works.
- **Coordinate checking.** `isValidCoordinates`, `assertCoordinates` and `parseCoordinates` validate WGS 84 latitude/longitude pairs before any request leaves the machine.
- **Honest capabilities.** A provider declares what it can serve; unsupported operations throw `UnsupportedOperationError` instead of pretending.
- **CLI, library, MCP and agent extensions.** Use the same provider contract from a terminal, TypeScript, an MCP client, OMP, Pi or the Vercel AI SDK.
- **Keys never leak.** Error messages redact secret query params - the Google Maps `key` included - before anyone sees them.

## Install

```bash
pnpm add @agntn/maps
```

Requires Node.js 24 or newer.

## CLI

```bash
npx @agntn/maps providers
npx @agntn/maps geocode "Pałac Kultury i Nauki, Warszawa"
npx @agntn/maps reverse 52.2318,21.0067
npx @agntn/maps geocode "Springfield" --country us -n 5
```

### Commands

| Command     | What it does                                | Example                         |
| ----------- | ------------------------------------------- | ------------------------------- |
| `geocode`   | Address or place to coordinates             | `maps geocode "Rynek, Wrocław"` |
| `reverse`   | `latitude,longitude` to the nearest place   | `maps reverse 52.2318,21.0067`  |
| `providers` | Registered providers and their capabilities | `maps providers`                |
| `mcp`       | MCP server over stdio                       | `maps mcp`                      |

For a coordinate pair that starts with a minus, put `--` before it: `maps reverse -- -33.86,151.21`.

### Common options

| Option           | Meaning                                                 |
| ---------------- | ------------------------------------------------------- |
| `-p, --provider` | Provider key: `openstreetmap` or `googlemaps`           |
| `-l, --language` | Preferred language for result names (BCP 47, e.g. `pl`) |
| `-n, --limit`    | Maximum number of results for `geocode`                 |
| `--country`      | Comma-separated ISO country codes to restrict `geocode` |

Without `--provider`, Maps first checks configured API keys and then falls back to OpenStreetMap, which needs no key at all.

## Providers

| Provider      | Auth                  | Notes                                                                 |
| ------------- | --------------------- | --------------------------------------------------------------------- |
| openstreetmap | none                  | Public Nominatim; usage policy: max 1 request/second, no bulk traffic |
| googlemaps    | `GOOGLE_MAPS_API_KEY` | Google Maps Platform Geocoding API                                    |

## TypeScript

```typescript
import { create, resolveProvider, parseCoordinates } from "@agntn/maps";

const provider = create(resolveProvider());

const [best] = await provider.geocode("Pałac Kultury i Nauki, Warszawa", { limit: 1 });
console.log(best?.latitude, best?.longitude, best?.displayName);

const { latitude, longitude } = parseCoordinates("52.2318,21.0067");
const place = await provider.reverse(latitude, longitude, { language: "pl" });
console.log(place.displayName);
```

Check `provider.capabilities` before calling an operation - future backends may not serve both.

## MCP

The package ships an MCP server with three read-only tools (`maps_providers`, `maps_geocode`, `maps_reverse`):

```bash
claude mcp add maps --scope user -- npx @agntn/maps mcp
```

Hosts with their own transport can import the server factory from `@agntn/maps/mcp`.

## Agent extensions

Maps ships separate entrypoints for OMP and Pi. Install the published package in OMP:

```bash
omp install @agntn/maps
```

From a source checkout, link the local package instead with `omp install .`. OMP loads `packages/omp/extensions/maps.ts` through the package's `omp.extensions` manifest; Pi loads `packages/pi/extensions/maps.ts` the same way. Both register the same three read-only tools as the MCP server.

## AI SDK

`@agntn/maps/ai` exports the same operations as Vercel AI SDK tools: `geocodeTool`, `reverseTool` and `providersTool`.

## License

MIT
