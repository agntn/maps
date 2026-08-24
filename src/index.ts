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
  ReverseOptions,
} from "./core/types.ts";
export { clampMaxResults } from "./core/types.ts";
export {
  assertCoordinates,
  isValidCoordinates,
  isValidLatitude,
  isValidLongitude,
  parseCoordinates,
} from "./core/coordinates.ts";
export { Provider, assertQuery, requireOperation } from "./core/provider.ts";
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
export { resolveProvider, selectProvider } from "./core/resolve.ts";
export type { SelectedProvider } from "./core/resolve.ts";
export {
  formatLocation,
  formatLocationLine,
  formatLocations,
  formatProviders,
} from "./core/format.ts";
