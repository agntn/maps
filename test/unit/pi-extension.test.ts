import type {
  ExtensionAPI,
  ExtensionContext,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { Value } from "typebox/value";
import { requireTool } from "../helpers.ts";
import mapsExtension from "../../packages/pi/extensions/maps.ts";

/** SAFETY: the extension only calls registerTool during registration; the fake implements that exact seam. */
function registerExtensionTools(): Map<string, ToolDefinition> {
  const tools = new Map<string, ToolDefinition>();
  const api = {
    registerTool(tool: ToolDefinition) {
      tools.set(tool.name, tool);
    },
  };

  mapsExtension(api as unknown as ExtensionAPI);
  return tools;
}

/** SAFETY: the tested execute functions do not read ExtensionContext. */
const unusedContext = {} as ExtensionContext;

describe("maps Pi extension", () => {
  it("registers the complete tool set", () => {
    const tools = registerExtensionTools();

    expect([...tools.keys()]).toEqual(["maps_geocode", "maps_reverse", "maps_providers"]);
  });

  it("names each tool in every prompt guideline", () => {
    const tools = registerExtensionTools();

    for (const tool of tools.values()) {
      expect(tool.promptGuidelines).not.toHaveLength(0);
      for (const guideline of tool.promptGuidelines ?? []) {
        expect(guideline).toContain(tool.name);
      }
    }
  });

  it("declares an integer geocode limit from 1 through 40", () => {
    const tool = requireTool(registerExtensionTools(), "maps_geocode");

    expect(Value.Check(tool.parameters, { query: "Warsaw", limit: 1 })).toBe(true);
    expect(Value.Check(tool.parameters, { query: "Warsaw", limit: 40 })).toBe(true);
    expect(Value.Check(tool.parameters, { query: "Warsaw", limit: 0 })).toBe(false);
    expect(Value.Check(tool.parameters, { query: "Warsaw", limit: 41 })).toBe(false);
    expect(Value.Check(tool.parameters, { query: "Warsaw", limit: 1.5 })).toBe(false);
  });

  it("bounds reverse coordinates to valid WGS 84 ranges", () => {
    const tool = requireTool(registerExtensionTools(), "maps_reverse");

    expect(Value.Check(tool.parameters, { latitude: 52.23, longitude: 21.01 })).toBe(true);
    expect(Value.Check(tool.parameters, { latitude: 95, longitude: 21.01 })).toBe(false);
    expect(Value.Check(tool.parameters, { latitude: 52.23, longitude: 200 })).toBe(false);
    expect(Value.Check(tool.parameters, { latitude: 52.23 })).toBe(false);
  });

  it("lists providers without model or network access", async () => {
    const tool = requireTool(registerExtensionTools(), "maps_providers");

    const result = await tool.execute("test", {}, undefined, undefined, unusedContext);

    expect(result.content).toEqual([
      {
        type: "text",
        text: expect.stringMatching(/^Registered providers \(2\):/),
      },
    ]);
  });
});
