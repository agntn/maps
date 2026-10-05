/**
 * what3words, the one format here that needs a network call and a key.
 *
 * Auth: `WHAT3WORDS_API_KEY`, sent in the `X-Api-Key` header so it never lands in a URL.
 * API: https://api.what3words.com/v3 (`convert-to-coordinates`, `convert-to-3wa`)
 */

import { getJSON } from "./client.ts";
import { assertCoordinates, type GeoPoint } from "./coordinates.ts";
import { AuthError, HTTPError, InvalidInputError, MapsError } from "./errors.ts";
import type { BoundingBox } from "./types.ts";

const BASE_URL = "https://api.what3words.com/v3";
const PROVIDER = "what3words";

/** Env var holding the what3words key. */
export const WHAT3WORDS_ENV = "WHAT3WORDS_API_KEY";

/** Request options for the what3words calls. */
export interface What3wordsOptions {
  /** API key; defaults to `WHAT3WORDS_API_KEY` */
  apiKey?: string;
  /** Language of the returned words, for example `pl`; the API default is English */
  language?: string;
  signal?: AbortSignal;
  /** Override for tests and proxies */
  baseUrl?: string;
}

/** A 3 m what3words square. */
export interface What3wordsSquare {
  words: string;
  center: GeoPoint;
  bounds: BoundingBox;
  /** Nearest town the API reports, handy for spotting a typo that lands abroad */
  nearestPlace?: string;
  country?: string;
}

interface W3wLatLng {
  lat?: number;
  lng?: number;
}

interface W3wResponse {
  words?: string;
  coordinates?: W3wLatLng;
  square?: { southwest?: W3wLatLng; northeast?: W3wLatLng };
  nearestPlace?: string;
  country?: string;
}

const SEPARATORS = "[.｡。･・︒។։။۔።।]";
const WORD = "[\\p{L}\\p{M}]+";
const WORDS_PATTERN = new RegExp(`^(?:///)?${WORD}${SEPARATORS}${WORD}${SEPARATORS}${WORD}$`, "u");

/** True when the text has the shape of a three word address (`///` prefix optional). */
export function isWhat3words(text: string): boolean {
  return WORDS_PATTERN.test(text.trim());
}

/** True when a key is passed or set in the environment. */
export function hasWhat3wordsKey(options?: What3wordsOptions): boolean {
  return Boolean(options?.apiKey?.trim() || process.env[WHAT3WORDS_ENV]?.trim());
}

function requireKey(options?: What3wordsOptions): string {
  const key = options?.apiKey?.trim() || process.env[WHAT3WORDS_ENV]?.trim();
  if (!key) {
    throw new AuthError(PROVIDER, `set ${WHAT3WORDS_ENV} to convert three word addresses`);
  }
  return key;
}

/** what3words answers a bad request with `{ error: { code, message } }`; keep its words. */
function explain(error: unknown): never {
  if (error instanceof HTTPError && error.statusCode === 400 && error.body) {
    try {
      const parsed = JSON.parse(error.body) as { error?: { code?: string; message?: string } };
      if (parsed.error?.message) {
        throw new InvalidInputError(
          `what3words ${String(parsed.error.code ?? "error").slice(0, 40)}: ${parsed.error.message.slice(0, 200)}`,
          PROVIDER,
        );
      }
    } catch (parseError) {
      if (parseError instanceof MapsError) throw parseError;
    }
  }
  throw error;
}

function toSquare(response: W3wResponse): What3wordsSquare {
  const { coordinates, square, words } = response;
  const southwest = square?.southwest;
  const northeast = square?.northeast;
  if (
    typeof words !== "string" ||
    typeof coordinates?.lat !== "number" ||
    typeof coordinates.lng !== "number" ||
    typeof southwest?.lat !== "number" ||
    typeof southwest.lng !== "number" ||
    typeof northeast?.lat !== "number" ||
    typeof northeast.lng !== "number"
  ) {
    throw new MapsError("what3words answered without words, coordinates or square", PROVIDER);
  }
  return {
    words,
    center: { latitude: coordinates.lat, longitude: coordinates.lng },
    bounds: {
      south: southwest.lat,
      north: northeast.lat,
      west: southwest.lng,
      east: northeast.lng,
    },
    nearestPlace: response.nearestPlace || undefined,
    country: response.country || undefined,
  };
}

/**
 * The square behind a three word address.
 *
 * @throws {AuthError} Without a key, or when what3words rejects it.
 * @throws {InvalidInputError} When what3words does not know the words.
 */
export async function what3wordsToSquare(
  words: string,
  options?: What3wordsOptions,
): Promise<What3wordsSquare> {
  const key = requireKey(options);
  const text = words.trim().replace(/^\/\/\//, "");
  const url = `${options?.baseUrl ?? BASE_URL}/convert-to-coordinates?${new URLSearchParams({ words: text })}`;
  const response = await getJSON<W3wResponse>(url, {
    headers: { "X-Api-Key": key },
    signal: options?.signal,
    provider: PROVIDER,
  }).catch(explain);
  return toSquare(response);
}

/**
 * The three word address of the square holding a point.
 *
 * @throws {AuthError} Without a key, or when what3words rejects it.
 */
export async function squareToWhat3words(
  point: GeoPoint,
  options?: What3wordsOptions,
): Promise<What3wordsSquare> {
  assertCoordinates(point.latitude, point.longitude);
  const key = requireKey(options);
  const query = new URLSearchParams({ coordinates: `${point.latitude},${point.longitude}` });
  if (options?.language?.trim()) query.set("language", options.language.trim());
  const response = await getJSON<W3wResponse>(
    `${options?.baseUrl ?? BASE_URL}/convert-to-3wa?${query}`,
    { headers: { "X-Api-Key": key }, signal: options?.signal, provider: PROVIDER },
  ).catch(explain);
  return toSquare(response);
}
