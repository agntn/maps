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
