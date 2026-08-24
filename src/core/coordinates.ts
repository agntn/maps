/** WGS 84 coordinate validation shared by every surface. */

import { InvalidInputError } from "./errors.ts";

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
 * Parse a "latitude,longitude" string into a validated coordinate pair.
 *
 * @example
 *   ```ts
 *   parseCoordinates("52.2318,21.0067"); // { latitude: 52.2318, longitude: 21.0067 }
 *   ```
 *
 * @throws {InvalidInputError} When the input is not two comma-separated decimal degrees in range.
 */
export function parseCoordinates(input: string): { latitude: number; longitude: number } {
  const parts = input.split(",").map((part) => part.trim());
  if (parts.length !== 2 || parts.some((part) => part === "")) {
    throw new InvalidInputError(`Expected "latitude,longitude", got "${input}"`);
  }
  const latitude = Number(parts[0]);
  const longitude = Number(parts[1]);
  assertCoordinates(latitude, longitude);
  return { latitude, longitude };
}
