import { ToolInputError, wireSchema } from "@agntn/tools";
import type {
  ExtensionAPI,
  ExtensionContext,
  Theme,
  ToolDefinition,
} from "@oh-my-pi/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

/** Compiled OMP gives an extension only the package root, so loading the TUI barrel has to fail. */
vi.mock("@oh-my-pi/pi-coding-agent/tui", () => {
  throw new Error("The OMP host does not inject the TUI barrel");
});

import mapsOmpExtension from "../../packages/omp/extensions/maps.ts";
import { mapsTools } from "../../src/tools.ts";
import { NETWORKED_CALLS, requireTool, stubJSON, stubPendingFetch } from "../helpers.ts";

/** Stands in for the host `Text`, keeping the drawn line for the assertion. */
class CapturedText {
  constructor(readonly text: string) {}
}

/** The host build wraps the JSON Schema in `Type.Unsafe` and emits it verbatim. */
const hostTypebox = {
  Type: { Unsafe: (schema: unknown) => schema },
} as unknown as ExtensionAPI["typebox"];

/** A host double that throws on any member the extension was not expected to read. */
function strictDouble<T extends object>(name: string, stubs: Partial<T>): T {
  return new Proxy(stubs, {
    get(target, key, receiver) {
      if (typeof key === "symbol" || key === "then" || Reflect.has(target, key)) {
        return Reflect.get(target, key, receiver);
      }
      throw new Error(`${name}.${String(key)} is not stubbed in the OMP test host`);
    },
  }) as T;
}

interface RegisteredExtension {
  labels: string[];
  tools: Map<string, ToolDefinition>;
}

async function registerExtensionTools(): Promise<RegisteredExtension> {
  const tools = new Map<string, ToolDefinition>();
  const labels: string[] = [];
  await mapsOmpExtension(
    strictDouble<ExtensionAPI>("ExtensionAPI", {
      typebox: hostTypebox,
      pi: strictDouble<ExtensionAPI["pi"]>("ExtensionAPI.pi", {
        Text: CapturedText as unknown as ExtensionAPI["pi"]["Text"],
      }),
      setLabel(label) {
        labels.push(label);
      },
      registerTool(tool) {
        tools.set(tool.name, tool as ToolDefinition);
      },
    }),
  );
  return { labels, tools };
}

/** Writes its styling calls into the output, so a test sees what went where. */
const theme = strictDouble<Theme>("Theme", {
  fg: (color, text) => `${color}(${text})`,
  styledSymbol: (symbol, color) => `${color}:${symbol}`,
  spinnerFrames: ["frame-0", "frame-1"],
  format: strictDouble<Theme["format"]>("Theme.format", { bracketLeft: "[", bracketRight: "]" }),
  sep: strictDouble<Theme["sep"]>("Theme.sep", { dot: " | " }),
});

/** SAFETY: the tested execute functions do not read ExtensionContext. */
const unusedContext = {} as ExtensionContext;

async function run(name: string, params: unknown) {
  const tool = requireTool((await registerExtensionTools()).tools, name);
  return tool.execute("test", params as never, undefined, undefined, unusedContext);
}

async function text(name: string, params: unknown): Promise<string> {
  return ((await run(name, params)).content[0] as { text: string }).text;
}

async function statusLine(name: string, args: Record<string, unknown>): Promise<string> {
  const tool = requireTool((await registerExtensionTools()).tools, name);
  const drawn = tool.renderCall?.(args as never, { expanded: false, isPartial: false }, theme);
  return (drawn as unknown as CapturedText).text;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("maps OMP extension", () => {
  it("registers the complete read-only tool set under an extension label", async () => {
    const { labels, tools } = await registerExtensionTools();

    expect(labels).toEqual(["Maps"]);
    expect([...tools.keys()]).toEqual([
      "maps_providers",
      "maps_geocode",
      "maps_address_geocode",
      "maps_reverse",
      "maps_distance",
      "maps_convert",
    ]);
    for (const definition of mapsTools) {
      const tool = requireTool(tools, definition.name);
      expect(tool.approval).toBe("read");
      expect(tool.label).toBe(definition.title);
      expect(tool.parameters).toEqual(wireSchema(definition));
    }
  });

  it.each([0, 41, 1.5])("refuses geocode limit %s in the core", async (limit) => {
    await expect(run("maps_geocode", { query: "Warsaw", limit })).rejects.toThrow(ToolInputError);
  });

  it("accepts only the named geocode layers", async () => {
    await expect(run("maps_geocode", { query: "Warsaw", layers: ["railway"] })).rejects.toThrow(
      "address, poi, natural",
    );
    await expect(run("maps_geocode", { query: "Warsaw", layers: "poi" })).rejects.toThrow(
      ToolInputError,
    );
  });

  it("bounds reverse coordinates to valid WGS 84 ranges", async () => {
    await expect(run("maps_reverse", { latitude: 95, longitude: 21.01 })).rejects.toThrow(
      "/latitude",
    );
    await expect(run("maps_reverse", {})).rejects.toThrow(ToolInputError);
  });

  it("requires both distance points and bounds their ranges", async () => {
    const from = { latitude: 0, longitude: 0 };
    await expect(run("maps_distance", { from })).rejects.toThrow("to");
    await expect(
      run("maps_distance", { from, to: { latitude: 95, longitude: 1 } }),
    ).rejects.toThrow("/to/latitude");
  });

  it("bounds conversion formats and precision, then converts locally", async () => {
    await expect(run("maps_convert", { input: "ezs42", to: ["w3w"] })).rejects.toThrow("/to/0");
    await expect(run("maps_convert", { input: "ezs42", precision: { mgrs: 6 } })).rejects.toThrow(
      "/precision/mgrs",
    );
    await expect(
      run("maps_convert", { input: "ezs42", precision: { maidenhead: 3, pluscode: 11 } }),
    ).rejects.toThrow("/precision/maidenhead");
    await expect(
      run("maps_convert", { input: "ezs42", precision: { what3words: 1 } }),
    ).rejects.toThrow('unknown property "what3words"');

    await expect(
      text("maps_convert", { input: "34U EC 0083 8658", to: ["decimal"] }),
    ).resolves.toContain("  decimal  52.229685, 21.012226");
  });

  it("compares providers side by side when provider is 'all'", async () => {
    stubJSON([{ lat: "52.23", lon: "21.01", display_name: "Warszawa, Polska" }]);

    const result = await text("maps_geocode", { query: "Warszawa", provider: "all" });
    vi.unstubAllGlobals();

    expect(result).toContain('[openstreetmap] 1 matches for "Warszawa"');
    expect(result).toContain("[googlemaps] error: Authentication failed for googlemaps");
  });

  it.each([
    ["maps_providers", {}, "list"],
    ["maps_geocode", { query: "Złota 44" }, "Złota 44"],
    ["maps_address_geocode", { road: "Złota", city: "Warszawa" }, "Złota, Warszawa"],
    ["maps_address_geocode", {}, "empty address"],
    ["maps_reverse", { latitude: 52.23, longitude: 21.01 }, "52.23, 21.01"],
    [
      "maps_distance",
      { from: { latitude: 0, longitude: 0 }, to: { latitude: 0, longitude: 1 } },
      "0,0 to 0,1",
    ],
    ["maps_convert", { input: "KO02mf" }, "KO02mf"],
  ] as const)("draws the call of %s on the status line", async (name, args, summary) => {
    const definition = mapsTools.find((tool) => tool.name === name);

    await expect(statusLine(name, args)).resolves.toBe(
      `success:status.done accent(${definition?.title}): muted(${summary})`,
    );
  });

  it("strips terminal control sequences from model arguments on the status line", async () => {
    const ESC = String.fromCodePoint(27);
    const BEL = String.fromCodePoint(7);

    await expect(
      statusLine("maps_geocode", { query: `evil${ESC}[31mred${BEL}bell\nnext` }),
    ).resolves.toBe("success:status.done accent(Geocode a Place): muted(evilred bell next)");
  });

  it("lists providers without model or network access, keeping line structure", async () => {
    const result = await text("maps_providers", {});

    expect(result).toMatch(/^Registered providers \(2\):/);
    expect(result).toContain("\n  openstreetmap");
  });

  it.each(NETWORKED_CALLS)(
    "cancels the requests of %s %j with the host signal",
    async (name, params) => {
      vi.stubEnv("WHAT3WORDS_API_KEY", "test-key");
      const signals = stubPendingFetch();
      const tool = requireTool((await registerExtensionTools()).tools, name);
      const controller = new AbortController();

      const pending = tool.execute(
        "test",
        params as never,
        controller.signal,
        undefined,
        unusedContext,
      );
      await vi.waitFor(() => expect(signals.length).toBeGreaterThan(0));
      controller.abort();

      await pending.catch(() => undefined);
      expect(signals.every((signal) => signal.aborted)).toBe(true);
    },
  );
});
