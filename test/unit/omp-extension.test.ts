import * as TypeBox from "@oh-my-pi/omptype/typebox";
import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@oh-my-pi/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

/**
 * The host serves these modules to loaded extensions at runtime; under vitest the renderers are
 * exercised against capturing stand-ins instead of the OMP TUI.
 */
vi.mock("@oh-my-pi/pi-coding-agent", () => ({
  Text: class {
    constructor(
      readonly text: string,
      readonly paddingX?: number,
      readonly paddingY?: number,
    ) {}
  },
}));
vi.mock("@oh-my-pi/pi-coding-agent/tui", () => ({
  renderStatusLine: (options: unknown) => JSON.stringify(options),
}));

import { requireTool, stubJSON } from "../helpers.ts";
import mapsOmpExtension, { sanitizeTerminalText } from "../../packages/omp/extensions/maps.ts";

interface RegisteredExtension {
  label: string | undefined;
  tools: Map<string, ToolDefinition>;
}

/** SAFETY: the test host implements the three registration-time capabilities used by the extension. */
function registerExtensionTools(): RegisteredExtension {
  const tools = new Map<string, ToolDefinition>();
  let label: string | undefined;
  const api = {
    typebox: TypeBox,
    setLabel(value: string) {
      label = value;
    },
    registerTool(tool: ToolDefinition) {
      tools.set(tool.name, tool);
    },
  };

  mapsOmpExtension(api as unknown as ExtensionAPI);
  return { label, tools };
}

/** SAFETY: the test host injects OMP's TypeBox facade, which creates this schema. */
function accepts(tool: ToolDefinition, value: unknown): boolean {
  return (tool.parameters as unknown as TypeBox.TSchema).safeParse(value).success;
}

/** SAFETY: the tested execute functions do not read ExtensionContext. */
const unusedContext = {} as ExtensionContext;

describe("maps OMP extension", () => {
  it("registers the complete read-only tool set under an extension label", () => {
    const { label, tools } = registerExtensionTools();

    expect(label).toBe("Maps");
    expect([...tools.keys()]).toEqual([
      "maps_geocode",
      "maps_geocode_address",
      "maps_reverse",
      "maps_distance",
      "maps_providers",
    ]);
    for (const tool of tools.values()) expect(tool.approval).toBe("read");
  });

  it("declares an integer geocode limit from 1 through 40", () => {
    const tool = requireTool(registerExtensionTools().tools, "maps_geocode");

    expect(accepts(tool, { query: "Warsaw", limit: 1 })).toBe(true);
    expect(accepts(tool, { query: "Warsaw", limit: 40 })).toBe(true);
    expect(accepts(tool, { query: "Warsaw", limit: 0 })).toBe(false);
    expect(accepts(tool, { query: "Warsaw", limit: 41 })).toBe(false);
    expect(accepts(tool, { query: "Warsaw", limit: 1.5 })).toBe(false);
  });

  it("bounds reverse coordinates to valid WGS 84 ranges", () => {
    const tool = requireTool(registerExtensionTools().tools, "maps_reverse");

    expect(accepts(tool, { latitude: 52.23, longitude: 21.01 })).toBe(true);
    expect(accepts(tool, { latitude: 95, longitude: 21.01 })).toBe(false);
    expect(accepts(tool, { latitude: 52.23, longitude: 200 })).toBe(false);
    expect(accepts(tool, {})).toBe(false);
  });

  it("requires both distance points and bounds their ranges", () => {
    const tool = requireTool(registerExtensionTools().tools, "maps_distance");

    const from = { latitude: 0, longitude: 0 };
    expect(accepts(tool, { from, to: { latitude: 0, longitude: 1 } })).toBe(true);
    expect(accepts(tool, { from })).toBe(false);
    expect(accepts(tool, { from, to: { latitude: 95, longitude: 1 } })).toBe(false);
  });

  it("compares providers side by side when provider is 'all'", async () => {
    stubJSON([{ lat: "52.23", lon: "21.01", display_name: "Warszawa, Polska" }]);
    const tool = requireTool(registerExtensionTools().tools, "maps_geocode");

    const result = await tool.execute(
      "test",
      { query: "Warszawa", provider: "all" },
      undefined,
      undefined,
      unusedContext,
    );
    vi.unstubAllGlobals();

    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('[openstreetmap] 1 matches for "Warszawa"');
    expect(text).toContain("[googlemaps] error: Authentication failed for googlemaps");
  });

  it("strips terminal control sequences at the render boundary", () => {
    const ESC = String.fromCharCode(27);
    const BEL = String.fromCharCode(7);

    expect(sanitizeTerminalText("plain text")).toBe("plain text");
    expect(sanitizeTerminalText(`evil${ESC}[31mred`)).toBe("evilred");
    expect(sanitizeTerminalText(`red${BEL}bell`)).toBe("red bell");
    expect(sanitizeTerminalText(undefined)).toBe("undefined");
  });

  it("lists providers without model or network access, keeping line structure", async () => {
    const tool = requireTool(registerExtensionTools().tools, "maps_providers");

    const result = await tool.execute("test", {}, undefined, undefined, unusedContext);

    expect(result.content).toEqual([
      {
        type: "text",
        text: expect.stringMatching(/^Registered providers \(2\):/),
      },
    ]);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("\n  openstreetmap");
  });
});
