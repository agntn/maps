/** Side-effect import: registers every built-in provider. */
import "./providers/index.ts";

export { version } from "./version.ts";
export type {
  BoundingBox,
  GeoAddress,
  GeoLocation,
  GeocodeLayer,
  GeocodeOptions,
  ProviderCapabilities,
  ProviderConfig,
  ReverseGranularity,
  ReverseOptions,
} from "./core/types.ts";
export {
  COORDINATE_FORMATS,
  GEOCODE_LAYERS,
  REVERSE_GRANULARITIES,
  clampMaxResults,
} from "./core/types.ts";
export type { CoordinateFormat } from "./core/types.ts";
export {
  assertCoordinateFormat,
  convertCoordinates,
  decodeCoordinates,
  detectCoordinateFormats,
  encodeCoordinates,
} from "./core/convert.ts";
export type {
  ConvertOptions,
  CoordinateConversion,
  CoordinatePrecision,
  DecodedCoordinates,
  LocalCoordinateFormat,
} from "./core/convert.ts";
export { formatDdm, formatDecimal, formatDms, parseDegrees } from "./core/degrees.ts";
export type { DegreeNotation, ParsedDegrees } from "./core/degrees.ts";
export {
  decodeGeohash,
  decodeMaidenhead,
  decodePlusCode,
  encodeGeohash,
  encodeMaidenhead,
  encodePlusCode,
} from "./core/grids.ts";
export type { GridCell } from "./core/grids.ts";
export { decodeMgrs, encodeMgrs, formatUtm, fromUtm, parseUtm, toUtm } from "./core/utm.ts";
export type { UtmPosition } from "./core/utm.ts";
export { WHAT3WORDS_ENV, squareToWhat3words, what3wordsToSquare } from "./core/what3words.ts";
export type { What3wordsOptions, What3wordsSquare } from "./core/what3words.ts";
export {
  assertCoordinates,
  bearingBetween,
  distanceBetween,
  isValidCoordinates,
  isValidLatitude,
  isValidLongitude,
  parseCoordinates,
} from "./core/coordinates.ts";
export type { GeoPoint } from "./core/coordinates.ts";
export {
  Provider,
  assertAddress,
  assertLayers,
  assertQuery,
  requireOperation,
} from "./core/provider.ts";
export type { ProviderConstructor, ProviderOperation } from "./core/provider.ts";
export {
  MapsError,
  HTTPError,
  AuthError,
  PaymentError,
  RateLimitError,
  NotFoundError,
  UnsupportedOperationError,
  UnknownProviderError,
  InvalidInputError,
  normalizeError,
} from "./core/errors.ts";
export { getJSON, buildQuery } from "./core/client.ts";
export { register, create, providers, has, getDefaultURL, listProviders } from "./core/registry.ts";
export type { ProviderListing } from "./core/registry.ts";
export { isAllProviders, resolveProvider, selectProvider } from "./core/resolve.ts";
export type { SelectedProvider } from "./core/resolve.ts";
export {
  geocodeAddressAll,
  geocodeAddressWithFallback,
  geocodeAll,
  geocodeWithFallback,
  reverseAll,
  reverseWithFallback,
  serializeOutcomes,
} from "./core/all.ts";
export type { ProviderOutcome, SerializedOutcome } from "./core/all.ts";
export {
  formatAddressLabel,
  formatConversion,
  formatDistance,
  formatDistanceBearing,
  formatGeocodeAll,
  formatLocation,
  formatLocationLine,
  formatLocations,
  formatProviders,
  formatReverseAll,
} from "./core/format.ts";
