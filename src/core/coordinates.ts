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

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

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
 * Clamps roundoff above 1 near antipodes to keep the inverse sine in range.
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
  const deltaLatitude = toRadians(to.latitude - from.latitude);
  const deltaLongitude = toRadians(to.longitude - from.longitude);
  const a =
    Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(toRadians(from.latitude)) *
      Math.cos(toRadians(to.latitude)) *
      Math.sin(deltaLongitude / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(Math.min(1, a)));
}

/**
 * Initial great-circle bearing from one WGS 84 point toward another, in degrees.
 *
 * Measured clockwise from true north, 0 through 360. Like `distanceBetween`, this runs locally.
 *
 * @throws {InvalidInputError} When either point is out of range or not finite.
 */
export function bearingBetween(from: GeoPoint, to: GeoPoint): number {
  assertCoordinates(from.latitude, from.longitude);
  assertCoordinates(to.latitude, to.longitude);
  const deltaLongitude = toRadians(to.longitude - from.longitude);
  const y = Math.sin(deltaLongitude) * Math.cos(toRadians(to.latitude));
  const x =
    Math.cos(toRadians(from.latitude)) * Math.sin(toRadians(to.latitude)) -
    Math.sin(toRadians(from.latitude)) *
      Math.cos(toRadians(to.latitude)) *
      Math.cos(deltaLongitude);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

interface RhumbSteps {
  latitude: number;
  longitude: number;
  stretched: number;
}

/** Cosine of a latitude in degrees, from its distance to the pole: exactly zero at 90. */
function cosLatitude(degrees: number): number {
  return Math.sin(toRadians(90 - Math.abs(degrees)));
}

/** Mercator latitude step between two latitudes in degrees. Infinite at a pole, as on the chart. */
function mercatorStep(from: number, to: number): number {
  if (from === to) return 0;
  const sines = 2 * Math.cos(toRadians((from + to) / 2)) * Math.sin(toRadians(to - from) / 2);
  return Math.asinh(sines / (cosLatitude(from) * cosLatitude(to)));
}

/** Rhumb steps in radians, longitude the shorter way round. */
function rhumbSteps(from: GeoPoint, to: GeoPoint): RhumbSteps {
  assertCoordinates(from.latitude, from.longitude);
  assertCoordinates(to.latitude, to.longitude);
  const longitude = toRadians(to.longitude - from.longitude);
  return {
    latitude: toRadians(to.latitude - from.latitude),
    longitude:
      Math.abs(longitude) > Math.PI ? longitude - Math.sign(longitude) * 2 * Math.PI : longitude,
    stretched: mercatorStep(from.latitude, to.latitude),
  };
}

/**
 * Rhumb line distance in meters between two WGS 84 points.
 *
 * One compass bearing held all the way, on the same mean sphere as `distanceBetween`. Never
 * shorter than the great circle. Crosses the antimeridian when that's the shorter way round.
 *
 * @example
 *   ```ts
 *   rhumbDistanceBetween({ latitude: 35, longitude: 45 }, { latitude: 35, longitude: 135 });
 *   // ~8197711, against ~7871780 along the great circle
 *   ```
 *
 * @throws {InvalidInputError} When either point is out of range or not finite.
 */
export function rhumbDistanceBetween(from: GeoPoint, to: GeoPoint): number {
  const { latitude, longitude, stretched } = rhumbSteps(from, to);
  const ratio = stretched === 0 ? cosLatitude(from.latitude) : latitude / stretched;
  return EARTH_RADIUS_METERS * Math.hypot(latitude, ratio * longitude);
}

/**
 * Constant rhumb line bearing from one WGS 84 point toward another, in degrees.
 *
 * Measured clockwise from true north, 0 through 360. Hold it all the way and you arrive.
 *
 * @throws {InvalidInputError} When either point is out of range or not finite.
 */
export function rhumbBearingBetween(from: GeoPoint, to: GeoPoint): number {
  const { longitude, stretched } = rhumbSteps(from, to);
  return ((Math.atan2(longitude, stretched) * 180) / Math.PI + 360) % 360;
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
