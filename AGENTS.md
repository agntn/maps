# maps - AGENTS.md

## Scope

Unified geocoding provider library. Normalizes forward geocoding (free-form and structured-address input), reverse geocoding, and structured address output across providers, with coordinate validation and local great-circle distance plus bearing (haversine) in core. Exports a CLI (`maps` binary), a programmatic API, an MCP server (`@agntn/maps/mcp`), Vercel AI SDK tools (`@agntn/maps/ai`), and Pi/OMP extensions.

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
- One obuild bundle with four inputs (`index`, `cli`, `mcp`, `ai`) so every entry shares the chunk holding the registry
- Error hierarchy: `MapsError` → `HTTPError`, `AuthError`, `PaymentError` (402), `RateLimitError`, `NotFoundError`, `UnsupportedOperationError`, `UnknownProviderError`, `InvalidInputError`; `normalizeError()` wraps everything at the client boundary
- `MapsError` sanitizes messages: secret query params (`key`, `api[-_]key`, `secret`, `token`) are redacted - this covers the Google Maps `key` param
- Internal imports use explicit `.ts` extensions (nodenext + `allowImportingTsExtensions`); `erasableSyntaxOnly` forbids parameter properties
- Provider auto-selection: `resolveProvider()` checks the env keys listed in `ENV_MAP` (built-in providers only; an externally registered provider must be selected explicitly), falls back to `openstreetmap`
- `selectProvider()` in `core/resolve.ts` is the single provider selection path for the CLI, MCP, AI tools, and both extensions; empty or whitespace-only arguments count as absent
- The provider value `all` is reserved: surfaces test it with `isAllProviders()` before `selectProvider()` and route to the parallel fan-out in `core/all.ts` (`geocodeAll`/`geocodeAddressAll`/`reverseAll`); failures stay in the outcome list (`ProviderOutcome`), JSON surfaces reduce them via `serializeOutcomes()`, text surfaces render via `formatGeocodeAll`/`formatReverseAll`
- Auto-selected requests (no provider given) go through the `*WithFallback` trio in `core/all.ts`: auth, billing, rate-limit, and unsupported-operation failures skip to the next provider, anything else propagates, and when everything is skipped the first skip reason is thrown; an explicit provider is never substituted
- Reverse `granularity` (country/state/city/street/building) maps onto Nominatim `zoom` (3/5/10/16/18) and the Google `result_type` filter (country/administrative_area_level_1/locality/route/street_address)
- Forward `layers` (address/poi/natural, `GEOCODE_LAYERS`) maps 1:1 onto the Nominatim `layer` filter; the Google Geocoding API has no request-side layer filter, so `googlemaps` partitions each result by its `types` locally (`natural_feature` → natural, `POI_TYPES` → poi, anything else → address) before the limit is applied. Nominatim's `railway` and `manmade` layers stay out of the API because Google has no counterpart. An empty list means no filter, like `countryCodes`
- `GeoLocation.raw` stays on the library type, but the MCP and AI tools send it only when the call passes `raw: true` (`rawInput` in `core/schemas.ts`, `trimLocation`/`trimLocations` in `core/types.ts`, and the `view` argument of `serializeOutcomes` for the `all` path): the record repeats the normalized fields and was two thirds of a default `maps_geocode` answer (52 kB for 36 Nominatim results). The CLI, Pi and OMP text formatters never print it
- Capability gating goes through `requireOperation()` in `core/provider.ts`; text rendering through the `format*` helpers in `core/format.ts` - do not re-implement either per surface
- Structured geocoding takes the same `GeoAddress` shape the results use; `assertAddress()` rejects an all-empty input, Nominatim gets `street`/`city`/`state`/`postalcode`/`country` params, Google gets house number and street in the free-form `address` param plus the rest as a `components` filter (its filter has no street_number type)

## Key files

- `src/core/types.ts` - GeoLocation, GeoAddress, BoundingBox, options, capabilities, config, `clampMaxResults`, `compactAddress`
- `src/core/coordinates.ts` - WGS 84 validation, `parseCoordinates("lat,lon")`, `distanceBetween` and `bearingBetween` (haversine, IUGG mean radius, no network)
- `src/core/provider.ts` - abstract `Provider` base class (`geocode`, `reverse`); `requireOperation()` capability gate
- `src/core/errors.ts` - error hierarchy + `normalizeError` + URL sanitization
- `src/core/registry.ts` - self-registering provider registry (register, create, providers, has, getDefaultURL, listProviders)
- `src/core/resolve.ts` - env-based auto-selection, shared `selectProvider()`, `isAllProviders()`
- `src/core/all.ts` - parallel fan-out over every provider (`geocodeAll`, `geocodeAddressAll`, `reverseAll`, `serializeOutcomes`)
- `src/core/format.ts` - plain-text formatters shared by every output surface, `formatProviders` included
- `src/core/schemas.ts` - zod input fragments shared by the MCP server and the AI tools
- `src/core/client.ts` - native `fetch` wrapper: `getJSON` parses the body whatever its content type, 15 s timeout joined with the caller's `signal`, no retry, identifying User-Agent. A 4xx or 5xx becomes a `ResponseError`, which `normalizeError()` classifies before it leaves the client. Also `buildQuery`
- `src/providers/*.ts` - one file per provider, self-registering via `register()`
- `src/mcp.ts` - `createMcpServer()`, five read-only tools (`maps_distance` computes locally, no provider)
- `src/ai.ts` - Vercel AI SDK tool surface
- `src/cli.ts` + `src/commands/*.ts` - citty CLI (lazy subcommands; provider selection via `selectProvider()` from core)
- `packages/pi/extensions/maps.ts`, `packages/omp/extensions/maps.ts` - agent extensions; type-import from `dist/index.d.mts`. The OMP loader keeps both dynamic imports literal: `existsSync(src)` chooses `import("../../../src/index.ts")` or `import("../../../dist/index.mjs")`. An `import(url.href)` loses dependency resolution in the compiled binary

## CLI subcommands

`geocode`, `address`, `reverse`, `distance`, `providers`, `mcp` - provider commands support `-p` (provider, `all` included) and `-l` (language); `geocode` adds `-n` (limit), `--country` (comma-separated ISO codes) and `--layer` (comma-separated `GEOCODE_LAYERS`); `address` takes the fields as flags (`--house`, `--road`, `--city`, `--state`, `--postcode`, `--country`); `distance` is local-only and prints bearing too. `reverse` and `distance` take positional `"latitude,longitude"` pairs; a pair starting with a minus needs a `--` separator first, because the argument parser would read it as a flag.

## Constraints

- Nominatim usage policy: absolute maximum 1 request/second, identifying User-Agent required, no bulk geocoding against the public instance - point `baseUrl` at a self-hosted Nominatim for heavy use; tests must never hit the live API
- Nominatim reverse reports "Unable to geocode" in-body with HTTP 200 → `NotFoundError`
- Google returns every failure in-body with HTTP 200; `assertOkStatus()` maps `REQUEST_DENIED` → `AuthError`, `OVER_QUERY_LIMIT`/`OVER_DAILY_LIMIT` → `RateLimitError`, `INVALID_REQUEST` → `InvalidInputError`, other non-OK → `MapsError`. `ZERO_RESULTS` is an empty list for `geocode` and `NotFoundError` for `reverse`
- Google has no server-side limit param; the provider slices to `clampMaxResults(limit, 20)` locally. Nominatim caps `limit` at 40 server-side
- MCP/AI schemas accept `limit` up to 40, but providers clamp to their own maximum and truncate silently - there is no cursor in v0.1
- The Google key rides in the `key` query param; the shared sanitizer redacts it from every error message and body

## Testing

`pnpm test` (vitest, 11 files / 166 tests, mocked via `vi.stubGlobal("fetch", ...)`; `client.test.ts` also runs the client against a loopback `node:http` server). `test/setup.ts` deletes `GOOGLE_MAPS_API_KEY` so a configured host cannot flip auto-selection or leak live requests. The OMP extension test mocks `@oh-my-pi/pi-coding-agent` and `/tui` - the host serves those modules at runtime.

Subprocess gates in `test/eval-*.mjs`, each runnable on its own:

- `pnpm test:cli` - every subcommand spawned against the built binary: exit codes, error messages, help screens, live Nominatim calls spaced past the 1 req/s policy
- `pnpm test:mcp` - the built stdio server through a real `StdioClientTransport` with `DEBUG=1`, plus a raw spawn asserting stdout carries only JSON-RPC frames
- `pnpm test:packed` - `pnpm pack`, tarball installed with `npm install --legacy-peer-deps` in a temp dir, a provider registered through the main entry read back through the `/mcp` entry (catches registry chunk splits, missing deps and broken `files`), and the packed CLI smoke

`MAPS_EVAL_OFFLINE=1` skips the live calls in the first two; `MAPS_EVAL_KEEP=1` keeps the packed temp install for inspection.

## Build & scripts

```bash
pnpm build       # obuild → dist/ (one bundle: index, cli, mcp, ai)
pnpm typecheck   # tsc → build → tsc -p tsconfig.extensions.json
pnpm test        # vitest --run
pnpm fmt         # oxlint --fix + oxfmt
pnpm lint        # oxlint + oxfmt --check
```
