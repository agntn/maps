/** Plain-text formatters shared by the CLI, MCP server, AI tools, and agent extensions. */

import type { ProviderListing } from "./registry.ts";
import type { GeoLocation } from "./types.ts";

/** One-line label for a location in a list: coordinates plus its display name. */
export function formatLocationLine(location: GeoLocation): string {
  const name = location.displayName ?? "(unnamed)";
  return `${location.latitude}, ${location.longitude}  ${name}`;
}

/** Multi-line description of a single location. */
export function formatLocation(providerName: string, location: GeoLocation): string {
  const box = location.boundingBox;
  return [
    `[${providerName}] ${location.displayName ?? `${location.latitude}, ${location.longitude}`}`,
    `Coordinates: ${location.latitude}, ${location.longitude}`,
    location.category ? `Category: ${location.category}` : null,
    location.countryCode ? `Country: ${location.countryCode}` : null,
    box ? `Bounds: ${box.south}..${box.north} lat, ${box.west}..${box.east} lon` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Multi-line listing of geocoding matches for a query. */
export function formatLocations(
  providerName: string,
  query: string,
  locations: GeoLocation[],
): string {
  if (locations.length === 0) return `[${providerName}] No matches for "${query}"`;
  const lines = locations.map((location) => formatLocationLine(location));
  return `[${providerName}] ${locations.length} matches for "${query}":\n${lines.join("\n")}`;
}

/** Human-readable distance: meters below one kilometer, kilometers with exact meters above. */
export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(2)} km (${Math.round(meters)} m)`;
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
    return `  ${listing.name}: ${capabilities || "(no supported maps operations)"}`;
  });
  return `Registered providers (${listings.length}):\n${lines.join("\n")}`;
}
