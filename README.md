# @agntn/maps

[![npm version](https://npmx.dev/api/registry/badge/version/@agntn/maps)](https://npmx.dev/package/@agntn/maps)
[![npm downloads](https://npmx.dev/api/registry/badge/downloads/@agntn/maps)](https://npmx.dev/package/@agntn/maps)
[![license](https://npmx.dev/api/registry/badge/license/@agntn/maps)](https://npmx.dev/package/@agntn/maps)
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/agntn/maps)

🗺️ Two geocoders, one TypeScript shape, nine coordinate formats. Turn places into coordinates, or ask what's at a coordinate pair.

## Why?

You want a latitude and longitude, not another afternoon mapping JSON fields. Nominatim calls it `lon`, Google calls it `lng`. Maps gives your scripts and agents the same result shape from either provider.

## ✨ Features

- 📍 **Place names or address parts in.** Search free text, or pass a structured address without building a query string yourself.
- 🧩 **One result shape out.** WGS 84 coordinates, with address fields and a bounding box when available.
- 🎯 **A narrower search.** Filter by country or layer: `address`, `poi`, `natural`. Ask for reverse results at country, state, city, street or building level.
- 🧭 **Every coordinate dialect.** DMS, DDM, geohash, Maidenhead, Plus Codes, UTM and MGRS, converted locally. what3words too, if you bring a key.
- 📏 **Distance and bearing, offline.** Great-circle distance in meters and initial bearing in degrees. No provider involved.
- 🤖 **A choice of interfaces.** CLI, TypeScript, MCP, Pi, OMP and Vercel AI SDK tools.
- 🔀 **Two opinions on one place.** Compare Google and Nominatim side by side. A failed lookup stays visible too.

## 📦 Install

```bash
pnpm add @agntn/maps
```

Node.js 26 or newer. The npm release is pending, so registry installs need publication first. Until then, use the [source checkout](#development).

## 🚀 First call

```bash
npx @agntn/maps geocode "Pałac Kultury i Nauki, Warszawa" --provider openstreetmap --language en --limit 1
```

Output from the local build:

```text
[openstreetmap] 1 matches for "Pałac Kultury i Nauki, Warszawa":
52.2317657, 21.0057979  Palace of Culture and Science, 1, Plac Defilad, Żelazna Brama, Śródmieście Północne, Midtown, Warsaw, Masovian Voivodeship, 00-110, Poland
  category attraction; country pl; address houseNumber 1, road Plac Defilad, city Warsaw, state Masovian Voivodeship, postcode 00-110, country Poland; bounds 52.2304141..52.2331217 lat, 21.0043177..21.0080405 lon
```

That's a fairly long way of saying "the big building in Warsaw". The indented line is the rest of what Nominatim knows. An attraction. Fair enough.
Data: [© OpenStreetMap contributors, ODbL](https://www.openstreetmap.org/copyright).

No API key needed for this lookup. Public Nominatim allows **at most one request per second across your application**. Space out calls yourself: Maps doesn't throttle them. No bulk jobs or autocomplete against that instance. Read its [usage policy](https://operations.osmfoundation.org/policies/nominatim/) before using it, and don't send confidential data.

After a registry install, use `pnpm exec maps` for the commands below. In a built checkout, replace `maps` with `node dist/cli.mjs`.

How far is Kraków from Warsaw? This one stays offline:

```bash
maps distance 52.2297,21.0122 50.0647,19.9450
```

```text
Distance: 251.98 km (251977 m)
Bearing: 197.6°
```

Warsaw to Kraków, from the local build. That's across a sphere, not along the motorway. Your car may have objections.

Got a geohash from a puzzle? Paste it:

```bash
maps convert ezs42
```

```text
geohash ezs42 -> 42.60498046875, -5.60302734375
Cell: 42.5830078125..42.626953125 lat, -5.625..-5.5810546875 lon
  decimal     42.604980, -5.603027
  dms         42°36'17.9"N 5°36'10.9"W
  ddm         N 42° 36.299' W 005° 36.182'
  geohash     ezs42
  maidenhead  IN72eo
  pluscode    8CJPJ93W+XQ
  utm         30T 286471 4720235
  mgrs        30T TN 86471 20234
```

`ezs42` isn't a point. It's a box about 4.9 km tall on the edge of León. So you get the cell, and every other format describes its middle. No format flag needed. Maps reads the shape. A lowercase `jn58td` fits both a geohash and a locator, though. Then it asks.

### Commands

| Command     | Use it for                     | Example                                                       |
| ----------- | ------------------------------ | ------------------------------------------------------------- |
| `geocode`   | A place name or address        | `maps geocode "Rynek, Wrocław"`                               |
| `address`   | Address parts you already have | `maps address --road Złota --house-number 44 --city Warszawa` |
| `reverse`   | What's at these coordinates?   | `maps reverse 52.2318,21.0067`                                |
| `distance`  | Distance and initial bearing   | `maps distance 52.2297,21.0122 50.0647,19.9450`               |
| `convert`   | One location, every format     | `maps convert "N 52° 13.782 E 021° 00.732"`                   |
| `providers` | Provider keys and capabilities | `maps providers`                                              |
| `mcp`       | A stdio MCP server             | `maps mcp`                                                    |

Options are spelled out: `--provider`, `--language`, `--limit`. Lists and objects go in as JSON. Looking for a landmark rather than streets named after it? Try `--layers '["poi"]'`. Want the data, not the text? Add `--json`. Each command has `--help`.

A negative latitude needs a separator: `maps reverse -- -33.86,151.21`. A short Plus Code like `9G8F+6W` needs a point nearby, `--reference '{"latitude":52.2,"longitude":21}'`.

## 🧠 Library

```typescript
import { create, distanceBetween, parseCoordinates } from "@agntn/maps";

const provider = create("openstreetmap");
const [place] = await provider.geocode("Pałac Kultury i Nauki, Warszawa", { limit: 1 });
console.log(place?.latitude, place?.longitude, place?.address?.city);

const from = parseCoordinates("52.2297,21.0122");
const to = parseCoordinates("50.0647,19.9450");
console.log(distanceBetween(from, to));
```

Have address parts? Use `provider.geocodeAddress()`. Coordinates? Use `provider.reverse(latitude, longitude)`. Direct calls stick to one provider. For automatic fallback, use `geocodeWithFallback`. For comparison, use `geocodeAll`. Both have structured-address and reverse variants.

Coordinates in some other notation? `convertCoordinates("34U EC 0083 8658")` reads it and writes the rest.

Address fields are optional. Check `capabilities` for custom providers. Coordinate helpers validate ranges before reverse requests.

[Public exports](./src/index.ts) · [Options and results](./src/core/types.ts) · [Provider contract](./src/core/provider.ts)

## 🗺️ Providers

| Key             | Credentials               | Forward result cap |
| --------------- | ------------------------- | ------------------ |
| `openstreetmap` | None for public Nominatim | 40                 |
| `googlemaps`    | `GOOGLE_MAPS_API_KEY`     | 20                 |

CLI and agent tools select Google when its key is configured, otherwise OpenStreetMap. They fall back on auth, billing, rate-limit errors or unsupported operations. Other failures propagate. An explicit provider is never replaced. Pass `--provider all` in the CLI to compare providers in parallel, with errors kept beside successful results.

For Google, enable the Geocoding API and supply its key through the environment. Follow [Google's usage and attribution rules](https://developers.google.com/maps/documentation/geocoding/policies). Maps redacts secret query parameters from error messages, including Google's `key` parameter.

what3words is the one conversion that leaves your machine. Set `WHAT3WORDS_API_KEY` and Maps sends it in a header, never in the URL. Without it, `convert` just skips three words.

For regular or bulk Nominatim work, use your own instance through `create("openstreetmap", { baseUrl })`. Maps sends an identifying User-Agent. Provider limits still apply when a call falls back or uses `all`.

## 🤖 Agents

After publication, pick your host:

```bash
pi install npm:@agntn/maps
omp install @agntn/maps
```

Or add Maps to an MCP client:

```json
{
  "mcpServers": {
    "maps": { "command": "npx", "args": ["-y", "@agntn/maps", "mcp"] }
  }
}
```

Read-only tools: `maps_providers`, `maps_geocode`, `maps_geocode_address`, `maps_reverse`, `maps_distance` and `maps_convert`. Every host gets the same set and the same text, indented facts included. The provider's own record stays out. Need `osm_id` or `place_id`? Pass `raw: true`. No need to carry the whole suitcase for a postcode.

With a built checkout, use `pi install .` or `omp install .`. For MCP, use `node` with the absolute path to `dist/cli.mjs`, followed by `mcp`.

Using Vercel AI SDK? Install `ai` too. `@agntn/maps/ai` exports `geocodeTool`, `geocodeAddressTool`, `reverseTool`, `distanceTool`, `convertTool` and `providersTool`. You get the data back, with that same text in `text`. The `raw` flag works there too. Bring your own MCP transport with the `@agntn/maps/mcp` export, `createMcpServer`.

[Tool definitions](./src/tools.ts) · [MCP server](./src/mcp.ts) · [AI SDK tools](./src/ai.ts) · [Pi](./packages/pi/extensions/maps.ts) · [OMP](./packages/omp/extensions/maps.ts)

## 🚫 What this does not do

No routes, traffic estimates or map tiles. Distance means great-circle distance, not driving distance. Finding an address doesn't validate it for postal delivery either. UTM and MGRS stop at 80°S and 84°N, the poles need UPS.

## 🧩 Adding a provider

Got another geocoder? The [Nominatim implementation](./src/providers/openstreetmap.ts) shows the whole adapter, including its `register()` call. Yours needs the same [Provider contract](./src/core/provider.ts) and an import in [the provider index](./src/providers/index.ts).

<a id="development"></a>

## 🛠️ Development

From this repository's checkout:

```bash
pnpm install
pnpm build       # Build the library, CLI, MCP and AI SDK entrypoints
pnpm fmt         # Apply lint fixes and formatting
pnpm lint        # Check lint and formatting
pnpm typecheck   # Check the library and extensions
pnpm test        # Run mocked unit tests
```

Try the CLI with `node dist/cli.mjs` in place of `maps`. For integration checks without live geocoding:

```bash
MAPS_EVAL_OFFLINE=1 pnpm test:cli
MAPS_EVAL_OFFLINE=1 pnpm test:mcp
pnpm test:packed
```

## 💛 Thanks

Built with support from [Claude for Open Source](https://claude.com/contact-sales/claude-for-oss) and [Codex for Open Source](https://developers.openai.com/community/codex-for-oss). Thanks for giving small packages room to grow.

## 📄 License

[MIT](./LICENSE) covers the code. Provider data keeps its own licensing and attribution requirements.
