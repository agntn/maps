/**
 * MCP subprocess gate: the built stdio server exercised through a real client transport.
 *
 * Runs with DEBUG=1 on purpose - the handshake fails outright if anything pollutes stdout, and a
 * separate raw spawn asserts every stdout line parses as JSON. Set MAPS_EVAL_OFFLINE=1 to skip
 * the one live geocode.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const CLI = fileURLToPath(new URL("../dist/cli.mjs", import.meta.url));
const LIVE = process.env.MAPS_EVAL_OFFLINE !== "1";

/** Credentials are dropped so provider auto-selection stays deterministic. */
const env = { ...process.env, DEBUG: "1" };
delete env.GOOGLE_MAPS_API_KEY;
delete env.WHAT3WORDS_API_KEY;

let failures = 0;

function check(name, ok, detail = "") {
  console.log(`${ok ? "ok" : "FAIL"} - ${name}`);
  if (!ok) {
    failures += 1;
    if (detail) console.log(String(detail).slice(0, 400));
  }
}

function firstText(response) {
  return response.content?.[0]?.text ?? "";
}

const proc = spawn("node", [CLI, "mcp"], { env, stdio: ["pipe", "pipe", "pipe"] });
proc.stdin.write(
  `${JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "purity", version: "0" },
    },
  })}\n`,
);
const rawStdout = await new Promise((resolve) => {
  let output = "";
  const finish = () => {
    proc.kill();
    resolve(output);
  };
  proc.stdout.on("data", (chunk) => {
    output += String(chunk);
    if (output.includes("\n")) finish();
  });
  setTimeout(finish, 10_000);
});
const rawLines = rawStdout.trim().split("\n").filter(Boolean);
check(
  "stdout carries only JSON-RPC frames under DEBUG=1",
  rawLines.length > 0 &&
    rawLines.every((line) => {
      try {
        JSON.parse(line);
        return true;
      } catch {
        return false;
      }
    }),
  rawStdout,
);

const transport = new StdioClientTransport({ command: "node", args: [CLI, "mcp"], env });
const client = new Client({ name: "maps-eval", version: "1.0.0" });
await client.connect(transport);

const listed = await client.listTools();
check(
  "lists the six maps tools",
  JSON.stringify(listed.tools.map((tool) => tool.name)) ===
    JSON.stringify([
      "maps_providers",
      "maps_geocode",
      "maps_address_geocode",
      "maps_reverse",
      "maps_distance",
      "maps_convert",
    ]),
  JSON.stringify(listed.tools.map((tool) => tool.name)),
);

const geocodeTool = listed.tools.find((tool) => tool.name === "maps_geocode");
const rawFlag = geocodeTool?.inputSchema?.properties?.raw;
check(
  "geocode declares raw as an opt-in boolean",
  rawFlag?.type === "boolean" && rawFlag.description?.includes("Defaults to false"),
  JSON.stringify(rawFlag),
);

const providers = await client.callTool({ name: "maps_providers", arguments: {} });
check(
  "providers reports the unconfigured backend",
  providers.isError !== true &&
    firstText(providers).includes("openstreetmap") &&
    firstText(providers).includes("googlemaps: (requires API key"),
  firstText(providers),
);

const distance = await client.callTool({
  name: "maps_distance",
  arguments: { from: { latitude: 0, longitude: 0 }, to: { latitude: 0, longitude: 1 } },
});
check(
  "distance returns meters and bearing",
  distance.isError !== true &&
    firstText(distance) === "Distance: 111.20 km (111195 m)\nBearing: 90°",
  firstText(distance),
);

const rhumb = await client.callTool({
  name: "maps_distance",
  arguments: {
    from: { latitude: 35, longitude: 45 },
    to: { latitude: 35, longitude: 135 },
    path: "rhumb",
  },
});
check(
  "distance follows a rhumb line on request",
  rhumb.isError !== true &&
    firstText(rhumb) === "Rhumb distance: 8197.71 km (8197711 m)\nRhumb bearing: 90°",
  firstText(rhumb),
);

const convert = await client.callTool({
  name: "maps_convert",
  arguments: { input: "ezs42", to: ["decimal", "maidenhead"] },
});
check(
  "convert decodes a geohash cell locally",
  convert.isError !== true &&
    firstText(convert).includes("  decimal     42.604980, -5.603027") &&
    firstText(convert).includes("  maidenhead  IN72eo") &&
    firstText(convert).includes("Cell: 42.5830078125.."),
  firstText(convert),
);

const outOfRange = await client.callTool({
  name: "maps_reverse",
  arguments: { latitude: 95, longitude: 21 },
});
check("schema rejects latitude 95", outOfRange.isError === true, firstText(outOfRange));

const unknown = await client.callTool({
  name: "maps_geocode",
  arguments: { query: "Warsaw", provider: "missing" },
});
check(
  "unknown provider surfaces as a tool error",
  unknown.isError === true && firstText(unknown).includes("Unknown provider: missing"),
  firstText(unknown),
);

if (LIVE) {
  const geocode = await client.callTool({
    name: "maps_geocode",
    arguments: { query: "Pałac Kultury i Nauki, Warszawa", limit: 1 },
  });
  check(
    "live geocode answers with the provider name, coordinates and facts, without the raw record",
    geocode.isError !== true &&
      firstText(geocode).startsWith("[openstreetmap] 1 matches") &&
      firstText(geocode).includes("52.2317657, 21.0057979") &&
      firstText(geocode).includes("address houseNumber 1, road Plac Defilad") &&
      !firstText(geocode).includes("raw "),
    firstText(geocode),
  );
} else {
  console.log("skip - live check disabled via MAPS_EVAL_OFFLINE=1");
}

await client.close();

if (LIVE) {
  await new Promise((resolve) => setTimeout(resolve, 1100));
  const dummyTransport = new StdioClientTransport({
    command: "node",
    args: [CLI, "mcp"],
    env: { ...env, GOOGLE_MAPS_API_KEY: "dummy" },
  });
  const dummyClient = new Client({ name: "maps-eval-fallback", version: "1.0.0" });
  await dummyClient.connect(dummyTransport);
  const fallback = await dummyClient.callTool({
    name: "maps_geocode",
    arguments: { query: "Rynek, Wrocław", limit: 1 },
  });
  check(
    "a dummy Google key falls back to openstreetmap through the server",
    fallback.isError !== true && firstText(fallback).startsWith("[openstreetmap]"),
    firstText(fallback),
  );
  await dummyClient.close();
}

console.log(
  failures === 0 ? "eval-mcp: all checks passed" : `eval-mcp: ${failures} check(s) failed`,
);
process.exit(failures === 0 ? 0 : 1);
