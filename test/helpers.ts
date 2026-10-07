import { vi } from "vitest";

/** Look up a registered extension tool, failing loudly when registration missed it. */
export function requireTool<T>(tools: Map<string, T>, name: string): T {
  const tool = tools.get(name);
  if (!tool) throw new Error(`Tool not registered: ${name}`);
  return tool;
}

/** Stub global fetch with one JSON body; returns the mock for call inspection. */
export function stubJSON(body: unknown, status = 200) {
  const fetch = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

/** Stub global fetch with requests that settle only on abort; returns the signals they got. */
export function stubPendingFetch(): AbortSignal[] {
  const signals: AbortSignal[] = [];
  const fetch = vi.fn(
    (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal ?? undefined;
        if (!signal) return;
        signals.push(signal);
        if (signal.aborted) reject(signal.reason);
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      }),
  );
  vi.stubGlobal("fetch", fetch);
  return signals;
}

/** One call per path that reaches the network: explicit provider, fallback, `all`, what3words. */
export const NETWORKED_CALLS: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
  ["maps_geocode", { query: "Warszawa", provider: "openstreetmap" }],
  ["maps_geocode", { query: "Warszawa" }],
  ["maps_geocode", { query: "Warszawa", provider: "all" }],
  ["maps_address_geocode", { city: "Warszawa", provider: "openstreetmap" }],
  ["maps_address_geocode", { city: "Warszawa" }],
  ["maps_reverse", { latitude: 52.23, longitude: 21.01, provider: "openstreetmap" }],
  ["maps_reverse", { latitude: 52.23, longitude: 21.01, provider: "all" }],
  ["maps_convert", { input: "///index.home.raft" }],
];
