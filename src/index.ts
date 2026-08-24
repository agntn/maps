/** Side-effect import: registers every built-in provider. */
import "./providers/index.ts";

export { version } from "./version.ts";
export type {
  BoundingBox,
  GeoAddress,
  GeoLocation,
  GeocodeOptions,
  ProviderCapabilities,
  ProviderConfig,
  ReverseGranularity,
  ReverseOptions,
} from "./core/types.ts";
export { REVERSE_GRANULARITIES, clampMaxResults } from "./core/types.ts";
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
export { Provider, assertAddress, assertQuery, requireOperation } from "./core/provider.ts";
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
  formatDistance,
  formatDistanceBearing,
  formatGeocodeAll,
  formatLocation,
  formatLocationLine,
  formatLocations,
  formatProviders,
  formatReverseAll,
} from "./core/format.ts";
