import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { afterEach, describe, expect, it } from "vitest";
import { serverInfo } from "../../src/server-info.ts";

const root = fileURLToPath(new URL("../..", import.meta.url));

const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => key !== "MAPS_DIST" && key !== "NODE_OPTIONS"),
) as Record<string, string>;

const scratch: string[] = [];
const clients: Client[] = [];

/** A directory that goes away after the test, under `parent` or the system temp. */
function temp(parent = tmpdir()) {
  mkdirSync(parent, { recursive: true });
  const directory = mkdtempSync(join(parent, "maps-bin-"));
  scratch.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
  for (const directory of scratch.splice(0)) rmSync(directory, { recursive: true, force: true });
});

/** Writes the module URLs the child loaded to `file` on exit; stderr would cut them. */
function recordLoads(file: string) {
  return `data:text/javascript,${encodeURIComponent(`
  import { writeFileSync } from "node:fs";
  import { registerHooks } from "node:module";
  const loaded = [];
  registerHooks({
    load(url, context, nextLoad) {
      loaded.push(url);
      return nextLoad(url, context);
    },
  });
  process.on("exit", () => writeFileSync(${JSON.stringify(file)}, JSON.stringify(loaded)));
`)}`;
}

const initialize = `${JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "maps-test", version: "1.0.0" },
  },
})}\n`;

/** Sends one initialize to `mcp` from the bin in `base` and tells which build answered. */
function serve(
  base: string,
  options: Readonly<{ env?: Readonly<Record<string, string>>; flags?: readonly string[] }> = {},
) {
  const file = join(temp(), "loaded.json");
  const { status, stdout } = spawnSync(
    process.execPath,
    [...(options.flags ?? []), "--import", recordLoads(file), join(base, "dist/cli.mjs"), "mcp"],
    { encoding: "utf8", env: { ...env, ...options.env }, input: initialize, timeout: 20_000 },
  );
  const urls = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as string[]) : [];
  let from = "unknown";
  if (urls.includes(pathToFileURL(join(base, "dist/cli.mjs")).href)) {
    from = urls.includes(pathToFileURL(join(base, "src/mcp.ts")).href) ? "source" : "bundle";
  }
  const [line = "{}"] = stdout.split("\n");
  const reply = JSON.parse(line) as { result?: { serverInfo?: unknown } };
  return { code: status, from, info: reply.result?.serverInfo };
}

/** What a run that answered from `from` has to match: both builds give the same card. */
function served(from: "bundle" | "source") {
  return { code: 0, from, info: serverInfo };
}

/** Copies the named entries of the checkout into `target`. */
function copy(target: string, ...entries: readonly string[]) {
  for (const entry of entries) cpSync(join(root, entry), join(target, entry), { recursive: true });
  return target;
}

type Patch = Readonly<Record<string, (source: string) => string>>;

/** A checkout copy with `src/` files rewritten, serving `mcp` from its built bin. */
async function checkoutServer(patch: Patch = {}) {
  const checkout = copy(temp(), "dist", "src", "package.json");
  symlinkSync(join(root, "node_modules"), join(checkout, "node_modules"), "dir");
  for (const [file, rewrite] of Object.entries(patch)) {
    const path = join(checkout, "src", file);
    writeFileSync(path, rewrite(readFileSync(path, "utf8")));
  }
  const ran = join(temp(), "ran");
  const client = new Client({ name: "maps-test", version: "1.0.0" });
  clients.push(client);
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [join(checkout, "dist/cli.mjs"), "mcp"],
      env: { ...env, MAPS_TEST_RAN: ran },
      stderr: "ignore",
    }),
  );
  return { checkout, client, ran };
}

type Era = "legacy" | Readonly<{ pin: string }>;

/** A client of one protocol era on `maps mcp` from the checkout's bin. */
async function connect(mode: Era, extra: Readonly<Record<string, string>> = {}) {
  const client = new Client(
    { name: "maps-test", version: "1.0.0" },
    { versionNegotiation: { mode } },
  );
  clients.push(client);
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [join(root, "dist/cli.mjs"), "mcp"],
      env: { ...env, ...extra },
      stderr: "ignore",
    }),
  );
  return client;
}

const builds = [
  { from: "source", extra: {} },
  { from: "bundle", extra: { MAPS_DIST: "1" } },
] as const;
const toolNames = [
  "maps_providers",
  "maps_geocode",
  "maps_address_geocode",
  "maps_reverse",
  "maps_distance",
  "maps_convert",
];

/** Makes the `providers` executor run `statement` first. */
function before(statement: string): Patch {
  return {
    "tool-operations.ts": (source) =>
      `import { writeFileSync as testWrite } from "node:fs";\n${source.replace(
        "  const listings = listProviders();",
        `  ${statement}\n  const listings = listProviders();`,
      )}`,
  };
}

const leavesMark = before('testWrite(process.env["MAPS_TEST_RAN"] ?? "", "ran");');
const pull = 'testWrite(new URL("./pulled.ts", import.meta.url), "export {};\\n");';

/** The one line a call came back with, as an error. */
function refusal(text: string) {
  return { isError: true, content: [{ type: "text", text }] };
}

const restart = refusal("src/ changed under this server, restart it to load the new code");
const dropped = refusal(
  "src/ changed during this call, so its answer was dropped. Restart the server and ask again",
);

describe.skipIf(!existsSync(join(root, "dist/cli.mjs")))("maps mcp from the built bin", () => {
  it("serves the live source inside a checkout", () => {
    expect(serve(root)).toEqual(served("source"));
  });

  it("keeps the bundle under MAPS_DIST=1", () => {
    expect(serve(root, { env: { MAPS_DIST: "1" } })).toEqual(served("bundle"));
  });

  it("keeps the bundle when Node does not strip types", () => {
    expect(serve(root, { flags: ["--no-experimental-strip-types"] })).toEqual(served("bundle"));
  });

  it("keeps the bundle when the package sits under node_modules", () => {
    const nested = copy(temp(join(root, "node_modules/.cache")), "dist", "src", "package.json");

    expect(serve(nested)).toEqual(served("bundle"));
  });

  it("keeps the bundle in a package that ships no src", () => {
    const packaged = copy(temp(), "dist", "packages", "package.json");
    symlinkSync(join(root, "node_modules"), join(packaged, "node_modules"), "dir");

    expect(serve(packaged)).toEqual(served("bundle"));
  });

  it("leaves a line with more than mcp on it to the CLI, which refuses it", () => {
    const { status, stderr } = spawnSync(
      process.execPath,
      [join(root, "dist/cli.mjs"), "mcp", "--stdio"],
      {
        encoding: "utf8",
        env,
        input: "",
        timeout: 20_000,
      },
    );

    expect({ status, stderr }).toEqual({
      status: 1,
      stderr: 'Invalid arguments: unknown option "--stdio"; takes no options\n',
    });
  });

  it.each(builds)("lets a client pinned to 2026 listen, from the $from", async ({ extra }) => {
    const client = await connect({ pin: "2026-07-28" }, extra);

    expect(client.getNegotiatedProtocolVersion()).toBe("2026-07-28");
    const subscription = await client.listen({ toolsListChanged: true });
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(toolNames);
    await subscription.close();
  });

  it.each(builds)(
    "still opens a 2025 client with initialize, from the $from",
    async ({ extra }) => {
      const client = await connect("legacy", extra);

      expect(client.getNegotiatedProtocolVersion()).toMatch(/^2025-/u);
      expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(toolNames);
    },
  );

  it("answers from src/ while the tree stays as it was", async () => {
    const { client, ran } = await checkoutServer(leavesMark);

    expect(await client.callTool({ name: "maps_providers", arguments: {} })).not.toHaveProperty(
      "isError",
    );
    expect(existsSync(ran)).toBe(true);
  });

  it("refuses a call after a pull, before the tool runs", async () => {
    const { checkout, client, ran } = await checkoutServer(leavesMark);
    await client.listTools();
    writeFileSync(join(checkout, "src/pulled.ts"), "export {};\n");

    expect(await client.callTool({ name: "maps_providers", arguments: {} })).toEqual(restart);
    expect(await client.callTool({ name: "maps_pulled", arguments: {} })).toEqual(restart);
    expect(existsSync(ran)).toBe(false);
  });

  it("refuses calls when a pull lands while src/ is still loading", async () => {
    const { client } = await checkoutServer({
      "server-info.ts": (source) =>
        `import { writeFileSync as testWrite } from "node:fs";\n${pull}\n${source}`,
    });

    expect(await client.callTool({ name: "maps_providers", arguments: {} })).toEqual(restart);
  });

  it("drops the answer of a call a pull landed in", async () => {
    const { client } = await checkoutServer(before(pull));

    expect(await client.callTool({ name: "maps_providers", arguments: {} })).toEqual(dropped);
  });
});
