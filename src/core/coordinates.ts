/** WGS 84 coordinate validation and geometry shared by every surface. */

import { InvalidInputError } from "./errors.ts";

/** Minimal coordinate pair; every `GeoLocation` satisfies it. */
export interface GeoPoint {
  /** Latitude in decimal degrees, -90 through 90 */
  latitude: number;
  /** Longitude in decimal degrees, -180 through 180 */
  longitude: number;
}

/** IUGG mean Earth radius. */
const EARTH_RADIUS_METERS = 6_371_008.8;

/** True when `value` is a finite latitude between -90 and 90 inclusive. */
export function isValidLatitude(value: number): boolean {
  return Number.isFinite(value) && value >= -90 && value <= 90;
}

/** True when `value` is a finite longitude between -180 and 180 inclusive. */
export function isValidLongitude(value: number): boolean {
  return Number.isFinite(value) && value >= -180 && value <= 180;
}

/** True when the pair is a valid WGS 84 coordinate. */
export function isValidCoordinates(latitude: number, longitude: number): boolean {
  return isValidLatitude(latitude) && isValidLongitude(longitude);
}

/**
 * Reject an out-of-range coordinate pair before any request is sent.
 *
 * @throws {InvalidInputError} When either component is out of range or not finite.
 */
export function assertCoordinates(latitude: number, longitude: number, provider?: string): void {
  if (!isValidLatitude(latitude)) {
    throw new InvalidInputError(
      `latitude must be a finite number between -90 and 90, got ${latitude}`,
      provider,
    );
  }
  if (!isValidLongitude(longitude)) {
    throw new InvalidInputError(
      `longitude must be a finite number between -180 and 180, got ${longitude}`,
      provider,
    );
  }
}

/**
 * Great-circle distance in meters between two WGS 84 points.
 *
 * Haversine on the IUGG mean sphere: within about 0.5% of the ellipsoidal distance, which is
 * plenty for "how far apart are these places" questions. Runs locally - no provider involved.
 *
 * @example
 *   ```ts
 *   distanceBetween({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 1 }); // ~111195
 *   ```
 *
 * @throws {InvalidInputError} When either point is out of range or not finite.
 */
export function distanceBetween(from: GeoPoint, to: GeoPoint): number {
  assertCoordinates(from.latitude, from.longitude);
  assertCoordinates(to.latitude, to.longitude);
  const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;
  const deltaLatitude = toRadians(to.latitude - from.latitude);
  const deltaLongitude = toRadians(to.longitude - from.longitude);
  const a =
    Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(toRadians(from.latitude)) *
      Math.cos(toRadians(to.latitude)) *
      Math.sin(deltaLongitude / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(a));
}

/**
 * Parse a "latitude,longitude" string into a validated coordinate pair.
 *
 * @example
 *   ```ts
 *   parseCoordinates("52.2318,21.0067"); // { latitude: 52.2318, longitude: 21.0067 }
 *   ```
 *
 * @throws {InvalidInputError} When the input is not two comma-separated decimal degrees in range.
 */
export function parseCoordinates(input: string): GeoPoint {
  const parts = input.split(",").map((part) => part.trim());
  if (parts.length !== 2 || parts.some((part) => part === "")) {
    throw new InvalidInputError(`Expected "latitude,longitude", got "${input}"`);
  }
  const latitude = Number(parts[0]);
  const longitude = Number(parts[1]);
  assertCoordinates(latitude, longitude);
  return { latitude, longitude };
}
