import { createServer } from "node:http";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { getJSON } from "../../src/core/client.ts";
import {
  AuthError,
  HTTPError,
  InvalidInputError,
  NotFoundError,
  PaymentError,
  RateLimitError,
} from "../../src/core/errors.ts";

const URL_ = "https://nominatim.test/search?q=Warszawa&format=jsonv2";

afterEach(() => {
  vi.unstubAllGlobals();
});

type Signal = AbortSignal | null | undefined;

/** Stub fetch like undici: an aborted signal rejects unsent, a live one reaches `respond`. */
function stubFetch(respond: (signal: Signal) => Promise<Response>) {
  const fetch = vi.fn<typeof globalThis.fetch>((_input, init) =>
    init?.signal?.aborted ? Promise.reject(init.signal.reason) : respond(init?.signal),
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

/** A request that never answers and settles only when its signal aborts. */
function stall(signal: Signal): Promise<Response> {
  return new Promise((_, reject) => {
    signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}

/** Headers of the one request the stub saw. */
function sentHeaders(fetch: ReturnType<typeof stubFetch>): Headers {
  return new Headers(fetch.mock.calls[0]?.[1]?.headers);
}

describe("successful responses", () => {
  it("parses JSON and identifies itself", async () => {
    const fetch = stubFetch(async () => Response.json([{ lat: "52.2297", lon: "21.0122" }]));

    await expect(getJSON(URL_)).resolves.toEqual([{ lat: "52.2297", lon: "21.0122" }]);
    expect(fetch.mock.calls[0]?.[0]).toBe(URL_);
    const headers = sentHeaders(fetch);
    expect(headers.get("accept")).toBe("application/json");
    expect(headers.get("user-agent")).toMatch(/^agntn-maps\/\S+ \(https:/);
  });

  it("lets caller headers override the defaults", async () => {
    const fetch = stubFetch(async () => Response.json({}));

    await getJSON(URL_, { headers: { Accept: "application/geo+json", "Accept-Language": "pl" } });
    const headers = sentHeaders(fetch);
    expect(headers.get("accept")).toBe("application/geo+json");
    expect(headers.get("accept-language")).toBe("pl");
  });

  it("replaces a default header named in lowercase instead of joining it", async () => {
    const fetch = stubFetch(async () => Response.json({}));

    await getJSON(URL_, { headers: { accept: "application/geo+json", "user-agent": "custom" } });
    const headers = sentHeaders(fetch);
    expect(headers.get("accept")).toBe("application/geo+json");
    expect(headers.get("user-agent")).toBe("custom");
  });

  it("parses JSON served as text/plain", async () => {
    stubFetch(async () => new Response('{"status":"OK","results":[]}'));

    await expect(getJSON(URL_)).resolves.toEqual({ status: "OK", results: [] });
  });

  it("hands back malformed JSON as the raw text", async () => {
    stubFetch(
      async () =>
        new Response("<html>gateway hiccup</html>", {
          headers: { "Content-Type": "application/json" },
        }),
    );

    await expect(getJSON(URL_)).resolves.toBe("<html>gateway hiccup</html>");
  });

  it("drops keys that would reach a prototype", async () => {
    stubFetch(async () => new Response('{"place_id":1,"__proto__":{"polluted":true}}'));

    const record = await getJSON<Record<string, unknown>>(URL_);
    expect(record).toEqual({ place_id: 1 });
    expect(Object.getPrototypeOf(record)).toBe(Object.prototype);
  });
});

describe("empty responses", () => {
  it("answers a bodiless status with nothing", async () => {
    stubFetch(async () => new Response(null, { status: 204 }));

    await expect(getJSON(URL_)).resolves.toBeUndefined();
  });

  it("reads an empty body as an empty string", async () => {
    stubFetch(async () => new Response(""));

    await expect(getJSON(URL_)).resolves.toBe("");
  });
});

describe("HTTP failures", () => {
  it.each([
    [401, AuthError],
    [403, AuthError],
    [402, PaymentError],
    [404, NotFoundError],
    [429, RateLimitError],
  ])("maps HTTP %i onto its class with the provider attached", async (status, expected) => {
    stubFetch(async () => Response.json({ error: "nope" }, { status }));

    const error = await getJSON(URL_, { provider: "openstreetmap" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(expected);
    expect(error).toMatchObject({ provider: "openstreetmap" });
  });

  it("keeps the status and body of a server error and does not retry it", async () => {
    const fetch = stubFetch(async () => new Response("down for maintenance", { status: 503 }));

    await expect(getJSON(URL_, { provider: "openstreetmap" })).rejects.toMatchObject({
      name: "HTTPError",
      statusCode: 503,
      body: "down for maintenance",
      provider: "openstreetmap",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("keeps an empty error body empty", async () => {
    stubFetch(async () => new Response("", { status: 500 }));

    await expect(getJSON(URL_)).rejects.toMatchObject({ name: "HTTPError", body: "" });
  });

  it("redacts the Google key from the URL and the echoed body", async () => {
    const url = "https://maps.googleapis.test/maps/api/geocode/json?address=x&key=SECRET123";
    stubFetch(async () => new Response(`bad request to ${url}`, { status: 400 }));

    const error = await getJSON(url, { provider: "googlemaps" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HTTPError);
    expect(JSON.stringify(error) + String(error)).not.toContain("SECRET123");
  });
});

describe("deadline and cancellation", () => {
  it("gives every request a deadline by default", async () => {
    const fetch = stubFetch(async () => Response.json({}));

    await getJSON(URL_);
    const signal = fetch.mock.calls[0]?.[1]?.signal;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(false);
  });

  it("turns a stalled request into an HTTPError once the timeout passes", async () => {
    stubFetch(stall);

    await expect(getJSON(URL_, { timeout: 50 })).rejects.toMatchObject({
      name: "HTTPError",
      statusCode: 0,
    });
  });

  it("keeps the timeout when the caller passes a signal of its own", async () => {
    stubFetch(stall);

    await expect(
      getJSON(URL_, { timeout: 50, signal: new AbortController().signal }),
    ).rejects.toMatchObject({ name: "HTTPError", statusCode: 0 });
  });

  it("stops a request in flight when the caller aborts", async () => {
    const fetch = stubFetch(stall);
    const controller = new AbortController();

    const pending = getJSON(URL_, { signal: controller.signal });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    controller.abort();

    await expect(pending).rejects.toBeInstanceOf(HTTPError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("waits indefinitely when the timeout is 0", async () => {
    const fetch = stubFetch(async () => Response.json({}));

    await getJSON(URL_, { timeout: 0 });
    expect(fetch.mock.calls[0]?.[1]?.signal).toBeUndefined();
  });

  it("rounds a fractional timeout up instead of rejecting it", async () => {
    stubFetch(async () => Response.json({ ok: true }));

    await expect(getJSON(URL_, { timeout: 1.5 })).resolves.toEqual({ ok: true });
  });

  it.each([Number.NaN, -1, -0.5, Number.POSITIVE_INFINITY, 2 ** 31])(
    "refuses a timeout of %s before sending anything",
    async (timeout) => {
      const fetch = stubFetch(async () => Response.json({}));

      await expect(getJSON(URL_, { timeout, provider: "openstreetmap" })).rejects.toBeInstanceOf(
        InvalidInputError,
      );
      expect(fetch).not.toHaveBeenCalled();
    },
  );
});

describe("against a real server", () => {
  let server: Server;
  let base: string;
  const agents: (string | undefined)[] = [];

  beforeAll(async () => {
    server = createServer((request, response) => {
      agents.push(request.headers["user-agent"]);
      if (request.url?.startsWith("/search?")) {
        response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify([{ display_name: "Złota 44, Warszawa" }]));
      } else {
        response.writeHead(404).end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it("decodes the answer and identifies itself", async () => {
    await expect(getJSON(`${base}/search?q=Z%C5%82ota`)).resolves.toEqual([
      { display_name: "Złota 44, Warszawa" },
    ]);
    expect(agents.at(-1)).toMatch(/^agntn-maps\/\S+ \(https:/);
  });

  it("maps the server's 404 onto NotFoundError", async () => {
    await expect(getJSON(`${base}/missing`, { provider: "openstreetmap" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});
