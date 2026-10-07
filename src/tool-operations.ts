/** Executors behind the maps tools: one text for every host, the data as details. */

import { stripVTControlCharacters } from "node:util";
import type { Static, ToolResult } from "@agntn/tools";
import {
  geocodeAddressAll,
  geocodeAddressWithFallback,
  geocodeAll,
  geocodeWithFallback,
  reverseAll,
  reverseWithFallback,
  serializeOutcomes,
  type SerializedOutcome,
} from "./core/all.ts";
import {
  convertCoordinates,
  type CoordinateConversion,
  type CoordinatePrecision,
} from "./core/convert.ts";
import { bearingBetween, distanceBetween } from "./core/coordinates.ts";
import {
  formatAddressLabel,
  formatConversion,
  formatDistance,
  formatDistanceBearing,
  formatGeocodeAll,
  formatLocation,
  formatLocations,
  formatProviders,
  formatReverseAll,
} from "./core/format.ts";
import { requireOperation } from "./core/provider.ts";
import { listProviders, type ProviderListing } from "./core/registry.ts";
import { isAllProviders, selectProvider } from "./core/resolve.ts";
import {
  trimLocation,
  trimLocations,
  type CoordinateFormat,
  type GeoLocation,
  type GeocodeLayer,
  type ReverseGranularity,
} from "./core/types.ts";
import type {
  convertSchema,
  distanceSchema,
  geocodeAddressSchema,
  geocodeSchema,
  reverseSchema,
} from "./tools.ts";
import "./providers/index.ts";

export type GeocodeDetails =
  | { provider: string; locations: GeoLocation[] }
  | { comparison: SerializedOutcome<GeoLocation[]>[] };

export type ReverseDetails =
  | { provider: string; location: GeoLocation }
  | { comparison: SerializedOutcome<GeoLocation>[] };

export interface DistanceDetails {
  meters: number;
  formatted: string;
  bearing: number;
}

export interface ProvidersDetails {
  providers: ProviderListing[];
}

/** Controls but tab and newline, plus the bidi marks that reorder a line. */
const UNPRINTABLE =
  /* oxlint-disable-next-line no-control-regex */
  /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u061C\u200E\u200F\u202A-\u202E\u2066-\u206F]/g;

/** ESC and C1 CSI, which open every sequence worth stripping. */
/* oxlint-disable-next-line no-control-regex */
const ESCAPE_OPENER = /[\u001B\u009B]/;

/** Longest line `stripVTControlCharacters` gets, quadratic as it is on an unclosed sequence. */
const MAX_ESCAPED_LINE = 2000;

function stripEscapes(line: string): string {
  if (!ESCAPE_OPENER.test(line)) return line;
  const chars = Array.from(line);
  const bounded =
    chars.length > MAX_ESCAPED_LINE ? `${chars.slice(0, MAX_ESCAPED_LINE).join("")}…` : line;
  return stripVTControlCharacters(bounded);
}

/** Provider text reaches terminals here: lines and indents stay, escapes and bidi tricks don't. */
function answer<Details>(text: string, details: Details): ToolResult<Details> {
  const clean = text
    .replaceAll(/\r\n?/g, "\n")
    .split("\n")
    .map(stripEscapes)
    .join("\n")
    .replaceAll(UNPRINTABLE, "")
    .replaceAll(/[\u2028\u2029]/g, " ");
  return { content: [{ type: "text", text: clean }], details };
}

/** The schema let only text with a non-space through, so a trim never leaves it empty. */
function trimmed(value: string | undefined): string | undefined {
  return value?.trim();
}

export async function providers(): Promise<ToolResult<ProvidersDetails>> {
  const listings = listProviders();
  return answer(formatProviders(listings), { providers: listings });
}

export async function geocode(
  params: Static<typeof geocodeSchema>,
  signal?: AbortSignal,
): Promise<ToolResult<GeocodeDetails>> {
  const query = params.query.trim();
  const view = { raw: params.raw === true };
  const options = {
    limit: params.limit,
    language: trimmed(params.language),
    countryCodes: params.countryCodes?.map((code) => code.trim()),
    layers: params.layers as GeocodeLayer[] | undefined,
  };
  if (isAllProviders(params.provider)) {
    const outcomes = await geocodeAll(query, options, signal);
    const comparison = serializeOutcomes(outcomes, (found) => trimLocations(found, view.raw));
    return answer(formatGeocodeAll(query, outcomes, view), { comparison });
  }
  let name: string;
  let locations: GeoLocation[];
  if (params.provider) {
    const selected = selectProvider(params.provider, signal);
    name = selected.name;
    locations = await requireOperation(selected.provider, "geocode")(query, options);
  } else {
    const fallback = await geocodeWithFallback(query, options, signal);
    name = fallback.provider;
    locations = fallback.result;
  }
  return answer(formatLocations(name, query, locations, view), {
    provider: name,
    locations: trimLocations(locations, view.raw),
  });
}

export async function geocodeAddress(
  params: Static<typeof geocodeAddressSchema>,
  signal?: AbortSignal,
): Promise<ToolResult<GeocodeDetails>> {
  const address = {
    houseNumber: trimmed(params.houseNumber),
    road: trimmed(params.road),
    city: trimmed(params.city),
    state: trimmed(params.state),
    postcode: trimmed(params.postcode),
    country: trimmed(params.country),
  };
  const view = { raw: params.raw === true };
  const options = { limit: params.limit, language: trimmed(params.language) };
  const label = formatAddressLabel(address);
  if (isAllProviders(params.provider)) {
    const outcomes = await geocodeAddressAll(address, options, signal);
    const comparison = serializeOutcomes(outcomes, (found) => trimLocations(found, view.raw));
    return answer(formatGeocodeAll(label, outcomes, view), { comparison });
  }
  let name: string;
  let locations: GeoLocation[];
  if (params.provider) {
    const selected = selectProvider(params.provider, signal);
    name = selected.name;
    locations = await requireOperation(selected.provider, "geocodeAddress")(address, options);
  } else {
    const fallback = await geocodeAddressWithFallback(address, options, signal);
    name = fallback.provider;
    locations = fallback.result;
  }
  return answer(formatLocations(name, label, locations, view), {
    provider: name,
    locations: trimLocations(locations, view.raw),
  });
}

export async function reverse(
  params: Static<typeof reverseSchema>,
  signal?: AbortSignal,
): Promise<ToolResult<ReverseDetails>> {
  const { latitude, longitude } = params;
  const view = { raw: params.raw === true };
  const options = {
    language: trimmed(params.language),
    granularity: params.granularity as ReverseGranularity | undefined,
  };
  if (isAllProviders(params.provider)) {
    const outcomes = await reverseAll(latitude, longitude, options, signal);
    const comparison = serializeOutcomes(outcomes, (found) => trimLocation(found, view.raw));
    return answer(formatReverseAll(outcomes, view), { comparison });
  }
  let name: string;
  let location: GeoLocation;
  if (params.provider) {
    const selected = selectProvider(params.provider, signal);
    name = selected.name;
    location = await requireOperation(selected.provider, "reverse")(latitude, longitude, options);
  } else {
    const fallback = await reverseWithFallback(latitude, longitude, options, signal);
    name = fallback.provider;
    location = fallback.result;
  }
  return answer(formatLocation(name, location, view), {
    provider: name,
    location: trimLocation(location, view.raw),
  });
}

export async function distance(
  params: Static<typeof distanceSchema>,
): Promise<ToolResult<DistanceDetails>> {
  const meters = distanceBetween(params.from, params.to);
  const bearing = bearingBetween(params.from, params.to);
  return answer(formatDistanceBearing(meters, bearing), {
    meters,
    formatted: formatDistance(meters),
    bearing: Math.round(bearing * 10) / 10,
  });
}

export async function convert(
  params: Static<typeof convertSchema>,
  signal?: AbortSignal,
): Promise<ToolResult<CoordinateConversion>> {
  const conversion = await convertCoordinates(params.input.trim(), {
    from: params.from as CoordinateFormat | undefined,
    to: params.to as CoordinateFormat[] | undefined,
    precision: params.precision as CoordinatePrecision | undefined,
    reference: params.reference,
    language: trimmed(params.language),
    signal,
  });
  return answer(formatConversion(conversion), conversion);
}
