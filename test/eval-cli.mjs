/**
 * CLI subprocess gate: every subcommand exercised end to end against the built binary.
 *
 * Runs the error paths and local commands offline; live Nominatim calls (spaced past the
 * 1 req/s policy) prove the network path. Set MAPS_EVAL_OFFLINE=1 to skip the live block.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../dist/cli.mjs", import.meta.url));
const LIVE = process.env.MAPS_EVAL_OFFLINE !== "1";

/** Credentials are dropped so provider auto-selection stays deterministic. */
const env = { ...process.env };
delete env.GOOGLE_MAPS_API_KEY;
delete env.WHAT3WORDS_API_KEY;

let failures = 0;

function run(args, extraEnv = {}) {
  return spawnSync("node", [CLI, ...args], {
    encoding: "utf8",
    env: { ...env, ...extraEnv },
    timeout: 30_000,
  });
}

function check(name, ok, detail = "") {
  console.log(`${ok ? "ok" : "FAIL"} - ${name}`);
  if (!ok) {
    failures += 1;
    if (detail) console.log(String(detail).slice(0, 400));
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const providers = run(["providers"]);
check("providers exits 0", providers.status === 0, providers.stderr);
check(
  "providers lists both backends and the missing-key hint",
  providers.stdout.includes("openstreetmap") && providers.stdout.includes("requires API key"),
  providers.stdout,
);

const distance = run(["distance", "52.2297,21.0122", "50.0647,19.9450"]);
check("distance exits 0", distance.status === 0, distance.stderr);
check(
  "distance reports kilometers and bearing",
  distance.stdout.includes("251.98 km") && distance.stdout.includes("Bearing: 197.6°"),
  distance.stdout,
);

const badDistance = run(["distance", "91,0", "0,0"]);
check(
  "distance rejects an out-of-range latitude",
  badDistance.status === 1 && badDistance.stderr.includes("latitude must be"),
  badDistance.stderr,
);

const convert = run(["convert", "52 13 46.9 N 21 0 43.9 E", "--to", '["maidenhead","mgrs"]']);
check("convert exits 0", convert.status === 0, convert.stderr);
check(
  "convert reads spaced DMS and writes the requested formats",
  convert.stdout.includes("dms 52°13'46.9\"N 21°0'43.9\"E") &&
    convert.stdout.includes("maidenhead  KO02mf") &&
    convert.stdout.includes("mgrs        34U EC 00832 86586"),
  convert.stdout,
);

const shortPlus = run(["convert", "CJ+2VX"]);
check(
  "convert asks for a reference on a short Plus Code",
  shortPlus.status === 1 && shortPlus.stderr.includes("pass a reference point"),
  shortPlus.stderr,
);

const recovered = run([
  "convert",
  "CJ+2VX",
  "--reference",
  '{"latitude":51.37,"longitude":-1.2178}',
  "--to",
  '["decimal"]',
]);
check(
  "convert recovers a short Plus Code near a reference",
  recovered.status === 0 && recovered.stdout.includes("decimal  51.370113, -1.217766"),
  recovered.stdout + recovered.stderr,
);

const badPair = run(["reverse", "52.23"]);
check(
  "reverse rejects a malformed pair",
  badPair.status === 1 && badPair.stderr.includes('Expected "latitude,longitude"'),
  badPair.stderr,
);

const unknown = run(["geocode", "Warsaw", "--provider", "missing"]);
check(
  "geocode rejects an unknown provider",
  unknown.status === 1 && unknown.stderr.includes("Unknown provider: missing"),
  unknown.stderr,
);

const keyless = run(["geocode", "Warsaw", "--provider", "googlemaps"]);
check(
  "googlemaps without a key fails with a clean auth message",
  keyless.status === 1 && keyless.stderr.includes("GOOGLE_MAPS_API_KEY"),
  keyless.stderr,
);

const emptyAddress = run(["address"]);
check(
  "address rejects an all-empty input",
  emptyAddress.status === 1 && emptyAddress.stderr.includes("at least one non-empty field"),
  emptyAddress.stderr,
);

const badGranularity = run(["reverse", "52.23,21.01", "--granularity", "block"]);
check(
  "reverse rejects an unknown granularity",
  badGranularity.status === 1 &&
    badGranularity.stderr.includes("country, state, city, street, building"),
  badGranularity.stderr,
);

const badLayer = run(["geocode", "Supreme Court", "--layers", '["poi","railway"]']);
check(
  "geocode rejects an unknown layer",
  badLayer.status === 1 &&
    badLayer.stderr.includes("/layers/1") &&
    badLayer.stderr.includes("address, poi, natural"),
  badLayer.stderr,
);

for (const sub of ["geocode", "address", "reverse", "distance", "convert", "providers"]) {
  const help = run([sub, "--help"]);
  check(`${sub} --help exits 0`, help.status === 0, help.stderr);
}

if (LIVE) {
  const geocode = run(["geocode", "Pałac Kultury i Nauki, Warszawa", "--limit", "1"]);
  check(
    "live geocode finds the palace",
    geocode.status === 0 && geocode.stdout.includes("52.2317657"),
    geocode.stdout || geocode.stderr,
  );
  await sleep(1100);
  const reverse = run(["reverse", "52.2318,21.0067"]);
  check(
    "live reverse names the place",
    reverse.status === 0 && reverse.stdout.includes("Plac Defilad"),
    reverse.stdout || reverse.stderr,
  );
  await sleep(1100);
  const address = run([
    "address",
    "--road",
    "Złota",
    "--house-number",
    "44",
    "--city",
    "Warszawa",
    "--limit",
    "1",
  ]);
  check(
    "live structured address finds the tower",
    address.status === 0 && address.stdout.includes("52.2312136"),
    address.stdout || address.stderr,
  );
  await sleep(1100);
  const coarse = run(["reverse", "52.2318,21.0067", "--granularity", "city"]);
  check(
    "live city granularity answers with the city boundary",
    coarse.status === 0 &&
      coarse.stdout.includes("Warszawa") &&
      !coarse.stdout.includes("Plac Defilad"),
    coarse.stdout || coarse.stderr,
  );
  await sleep(1100);
  const landmark = run([
    "geocode",
    "United States Supreme Court",
    "--layers",
    '["poi"]',
    "--limit",
    "3",
  ]);
  check(
    "live poi layer surfaces the court building instead of streets named after it",
    landmark.status === 0 &&
      landmark.stdout.includes("Supreme Court of the United States") &&
      !landmark.stdout.includes("Montecito Heights"),
    landmark.stdout || landmark.stderr,
  );
  await sleep(1100);
  const fallback = run(["geocode", "Rynek, Wrocław", "--limit", "1"], {
    GOOGLE_MAPS_API_KEY: "dummy",
  });
  check(
    "a dummy Google key falls back to openstreetmap on the real REQUEST_DENIED",
    fallback.status === 0 && fallback.stdout.includes("[openstreetmap]"),
    fallback.stdout || fallback.stderr,
  );
} else {
  console.log("skip - live checks disabled via MAPS_EVAL_OFFLINE=1");
}

console.log(
  failures === 0 ? "eval-cli: all checks passed" : `eval-cli: ${failures} check(s) failed`,
);
process.exit(failures === 0 ? 0 : 1);
