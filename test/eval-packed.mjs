/**
 * Packed-package gate: pack the tarball, install it cleanly without peers, resolve it next to every
 * host it names as a peer, and prove the published entries share one provider registry.
 *
 * This is the layer repository tests cannot see: a registry chunk split between dist entries, a
 * runtime dependency missing from `dependencies`, or a file dropped from `files` all surface
 * here first. Set MAPS_EVAL_KEEP=1 to keep the temp install for manual inspection.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

let failures = 0;

function check(name, ok, detail = "") {
  console.log(`${ok ? "ok" : "FAIL"} - ${name}`);
  if (!ok) {
    failures += 1;
    if (detail) console.log(String(detail).slice(0, 400));
  }
}

const pack = spawnSync("pnpm", ["pack"], { cwd: ROOT, encoding: "utf8", timeout: 120_000 });
const tarballName = pack.stdout.trim().split("\n").at(-1) ?? "";
check(
  "pnpm pack produces a tarball",
  pack.status === 0 && tarballName.endsWith(".tgz"),
  pack.stderr,
);

const packedManifest = spawnSync("tar", ["-xOf", join(ROOT, tarballName), "package/package.json"], {
  encoding: "utf8",
});
check(
  "the packed manifest names versions, not catalogs",
  packedManifest.status === 0 && !packedManifest.stdout.includes("catalog:"),
  packedManifest.stdout + packedManifest.stderr,
);

const dir = mkdtempSync(join(tmpdir(), "maps-packed-"));
const install = spawnSync(
  "npm",
  [
    "install",
    "--legacy-peer-deps",
    "--no-audit",
    "--no-fund",
    join(ROOT, tarballName),
    "@modelcontextprotocol/client@2.2.0",
  ],
  { cwd: dir, encoding: "utf8", timeout: 300_000 },
);
check(
  "npm install of the tarball and a test client succeeds without peers",
  install.status === 0,
  install.stderr,
);

/** Hosts at the versions this checkout runs, with no `--legacy-peer-deps` to hide an ERESOLVE. */
const hosts = Object.keys(
  JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).peerDependencies,
).map(
  (name) =>
    `${name}@${JSON.parse(readFileSync(join(ROOT, "node_modules", name, "package.json"), "utf8")).version}`,
);
const hostDir = mkdtempSync(join(tmpdir(), "maps-hosts-"));
writeFileSync(join(hostDir, "package.json"), "{}");
const withHosts = spawnSync(
  "npm",
  ["install", "--dry-run", "--no-audit", "--no-fund", join(ROOT, tarballName), ...hosts],
  { cwd: hostDir, encoding: "utf8", timeout: 300_000 },
);
rmSync(hostDir, { recursive: true, force: true });
check(
  `npm resolves the tarball next to ${hosts.join(", ")}`,
  withHosts.status === 0,
  withHosts.stderr,
);

/**
 * The probe registers a provider through the main entry and reads it back through the mcp
 * entry. With a split registry chunk the probe key never shows up in maps_providers.
 */
writeFileSync(
  join(dir, "probe.mjs"),
  `import { Provider, register } from "@agntn/maps";
import { createMcpServer } from "@agntn/maps/mcp";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";

class Probe extends Provider {
  static key = "probe";
  get capabilities() {
    return { geocode: false, geocodeAddress: false, reverse: false };
  }
  async geocode() {
    throw new Error("unused");
  }
  async geocodeAddress() {
    throw new Error("unused");
  }
  async reverse() {
    throw new Error("unused");
  }
}
register(Probe);

const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
const server = createMcpServer();
const client = new Client({ name: "packed", version: "0" });
await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
const response = await client.callTool({ name: "maps_providers", arguments: {} });
const text = response.content[0].text;
await client.close();
await server.close();
if (!text.includes("  probe: ")) {
  console.error("registry split: probe missing from maps_providers");
  process.exit(1);
}
console.log("registry shared across entries");
`,
);
const probe = spawnSync("node", ["probe.mjs"], { cwd: dir, encoding: "utf8", timeout: 60_000 });
check(
  "a provider registered through the main entry is visible through the mcp entry",
  probe.status === 0 && probe.stdout.includes("registry shared across entries"),
  probe.stdout + probe.stderr,
);

const cli = spawnSync("node", [join(dir, "node_modules/@agntn/maps/dist/cli.mjs"), "providers"], {
  cwd: dir,
  encoding: "utf8",
  timeout: 30_000,
});
check(
  "the packed CLI lists providers",
  cli.status === 0 && cli.stdout.includes("openstreetmap"),
  cli.stdout + cli.stderr,
);

rmSync(join(ROOT, tarballName), { force: true });
if (process.env.MAPS_EVAL_KEEP === "1") {
  console.log(`keeping temp install at ${dir}`);
} else {
  rmSync(dir, { recursive: true, force: true });
}

console.log(
  failures === 0 ? "eval-packed: all checks passed" : `eval-packed: ${failures} check(s) failed`,
);
process.exit(failures === 0 ? 0 : 1);
