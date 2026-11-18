# maps - AGENTS.md

## Scope

Unified geocoding provider library. Normalizes forward geocoding (free-form and structured-address input), reverse geocoding, and structured address output across providers, with coordinate validation, local distance plus bearing along the great circle (haversine) or a rhumb line, and coordinate format conversion in core. Exports a CLI (`maps` binary), a programmatic API, an MCP server (`@agntn/maps/mcp`), Vercel AI SDK tools (`@agntn/maps/ai`), and Pi/OMP extensions. Every surface but the library takes one tool list from `src/tools.ts` through the `@agntn/tools` adapters.

## Providers

| Provider      | Auth                             | Capabilities                     | Notes                                            |
| ------------- | -------------------------------- | -------------------------------- | ------------------------------------------------ |
| openstreetmap | none                             | geocode, geocodeAddress, reverse | Public Nominatim; usage policy: max 1 req/s      |
| googlemaps    | `GOOGLE_MAPS_API_KEY` (required) | geocode, geocodeAddress, reverse | Geocoding API; errors ride in-body with HTTP 200 |

## API audit (2026-08-24)

Live verification performed before scaffolding, per the agntn scaffold procedure:

- **Nominatim** (`nominatim.openstreetmap.org`): `/search?q=...&format=jsonv2`, structured `/search?street=44+Złota&city=Warszawa` (street carries "housenumber streetname"), and `/reverse?lat=..&lon=..&format=jsonv2` verified 200 without a key. Requires an identifying `User-Agent` (the shared client sends `agntn-maps/<version> (...)`). Reverse failures come back as `{ "error": "Unable to geocode" }` with HTTP 200. `boundingbox` is `[south, north, west, east]` as strings; `search` caps `limit` at 40.
- **Google Geocoding** (`maps.googleapis.com/maps/api/geocode/json`): alive; without a key answers HTTP 200 with `{ status: "REQUEST_DENIED", error_message: ... }` - key-gated, mapped defensively from documented shapes. Every failure (`REQUEST_DENIED`, `OVER_QUERY_LIMIT`, `INVALID_REQUEST`, `ZERO_RESULTS`) travels in the JSON body with HTTP 200; the provider maps `status` onto the error hierarchy in `assertOkStatus()`. There is no server-side result limit - the provider slices locally.

## Conventions

- Coordinates are WGS 84 decimal degrees; validation lives in `core/coordinates.ts` (`isValidLatitude`, `isValidLongitude`, `isValidCoordinates`, `assertCoordinates`, `parseCoordinates`) and every provider `reverse()` calls `assertCoordinates` before building a URL
- `GeoLocation.countryCode` is lowercase ISO 3166-1 alpha-2 on both providers (Google `short_name` is lowercased to match Nominatim)
- `GeoLocation.address` is the normalized `GeoAddress`; city fallback chains are provider-specific (Nominatim: `city ?? town ?? village ?? hamlet ?? municipality`; Google: `locality ?? postal_town`), Google address fields use `long_name` (only `countryCode` reads `short_name`), and an all-empty address collapses onto `undefined` via `compactAddress()`
- `BoundingBox` is `{ south, north, west, east }`; Nominatim's string quadruple and Google's `viewport` both map onto it
- Provider registration is a class side effect: each concrete class owns a static `key`, and importing `src/providers/index.ts` triggers all `register()` calls - because of that, `package.json` must NOT declare `sideEffects: false`
- One obuild bundle with five inputs (`index`, `cli`, `mcp`, `ai`, `tools`) so every entry shares the chunk holding the registry
- Error hierarchy: `MapsError` → `HTTPError`, `AuthError`, `PaymentError` (402), `RateLimitError`, `NotFoundError`, `UnsupportedOperationError`, `UnknownProviderError`, `InvalidInputError`; `normalizeError()` wraps everything at the client boundary
- `MapsError` sanitizes messages: secret query params (`key`, `api[-_]key`, `secret`, `token`) are redacted - this covers the Google Maps `key` param
- Internal imports use explicit `.ts` extensions (nodenext + `allowImportingTsExtensions`); `erasableSyntaxOnly` forbids parameter properties
- Provider auto-selection: `resolveProvider()` checks the env keys listed in `ENV_MAP` (built-in providers only; an externally registered provider must be selected explicitly), falls back to `openstreetmap`
- `selectProvider()` in `core/resolve.ts` is the single provider selection path for the CLI, MCP, AI tools, and both extensions; empty or whitespace-only arguments count as absent
- The provider value `all` is reserved: surfaces test it with `isAllProviders()` before `selectProvider()` and route to the parallel fan-out in `core/all.ts` (`geocodeAll`/`geocodeAddressAll`/`reverseAll`); failures stay in the outcome list (`ProviderOutcome`), JSON surfaces reduce them via `serializeOutcomes()`, text surfaces render via `formatGeocodeAll`/`formatReverseAll`
- Cancellation rides on `ProviderConfig.signal`: the base `Provider` joins it to every request, `selectProvider()` and the `core/all.ts` helpers take it as their last argument, and each executor in `src/tool-operations.ts` gets the host's signal from the `execute` context of `@agntn/tools`. An aborted fallback walk stops at the provider it reached, whatever that provider threw
- Auto-selected requests (no provider given) go through the `*WithFallback` trio in `core/all.ts`: auth, billing, rate-limit, and unsupported-operation failures skip to the next provider, anything else propagates, and when everything is skipped the first skip reason is thrown; an explicit provider is never substituted
- Reverse `granularity` (country/state/city/street/building) maps onto Nominatim `zoom` (3/5/10/16/18) and the Google `result_type` filter (country/administrative_area_level_1/locality/route/street_address)
- Forward `layers` (address/poi/natural, `GEOCODE_LAYERS`) maps 1:1 onto the Nominatim `layer` filter; the Google Geocoding API has no request-side layer filter, so `googlemaps` partitions each result by its `types` locally (`natural_feature` → natural, `POI_TYPES` → poi, anything else → address) before the limit is applied. Nominatim's `railway` and `manmade` layers stay out of the API because Google has no counterpart. An empty list means no filter, like `countryCodes`
- `GeoLocation.raw` stays on the library type, but the tools send it only when the call passes `raw: true` (`raw` in `src/tools.ts`, `trimLocation`/`trimLocations` in `core/types.ts`, the `view` argument of `serializeOutcomes` for the `all` path, and the `raw` option of the location formatters): the record repeats the normalized fields and was two thirds of a default `maps_geocode` answer (52 kB for 36 Nominatim results)
- Every host gets the same tool text, built by the `core/format.ts` formatters, with the data as `details` (AI SDK output, CLI `--json`). MCP sees only the text, so a list line carries its facts on an indented line below (category, country, address under `GeoAddress` field names, bounds). `answer()` in `src/tool-operations.ts` strips escapes, controls and bidi marks from that text, keeping lines and indents
- `maps mcp` from a checkout serves `src/`, so a change costs a restart, not `pnpm build`; only an edit to `src/cli.ts` itself still needs the build. `MAPS_DIST=1`, a copy under `node_modules`, a tree without `src/` and Node run with `--no-strip-types` keep the bundle. Served from `src/`, the server refuses every call once anything under `src/` changed after the process started, and drops the answer of a call the change landed in: loaded modules stay cached, so a lazy import would mix old and new code. Its own `tools/call` handler forwards no progress notifications; no maps tool sends any
- Capability gating goes through `requireOperation()` in `core/provider.ts`; text rendering through the `format*` helpers in `core/format.ts` - do not re-implement either per surface
- Structured geocoding takes the same `GeoAddress` shape the results use; `assertAddress()` rejects an all-empty input, Nominatim gets `street`/`city`/`state`/`postalcode`/`country` params, Google gets house number and street in the free-form `address` param plus the rest as a `components` filter (its filter has no street_number type)

- Coordinate conversion lives in `core/convert.ts` (`convertCoordinates`, `decodeCoordinates`, `encodeCoordinates`, `detectCoordinateFormats`) over `core/degrees.ts` (decimal, DMS, DDM), `core/grids.ts` (geohash, Maidenhead, Plus Code), `core/utm.ts` (UTM and MGRS through Krüger's series to third order, about a millimeter inside a zone) and `core/what3words.ts`. `COORDINATE_FORMATS` sits in `core/types.ts` so schemas don't import the codecs
- Detection reads the shape: geohash only matches lower case, so an upper case code is a locator or MGRS, and a lower case one matching both throws and asks for `from`. A degree pair that fails detection rethrows the parser's own reason, and an explicit `from` of decimal, dms or ddm must match the notation written. Both axes need the same number of parts
- Grid inputs carry `bounds`; every other format is written for the cell center. The input's own format echoes its canonical form unless `precision` names that format. A precision the format lacks always throws, `to` or not, from the one `PRECISIONS` table the schemas mirror as discrete values. Without `to`, a format that can't hold the point (UTM and MGRS past 84°N or 80°S, the UPS caps; a 1e-6° roundoff past the edge still reads as the edge) lands in `skipped`; with `to` it throws
- Plus Code encoding floors `lat * 2.5e7` like Google's reference JS and Java, so it matches them byte for byte and differs from 13 rows of `test_data/encoding.csv` exactly where they do. Short codes need `reference` (`recoverNearest`)
- MGRS truncates digits and prints `34U EC 0083 8658` with an unpadded zone; GeographicLib writes `34UEC00838658`, and both parse. Decoding picks the 2000 km row cycle that reaches the latitude band and rejects a square whose center falls more than 1° outside it. A cell over the antimeridian keeps `west > east`, as in GeoJSON. `fromUtm` refuses a position more than 0.5° outside its band, so a mistyped northing fails instead of landing on the equator
- what3words is the only networked format: `WHAT3WORDS_API_KEY` goes in the `X-Api-Key` header, never the URL. A 400 `{ error: { code, message } }` becomes `InvalidInputError` with the API's reason, 401 stays `AuthError`. A default conversion adds three words only when the key is set, and a failed call lands in `skipped` unless the caller aborted. Inputs past 256 characters are refused before any parsing, detection included

## Key files

- `src/core/types.ts` - GeoLocation, GeoAddress, BoundingBox, options, capabilities, config, `clampMaxResults`, `compactAddress`
- `src/core/coordinates.ts` - WGS 84 validation, `parseCoordinates("lat,lon")`, `distanceBetween` and `bearingBetween` (haversine, IUGG mean radius, no network), `rhumbDistanceBetween` and `rhumbBearingBetween` on the same sphere
- `src/core/provider.ts` - abstract `Provider` base class (`geocode`, `reverse`); `requireOperation()` capability gate
- `src/core/errors.ts` - error hierarchy + `normalizeError` + URL sanitization
- `src/core/registry.ts` - self-registering provider registry (register, create, providers, has, getDefaultURL, listProviders)
- `src/core/resolve.ts` - env-based auto-selection, shared `selectProvider()`, `isAllProviders()`
- `src/core/all.ts` - parallel fan-out over every provider (`geocodeAll`, `geocodeAddressAll`, `reverseAll`, `serializeOutcomes`)
- `src/core/format.ts` - plain-text formatters shared by every output surface, `formatProviders` included
- `src/tools.ts` - one `defineTool` per tool, schemas built with `Type` from `@agntn/tools` (never bare `typebox`), executors behind a cached `import()` of `src/tool-operations.ts`, so the extensions register without loading the library
- `src/tool-operations.ts` - the executors: provider selection, fallback, `all`, the text and the details
- `src/core/convert.ts` - format detection, `convertCoordinates` and the per-format codecs it drives (`degrees.ts`, `grids.ts`, `utm.ts`, `what3words.ts`)
- `src/core/client.ts` - native `fetch` wrapper: `getJSON` parses the body whatever its content type, 15 s timeout joined with the caller's `signal`, no retry, identifying User-Agent. A 4xx or 5xx becomes a `ResponseError`, which `normalizeError()` classifies before it leaves the client. Also `buildQuery`
- `src/providers/*.ts` - one file per provider, self-registering via `register()`
- `src/mcp.ts` - `createMcpServer()` on `@agntn/tools/mcp` (MCP SDK v2 `Server`), with the restart guard when it runs from `src/`; `maps_distance` and `maps_convert` compute locally, no provider, what3words aside
- `src/server-info.ts` - name, version and description, shared by `maps --help` and both MCP builds
- `src/source-change.ts` - `sourceChangeCheck()`, the newest ctime under `src/` against the process start
- `src/ai.ts` - Vercel AI SDK tools from `toAiTool`, output `{ ...details, text }`
- `src/cli.ts` - `runCli` from `@agntn/tools/cli`: one command per tool plus `mcp`. A bare `mcp` from `dist/cli.mjs` inside a checkout serves `src/mcp.ts` instead; `src/cli-commands.ts` holds the CLI-only `reverse` and `distance`, which take a point as one `"latitude,longitude"` word. `MapsError` prints as one line with exit code 1; `EPIPE` ends quietly
- `packages/pi/extensions/maps.ts`, `packages/omp/extensions/maps.ts` - `registerPiTools` and `registerOmpTools` over `mapsTools`; type-import from `dist/tools.d.mts`. The OMP loader keeps both dynamic imports literal: `existsSync(src)` chooses `import("../../../src/tools.ts")` or `import("../../../dist/tools.mjs")`. An `import(url.href)` loses dependency resolution in the compiled binary. The OMP status line comes from `describeCall`; nothing imports `@oh-my-pi/pi-coding-agent/tui`, which compiled OMP doesn't serve

## CLI subcommands

`providers`, `geocode`, `address`, `reverse`, `distance`, `convert`, `mcp`. Flags come from the tool schemas in kebab case (`--provider`, `--language`, `--limit`, `--house-number`), with no short aliases; arrays and objects take JSON (`--layers '["poi"]'`, `--precision '{"geohash":5}'`, `--reference '{"latitude":52.2,"longitude":21}'`). `--json` prints the details. `geocode` and `convert` take their input as one positional word, so quote DMS. `reverse` and `distance` take positional `"latitude,longitude"` pairs; a pair starting with a minus needs a `--` separator first, and options go before it. `distance --path rhumb` follows one compass bearing instead of the great circle (`DISTANCE_PATHS` in `core/types.ts`, shared by the tool and the command through `distancePath`).

## Constraints

- Nominatim usage policy: absolute maximum 1 request/second, identifying User-Agent required, no bulk geocoding against the public instance - point `baseUrl` at a self-hosted Nominatim for heavy use; tests must never hit the live API
- Nominatim reverse reports "Unable to geocode" in-body with HTTP 200 → `NotFoundError`
- Google returns every failure in-body with HTTP 200; `assertOkStatus()` maps `REQUEST_DENIED` → `AuthError`, `OVER_QUERY_LIMIT`/`OVER_DAILY_LIMIT` → `RateLimitError`, `INVALID_REQUEST` → `InvalidInputError`, other non-OK → `MapsError`. `ZERO_RESULTS` is an empty list for `geocode` and `NotFoundError` for `reverse`
- Google has no server-side limit param; the provider slices to `clampMaxResults(limit, 20)` locally. Nominatim caps `limit` at 40 server-side
- The tool schemas accept `limit` up to 40, but providers clamp to their own maximum and truncate silently - there is no cursor in v0.1
- The Google key rides in the `key` query param; the shared sanitizer redacts it from every error message and body

## Testing

`pnpm test` (`vp test run`, mocked via `vi.stubGlobal("fetch", ...)`; `client.test.ts` also runs the client against a loopback `node:http` server, `cli.test.ts` spawns `src/cli.ts`, once with stdout already closed; `bin.test.ts` starts `dist/cli.mjs mcp` and skips its 14 tests without a built `dist/`). `test/setup.ts` deletes `GOOGLE_MAPS_API_KEY` and `WHAT3WORDS_API_KEY` so a configured host cannot flip auto-selection or leak live requests. The Pi and OMP extension tests register into strict host doubles that throw on any member they don't stub; the OMP one makes importing `/tui` throw, since compiled OMP doesn't serve it.

Subprocess gates in `test/eval-*.mjs`, each runnable on its own:

- `pnpm test:cli` - every subcommand spawned against the built binary: exit codes, error messages, help screens, live Nominatim calls spaced past the 1 req/s policy
- `pnpm test:mcp` - the built stdio server through a real `StdioClientTransport` with `DEBUG=1` and `MAPS_DIST=1`, so it stays on the bundle, plus a raw spawn asserting stdout carries only JSON-RPC frames
- `pnpm test:packed` - `pnpm pack`, a manifest with no `catalog:` left in it, tarball installed with `npm install --legacy-peer-deps` in a temp dir, then resolved by `npm install --dry-run` next to every peer host at its dev pin without that flag, a provider registered through the main entry read back through the `/mcp` entry (catches registry chunk splits, missing deps and broken `files`), and the packed CLI smoke

`MAPS_EVAL_OFFLINE=1` skips the live calls in the first two; `MAPS_EVAL_KEEP=1` keeps the packed temp install for inspection.

## Build & scripts

```bash
pnpm build       # obuild → dist/ (one bundle: index, cli, mcp, ai)
pnpm typecheck   # tsc → build → tsc -p tsconfig.extensions.json
pnpm test        # vp test run
pnpm fmt         # build → vp lint --fix → vp fmt
pnpm lint        # build → vp lint → vp fmt --check
```
