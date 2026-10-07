/** Auto-select provider by checking env vars */

import { create, providers, has } from "./registry.ts";
import { UnknownProviderError } from "./errors.ts";
import type { Provider } from "./provider.ts";

/** Credential env var per keyed built-in provider; keyless providers are simply absent. */
const ENV_MAP: Record<string, string> = {
  googlemaps: "GOOGLE_MAPS_API_KEY",
};

/**
 * Check for the reserved "all" provider value, which fans a request out to every registered
 * provider instead of selecting one. Surfaces test this before calling `selectProvider`.
 */
export function isAllProviders(preferred?: string): boolean {
  return preferred?.trim().toLowerCase() === "all";
}

/**
 * Choose a registered provider for the current environment.
 *
 * An explicit preference wins. Without one, a provider with configured credentials is selected
 * first, followed by OpenStreetMap, whose public Nominatim instance answers without a key.
 *
 * @throws {UnknownProviderError} When an explicit preference is not registered.
 */
export function resolveProvider(preferred?: string): string {
  if (preferred) {
    if (!has(preferred)) {
      throw new UnknownProviderError(preferred);
    }
    return preferred;
  }

  for (const [name, envKey] of Object.entries(ENV_MAP)) {
    if (has(name) && process.env[envKey]) return name;
  }

  return has("openstreetmap") ? "openstreetmap" : (providers()[0] ?? "openstreetmap");
}

/** A provider instance paired with its registry key. */
export interface SelectedProvider {
  /** Registry key of the selected provider */
  name: string;
  /** Ready-to-use provider instance */
  provider: Provider;
}

/**
 * Resolve the provider one request should use.
 *
 * This is the single selection path shared by the CLI, MCP server, AI tools, and both agent
 * extensions. Empty or whitespace-only arguments count as absent, so a client that sends `""`
 * gets the same behavior as one that omits the field. A `signal` cancels the provider's requests.
 */
export function selectProvider(preferred?: string, signal?: AbortSignal): SelectedProvider {
  const preferredName = preferred?.trim() || undefined;
  const name = resolveProvider(preferredName);
  return { name, provider: create(name, { signal }) };
}
