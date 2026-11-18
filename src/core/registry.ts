/** Self-registering provider registry for Maps */

import { Provider } from "./provider.ts";
import type { ProviderConstructor } from "./provider.ts";
import type { ProviderCapabilities, ProviderConfig } from "./types.ts";
import { UnknownProviderError } from "./errors.ts";

interface RegistryEntry {
  defaultURL?: string;
  providerClass: ProviderConstructor;
}

const registry = new Map<string, RegistryEntry>();

/**
 * Register a provider class under its stable `key`.
 *
 * Registering the same name again replaces the previous entry. That is useful in tests, but easy
 * to do by accident in application code.
 *
 * @param providerClass - The provider class.
 * @param defaultURL - Public endpoint to advertise.
 */
export function register(providerClass: ProviderConstructor, defaultURL?: string): void {
  registry.set(providerClass.key, { defaultURL, providerClass });
}

/**
 * Create a registered provider with optional backend configuration.
 *
 * @example
 *   ```ts
 *   import { create } from "@agntn/maps";
 *
 *   const provider = create("openstreetmap");
 *   const [best] = await provider.geocode("Pałac Kultury i Nauki, Warszawa");
 *   ```
 *
 * @param name - Registry key.
 * @param config - Backend configuration.
 * @returns {Provider} A new instance.
 * @throws {UnknownProviderError} When `name` has not been registered.
 */
export function create(name: string, config?: ProviderConfig): Provider {
  const entry = registry.get(name);
  if (!entry) {
    throw new UnknownProviderError(name);
  }
  return new entry.providerClass(config ?? {});
}

/**
 * Return registered provider names in registration order.
 *
 * @returns {string[]} The registry keys.
 */
export function providers(): string[] {
  return Array.from(registry.keys());
}

/**
 * Check whether a name can be passed to `create`.
 *
 * @param name - Registry key.
 * @returns {boolean} Whether it's registered.
 */
export function has(name: string): boolean {
  return registry.has(name);
}

/**
 * Return the public endpoint advertised when a provider was registered.
 *
 * Per-instance `baseUrl` overrides are deliberately not reflected here.
 *
 * @param name - Registry key.
 * @returns {string | undefined} The endpoint, or nothing for an unknown name.
 */
export function getDefaultURL(name: string): string | undefined {
  return registry.get(name)?.defaultURL;
}

/** One row of `listProviders()`. */
export interface ProviderListing {
  /** Registry key */
  name: string;
  /** Public endpoint advertised at registration */
  defaultUrl?: string;
  /** Operations the provider serves; absent when construction needs configuration */
  capabilities?: ProviderCapabilities;
  /** True when the provider cannot be constructed without credentials */
  requiresConfiguration?: boolean;
}

/**
 * Enumerate registered providers with their capabilities.
 *
 * A provider whose constructor demands missing credentials is reported as requiring
 * configuration instead of failing the whole listing.
 *
 * @returns {ProviderListing[]} One row per provider, in registration order.
 */
export function listProviders(): ProviderListing[] {
  return providers().map((name) => {
    const base = { name, defaultUrl: getDefaultURL(name) };
    try {
      return { ...base, capabilities: create(name).capabilities };
    } catch {
      return { ...base, requiresConfiguration: true };
    }
  });
}
