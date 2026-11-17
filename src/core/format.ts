/** Plain-text formatters shared by the CLI, MCP server, AI tools, and agent extensions. */

import type { ProviderOutcome } from "./all.ts";
import type { CoordinateConversion } from "./convert.ts";
import type { ProviderListing } from "./registry.ts";
import type { BoundingBox, DistancePath, GeoAddress, GeoLocation } from "./types.ts";

/** What a location text shows besides the normalized fields. */
export interface LocationTextOptions {
  /** Print the provider's own record as one line of JSON. Off by default, it dwarfs the rest. */
  raw?: boolean;
}

const ADDRESS_FIELDS = ["houseNumber", "road", "city", "state", "postcode", "country"] as const;

/** One-line label for a location in a list: coordinates plus its display name. */
export function formatLocationLine(location: GeoLocation): string {
  const name = location.displayName ?? "(unnamed)";
  return `${location.latitude}, ${location.longitude}  ${name}`;
}

/** Address parts under their `GeoAddress` names, so `houseNumber 44, road Złota` maps back. */
function formatAddressFields(address: GeoAddress): string {
  return ADDRESS_FIELDS.flatMap((field) =>
    address[field] === undefined ? [] : [`${field} ${address[field]}`],
  ).join(", ");
}

function formatBounds(box: BoundingBox): string {
  return `${box.south}..${box.north} lat, ${box.west}..${box.east} lon`;
}

/** What a list line leaves out: category, country, address parts and bounds, `; ` apart. */
function formatLocationFacts(location: GeoLocation): string {
  return [
    location.category ? `category ${location.category}` : null,
    location.countryCode ? `country ${location.countryCode}` : null,
    location.address ? `address ${formatAddressFields(location.address)}` : null,
    location.boundingBox ? `bounds ${formatBounds(location.boundingBox)}` : null,
  ]
    .filter(Boolean)
    .join("; ");
}

/** Multi-line description of a single location. */
export function formatLocation(
  providerName: string,
  location: GeoLocation,
  options: LocationTextOptions = {},
): string {
  const box = location.boundingBox;
  return [
    `[${providerName}] ${location.displayName ?? `${location.latitude}, ${location.longitude}`}`,
    `Coordinates: ${location.latitude}, ${location.longitude}`,
    location.category ? `Category: ${location.category}` : null,
    location.countryCode ? `Country: ${location.countryCode}` : null,
    location.address ? `Address: ${formatAddressFields(location.address)}` : null,
    box ? `Bounds: ${formatBounds(box)}` : null,
    options.raw && location.raw ? `Raw: ${JSON.stringify(location.raw)}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Multi-line listing of geocoding matches for a query, the facts of each indented below it. */
export function formatLocations(
  providerName: string,
  query: string,
  locations: GeoLocation[],
  options: LocationTextOptions = {},
): string {
  if (locations.length === 0) return `[${providerName}] No matches for "${query}"`;
  const lines = locations.flatMap((location) => {
    const facts = formatLocationFacts(location);
    return [
      formatLocationLine(location),
      ...(facts ? [`  ${facts}`] : []),
      ...(options.raw && location.raw ? [`  raw ${JSON.stringify(location.raw)}`] : []),
    ];
  });
  return `[${providerName}] ${locations.length} matches for "${query}":\n${lines.join("\n")}`;
}

/** One-line label for a structured address, used where a query string would appear. */
export function formatAddressLabel(address: GeoAddress): string {
  return [
    address.houseNumber,
    address.road,
    address.city,
    address.state,
    address.postcode,
    address.country,
  ]
    .filter(Boolean)
    .join(", ");
}

/** Side-by-side geocoding results from every registered provider, failures included. */
export function formatGeocodeAll(
  query: string,
  outcomes: ProviderOutcome<GeoLocation[]>[],
  options: LocationTextOptions = {},
): string {
  return outcomes
    .map((outcome) =>
      outcome.error
        ? `[${outcome.provider}] error: ${outcome.error.message}`
        : formatLocations(outcome.provider, query, outcome.result, options),
    )
    .join("\n\n");
}

/** Side-by-side reverse-geocoding results from every registered provider, failures included. */
export function formatReverseAll(
  outcomes: ProviderOutcome<GeoLocation>[],
  options: LocationTextOptions = {},
): string {
  return outcomes
    .map((outcome) =>
      outcome.error
        ? `[${outcome.provider}] error: ${outcome.error.message}`
        : formatLocation(outcome.provider, outcome.result, options),
    )
    .join("\n\n");
}

/** Human-readable distance: meters below one kilometer, kilometers with exact meters above. */
export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(2)} km (${Math.round(meters)} m)`;
}

/** How a measurement is labeled in text. */
export interface DistanceTextOptions {
  /** Line the distance follows. A rhumb line says so on both rows. */
  path?: DistancePath;
}

/** Distance plus bearing, the shape the text surfaces print for one measurement. */
export function formatDistanceBearing(
  meters: number,
  bearing: number,
  options: DistanceTextOptions = {},
): string {
  const rounded = Math.round(bearing * 10) / 10;
  return options.path === "rhumb"
    ? `Rhumb distance: ${formatDistance(meters)}\nRhumb bearing: ${rounded}°`
    : `Distance: ${formatDistance(meters)}\nBearing: ${rounded}°`;
}

/** Multi-line listing of registered providers and what each can serve. */
export function formatProviders(listings: ProviderListing[]): string {
  const lines = listings.map((listing) => {
    if (listing.requiresConfiguration) {
      return `  ${listing.name}: (requires API key - set env var to activate)`;
    }
    const capabilities = Object.entries(listing.capabilities ?? {})
      .filter(([, enabled]) => enabled)
      .map(([operation]) => operation)
      .join(", ");
    const url = listing.defaultUrl ? ` (${listing.defaultUrl})` : "";
    return `  ${listing.name}: ${capabilities || "(no supported maps operations)"}${url}`;
  });
  return `Registered providers (${listings.length}):\n${lines.join("\n")}`;
}

/** A conversion as text: what the input was read as, its cell, then one line per format. */
export function formatConversion(conversion: CoordinateConversion): string {
  const { center, bounds } = conversion;
  const names = [...Object.keys(conversion.formats), ...Object.keys(conversion.skipped ?? {})];
  const width = Math.max(...names.map((format) => format.length), 0);
  return [
    `${conversion.format} ${conversion.canonical} -> ${center.latitude}, ${center.longitude}`,
    bounds
      ? `Cell: ${bounds.south}..${bounds.north} lat, ${bounds.west}..${bounds.east} lon`
      : null,
    ...Object.entries(conversion.formats).map(
      ([format, text]) => `  ${format.padEnd(width)}  ${text}`,
    ),
    ...Object.entries(conversion.skipped ?? {}).map(
      ([format, reason]) => `  ${format.padEnd(width)}  (skipped: ${reason})`,
    ),
  ]
    .filter(Boolean)
    .join("\n");
}
