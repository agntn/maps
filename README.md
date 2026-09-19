# @agntn/maps

[![npm version](https://npmx.dev/api/registry/badge/version/@agntn/maps)](https://npmx.dev/package/@agntn/maps)
[![npm downloads](https://npmx.dev/api/registry/badge/downloads/@agntn/maps)](https://npmx.dev/package/@agntn/maps)
[![license](https://npmx.dev/api/registry/badge/license/@agntn/maps)](https://npmx.dev/package/@agntn/maps)
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/agntn/maps)

🗺️ Two geocoders, one TypeScript shape. Turn places into coordinates, or ask what's at a coordinate pair.

## Why?

You want a latitude and longitude, not another afternoon mapping JSON fields. Nominatim calls it `lon`, Google calls it `lng`. Maps gives your scripts and agents the same result shape from either provider.

## Start with a place

Requires **Node.js 24+**. **Not published to npm yet.** Use the [source checkout](#development) for now. Registry commands and agent installs need a release first.

After publication:

```bash
pnpm add @agntn/maps
```

Or run a lookup without adding it to your project:

```bash
npx @agntn/maps geocode "Pałac Kultury i Nauki, Warszawa" -p openstreetmap -l en -n 1
```

Output from the local build:

```text
[openstreetmap] 1 matches for "Pałac Kultury i Nauki, Warszawa":
52.2317657, 21.0057979  Palace of Culture and Science, 1, Plac Defilad, Żelazna Brama, Śródmieście Północne, Midtown, Warsaw, Masovian Voivodeship, 00-110, Poland
```

That's a fairly long way of saying "the big building in Warsaw".
Data: [© OpenStreetMap contributors, ODbL](https://www.openstreetmap.org/copyright).

No API key needed for this lookup. Public Nominatim allows **at most one request per second across your application**. Space out calls yourself: Maps doesn't throttle them. No bulk jobs or autocomplete against that instance. Read its [usage policy](https://operations.osmfoundation.org/policies/nominatim/) before using it, and don't send confidential data.

## What you get

- **Place names or address parts in.** Search free text, or pass a structured address without building a query string yourself.
- **One result shape out.** WGS 84 coordinates, with address fields and a bounding box when available.
- **A narrower search.** Filter by country or layer: `address`, `poi`, `natural`. Ask for reverse results at country, state, city, street or building level.
- **Distance and bearing, offline.** Great-circle distance in meters and initial bearing in degrees. No provider involved.
- **A choice of interfaces.** CLI, TypeScript, MCP, Pi, OMP and Vercel AI SDK tools.

## From the terminal

After a registry install, use `pnpm exec maps` for the commands below. In a built checkout, replace `maps` with `node dist/cli.mjs`.

| Command     | Use it for                     | Example                                                |
| ----------- | ------------------------------ | ------------------------------------------------------ |
| `geocode`   | A place name or address        | `maps geocode "Rynek, Wrocław"`                        |
| `address`   | Address parts you already have | `maps address --road Złota --house 44 --city Warszawa` |
| `reverse`   | What's at these coordinates?   | `maps reverse 52.2318,21.0067`                         |
| `distance`  | Distance and initial bearing   | `maps distance 52.2297,21.0122 50.0647,19.9450`        |
| `providers` | Provider keys and capabilities | `maps providers`                                       |
| `mcp`       | A stdio MCP server             | `maps mcp`                                             |

Use `-p` for a provider and `-l` for a preferred language. Forward searches accept `-n` for the result limit. `geocode` also takes `--country us` and `--layer poi`. Looking for a landmark rather than streets named after it? Try `poi`. Each command has `--help`.

A negative latitude needs a separator: `maps reverse -- -33.86,151.21`.

### How far, without asking anyone

```bash
maps distance 52.2297,21.0122 50.0647,19.9450
```

```text
Distance: 251.98 km (251977 m)
Bearing: 197.6°
```

Warsaw to Kraków, from the local build. That's across a sphere, not along the motorway. Maps doesn't provide routes, travel times or map tiles.

## Pick a provider

| Key             | Credentials               | Forward result cap |
| --------------- | ------------------------- | ------------------ |
| `openstreetmap` | None for public Nominatim | 40                 |
| `googlemaps`    | `GOOGLE_MAPS_API_KEY`     | 20                 |

CLI and agent tools select Google when its key is configured, otherwise OpenStreetMap. They fall back on auth, billing, rate-limit errors or unsupported operations. Other failures propagate. An explicit provider is never replaced. Pass `-p all` in the CLI to compare providers in parallel, with errors kept beside successful results.

For Google, enable the Geocoding API and supply its key through the environment. Follow [Google's usage and attribution rules](https://developers.google.com/maps/documentation/geocoding/policies). Maps redacts secret query parameters from error messages, including Google's `key` parameter.

For regular or bulk Nominatim work, use your own instance through `create("openstreetmap", { baseUrl })`. Maps sends an identifying User-Agent. Provider limits still apply when a call falls back or uses `all`.

## In TypeScript

```typescript
import { create, distanceBetween, parseCoordinates } from "@agntn/maps";

const provider = create("openstreetmap");
const [place] = await provider.geocode("Pałac Kultury i Nauki, Warszawa", { limit: 1 });
console.log(place?.latitude, place?.longitude, place?.address?.city);

const from = parseCoordinates("52.2297,21.0122");
const to = parseCoordinates("50.0647,19.9450");
console.log(distanceBetween(from, to));
```

Already have street and city fields? Use `provider.geocodeAddress()`. Going the other way? Use `provider.reverse(latitude, longitude)`. Direct provider calls don't switch backends. Choose `geocodeWithFallback` for that, or `geocodeAll` to compare them. Structured-address and reverse variants are exported too.

See the [public exports](./src/index.ts), [options and result types](./src/core/types.ts), and [provider capabilities](./src/core/provider.ts). Coordinate helpers validate ranges before reverse requests. Address fields are optional, so don't assume every result has a postcode.

## Give your agent a map, minus the map

### MCP

For clients using an `mcpServers` configuration, after publication:

```json
{
  "mcpServers": {
    "maps": {
      "command": "npx",
      "args": ["-y", "@agntn/maps", "mcp"]
    }
  }
}
```

From a checkout, use `node` as the command. Set `args` to the absolute path of `dist/cli.mjs`, followed by `mcp`.

Five read-only tools: `maps_providers`, `maps_geocode`, `maps_geocode_address`, `maps_reverse` and `maps_distance`. Geocoding results omit the provider's original record by default. Pass `raw: true` when you need fields like `osm_id` or `place_id`. Hosts managing their own transport can import `createMcpServer` from `@agntn/maps/mcp`.

### Pi and OMP

After publication, pick your host:

```bash
pi install npm:@agntn/maps
omp install @agntn/maps
```

Both expose the same five tools. From a source checkout, use `pi install .` or `omp install .` instead. Build first. See the [Pi extension](./packages/pi/extensions/maps.ts) and [OMP extension](./packages/omp/extensions/maps.ts).

### Vercel AI SDK

Install `ai` alongside Maps to use `@agntn/maps/ai`. It exports `geocodeTool`, `geocodeAddressTool`, `reverseTool`, `distanceTool` and `providersTool`. The geocoding tools accept the same `raw` flag as MCP. See the [tool definitions](./src/ai.ts) for input and output shapes.

## Development

From this repository's checkout:

```bash
pnpm install
pnpm build
node dist/cli.mjs geocode "Pałac Kultury i Nauki, Warszawa" -p openstreetmap -l en -n 1
```

`pnpm test` runs mocked unit tests. `pnpm lint` checks lint and formatting, and `pnpm typecheck` checks the library and extensions. `pnpm fmt` applies formatting and lint fixes.

For CLI and MCP integration tests without live requests:

```bash
MAPS_EVAL_OFFLINE=1 pnpm test:cli
MAPS_EVAL_OFFLINE=1 pnpm test:mcp
pnpm test:packed
```

Adding a provider? Start with the [base class](./src/core/provider.ts) and [Nominatim implementation](./src/providers/openstreetmap.ts). Register it in [the provider index](./src/providers/index.ts).

## Thanks

Built with support from [Claude for Open Source](https://claude.com/contact-sales/claude-for-oss) and [Codex for Open Source](https://developers.openai.com/community/codex-for-oss). Thanks for giving small packages room to grow.

## License

[MIT](./LICENSE) covers the code. Provider data keeps its own licensing and attribution requirements.
