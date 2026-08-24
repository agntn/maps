# maps - AGENTS.md

## Scope

Unified geocoding provider library. Normalizes forward geocoding (address or place to WGS 84 coordinates) and reverse geocoding (coordinates to place) across providers, with coordinate validation in core. Exports a CLI (`maps` binary), a programmatic API, an MCP server (`@agntn/maps/mcp`), Vercel AI SDK tools (`@agntn/maps/ai`), and Pi/OMP extensions.

## Providers

| Provider      | Auth                             | Capabilities     | Notes                                            |
| ------------- | -------------------------------- | ---------------- | ------------------------------------------------ |
| openstreetmap | none                             | geocode, reverse | Public Nominatim; usage policy: max 1 req/s      |
| googlemaps    | `GOOGLE_MAPS_API_KEY` (required) | geocode, reverse | Geocoding API; errors ride in-body with HTTP 200 |

## API audit (2026-08-24)

Live verification performed before scaffolding, per the agntn scaffold procedure:

- **Nominatim** (`nominatim.openstreetmap.org`): `/search?q=...&format=jsonv2` and `/reverse?lat=..&lon=..&format=jsonv2` verified 200 without a key. Requires an identifying `User-Agent` (the shared client sends `agntn-maps/<version> (...)`). Reverse failures come back as `{ "error": "Unable to geocode" }` with HTTP 200. `boundingbox` is `[south, north, west, east]` as strings; `search` caps `limit` at 40.
- **Google Geocoding** (`maps.googleapis.com/maps/api/geocode/json`): alive; without a key answers HTTP 200 with `{ status: "REQUEST_DENIED", error_message: ... }` - key-gated, mapped defensively from documented shapes. Every failure (`REQUEST_DENIED`, `OVER_QUERY_LIMIT`, `INVALID_REQUEST`, `ZERO_RESULTS`) travels in the JSON body with HTTP 200; the provider maps `status` onto the error hierarchy in `assertOkStatus()`. There is no server-side result limit - the provider slices locally.

## Conventions

- Coordinates are WGS 84 decimal degrees; validation lives in `core/coordinates.ts` (`isValidLatitude`, `isValidLongitude`, `isValidCoordinates`, `assertCoordinates`, `parseCoordinates`) and every provider `reverse()` calls `assertCoordinates` before building a URL
- `GeoLocation.countryCode` is lowercase ISO 3166-1 alpha-2 on both providers (Google `short_name` is lowercased to match Nominatim)
- `BoundingBox` is `{ south, north, west, east }`; Nominatim's string quadruple and Google's `viewport` both map onto it
- Provider registration is a class side effect: each concrete class owns a static `key`, and importing `src/providers/index.ts` triggers all `register()` calls - because of that, `package.json` must NOT declare `sideEffects: false`
- One obuild bundle with four inputs (`index`, `cli`, `mcp`, `ai`) so every entry shares the chunk holding the registry
- Error hierarchy: `MapsError` → `HTTPError`, `AuthError`, `PaymentError` (402), `RateLimitError`, `NotFoundError`, `UnsupportedOperationError`, `UnknownProviderError`, `InvalidInputError`; `normalizeError()` wraps everything at the client boundary
- `MapsError` sanitizes messages: secret query params (`key`, `api[-_]key`, `secret`, `token`) are redacted - this covers the Google Maps `key` param
- Internal imports use explicit `.ts` extensions (nodenext + `allowImportingTsExtensions`); `erasableSyntaxOnly` forbids parameter properties
- Provider auto-selection: `resolveProvider()` checks the env keys listed in `ENV_MAP` (built-in providers only; an externally registered provider must be selected explicitly), falls back to `openstreetmap`
- `selectProvider()` in `core/resolve.ts` is the single provider selection path for the CLI, MCP, AI tools, and both extensions; empty or whitespace-only arguments count as absent
- Capability gating goes through `requireOperation()` in `core/provider.ts`; text rendering through the `format*` helpers in `core/format.ts` - do not re-implement either per surface

## Key files

- `src/core/types.ts` - GeoLocation, BoundingBox, options, capabilities, config, `clampMaxResults`
- `src/core/coordinates.ts` - WGS 84 validation and `parseCoordinates("lat,lon")`
- `src/core/provider.ts` - abstract `Provider` base class (`geocode`, `reverse`); `requireOperation()` capability gate
- `src/core/errors.ts` - error hierarchy + `normalizeError` + URL sanitization
- `src/core/registry.ts` - self-registering provider registry (register, create, providers, has, getDefaultURL, listProviders)
- `src/core/resolve.ts` - env-based auto-selection, shared `selectProvider()`
- `src/core/format.ts` - plain-text formatters shared by every output surface, `formatProviders` included
- `src/core/schemas.ts` - zod input fragments shared by the MCP server and the AI tools
- `src/core/client.ts` - ofetch wrapper (15 s timeout, no retry, identifying User-Agent), `buildQuery`
- `src/providers/*.ts` - one file per provider, self-registering via `register()`
- `src/mcp.ts` - `createMcpServer()`, three read-only tools with a capability gate
- `src/ai.ts` - Vercel AI SDK tool surface
- `src/cli.ts` + `src/commands/*.ts` - citty CLI (lazy subcommands; provider selection via `selectProvider()` from core)
- `packages/pi/extensions/maps.ts`, `packages/omp/extensions/maps.ts` - agent extensions; type-import from `dist/index.d.mts`. The OMP loader keeps both dynamic imports literal: `existsSync(src)` chooses `import("../../../src/index.ts")` or `import("../../../dist/index.mjs")`. An `import(url.href)` loses `ofetch` resolution in the compiled binary

## CLI subcommands

`geocode`, `reverse`, `providers`, `mcp` - data commands support `-p` (provider) and `-l` (language); `geocode` adds `-n` (limit) and `--country` (comma-separated ISO codes). `reverse` takes one positional `"latitude,longitude"`; a pair starting with a minus needs a `--` separator first, because the argument parser would read it as a flag.

## Constraints

- Nominatim usage policy: absolute maximum 1 request/second, identifying User-Agent required, no bulk geocoding against the public instance - point `baseUrl` at a self-hosted Nominatim for heavy use; tests must never hit the live API
- Nominatim reverse reports "Unable to geocode" in-body with HTTP 200 → `NotFoundError`
- Google returns every failure in-body with HTTP 200; `assertOkStatus()` maps `REQUEST_DENIED` → `AuthError`, `OVER_QUERY_LIMIT`/`OVER_DAILY_LIMIT` → `RateLimitError`, `INVALID_REQUEST` → `InvalidInputError`, other non-OK → `MapsError`. `ZERO_RESULTS` is an empty list for `geocode` and `NotFoundError` for `reverse`
- Google has no server-side limit param; the provider slices to `clampMaxResults(limit, 20)` locally. Nominatim caps `limit` at 40 server-side
- MCP/AI schemas accept `limit` up to 40, but providers clamp to their own maximum and truncate silently - there is no cursor in v0.1
- The Google key rides in the `key` query param; the shared sanitizer redacts it from every error message and body

## Testing

`pnpm test` (vitest, 8 files / 83 tests, all mocked via `vi.stubGlobal("fetch", ...)`). `test/setup.ts` deletes `GOOGLE_MAPS_API_KEY` so a configured host cannot flip auto-selection or leak live requests. The OMP extension test mocks `@oh-my-pi/pi-coding-agent` and `/tui` - the host serves those modules at runtime.

Packed-layout gate (manual): `pnpm pack`, install the tarball with `npm install --legacy-peer-deps` in an empty dir, register a custom provider through the main entry and confirm `maps_providers` from `@agntn/maps/mcp` lists it - this catches registry chunk splits, missing deps and broken `files`.

## Build & scripts

```bash
pnpm build       # obuild → dist/ (one bundle: index, cli, mcp, ai)
pnpm typecheck   # tsc → build → tsc -p tsconfig.extensions.json
pnpm test        # vitest --run
pnpm fmt         # oxlint --fix + oxfmt
pnpm lint        # oxlint + oxfmt --check
```
