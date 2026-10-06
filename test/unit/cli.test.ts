import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const CLI = fileURLToPath(new URL("../../src/cli.ts", import.meta.url));

/** Runs the CLI offline: no provider key, so nothing here may reach the network. */
function maps(...args: string[]) {
  const { status, stdout, stderr } = spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    env: { ...process.env, GOOGLE_MAPS_API_KEY: "", WHAT3WORDS_API_KEY: "" },
    timeout: 10_000,
  });
  return { code: status, stdout, stderr };
}

/** Runs the CLI with stdout already gone. */
async function runWithClosedStdout(...args: string[]) {
  const child = spawn(process.execPath, [CLI, ...args], {
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 10_000,
  });
  child.stdout.destroy();
  let stderr = "";
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
  await once(child, "close");
  return { code: child.exitCode, stderr };
}

describe("cli", () => {
  it("bows out quietly when the reader hangs up", async () => {
    await expect(runWithClosedStdout("providers")).resolves.toEqual({ code: 0, stderr: "" });
  });

  it("measures between two pasted latitude,longitude pairs", () => {
    expect(maps("distance", "52.2297,21.0122", "50.0647,19.9450")).toEqual({
      code: 0,
      stdout: "Distance: 251.98 km (251977 m)\nBearing: 197.6°\n",
      stderr: "",
    });
  });

  it("takes a pair that starts with a minus after --", () => {
    const { code, stdout } = maps("distance", "--", "-33.8688,151.2093", "-37.8136,144.9631");

    expect(code).toBe(0);
    expect(stdout).toMatch(/^Distance: 713\.\d\d km/);
  });

  it("prints the details as JSON with --json", () => {
    const { code, stdout } = maps("convert", "KO02", "--to", '["decimal"]', "--json");

    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toEqual({
      input: "KO02",
      format: "maidenhead",
      canonical: "KO02",
      center: { latitude: 52.5, longitude: 21 },
      bounds: { south: 52, north: 53, west: 20, east: 22 },
      formats: { decimal: "52.500000, 21.000000" },
    });
  });

  it("says what is wrong with a pair in one line, before any request", () => {
    expect(maps("reverse", "999,1")).toEqual({
      code: 1,
      stdout: "",
      stderr: "latitude must be a finite number between -90 and 90, got 999\n",
    });
  });

  it("refuses an option the command does not have", () => {
    const { code, stderr } = maps("geocode", "Warszawa", "--country", "pl");

    expect(code).toBe(1);
    expect(stderr).toContain('unknown option "--country"');
  });
});
